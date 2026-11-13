//go:build live_ws

package spot

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gorilla/websocket"
	"net/http"
	"net/url"
	"time"
)

func (f *BinanceFeed) snapshot(ctx context.Context) (BinanceSnapshot, error) {
	s := NewRESTSource()
	s.client.Timeout = 10 * time.Second
	if tr, ok := s.client.Transport.(*http.Transport); ok {
		tr.ResponseHeaderTimeout = 8 * time.Second
		defer tr.CloseIdleConnections()
	}
	var raw struct {
		Last uint64     `json:"lastUpdateId"`
		Bids [][]string `json:"bids"`
		Asks [][]string `json:"asks"`
	}
	_, e := s.get(ctx, "https://api.binance.com/api/v3/depth?symbol="+url.QueryEscape(Symbol("binance", f.asset))+"&limit=5000", &raw)
	if e != nil {
		return BinanceSnapshot{}, e
	}
	b, e := parseBinanceLevels(raw.Bids, false)
	if e != nil {
		return BinanceSnapshot{}, e
	}
	a, e := parseBinanceLevels(raw.Asks, false)
	return BinanceSnapshot{raw.Last, b, a}, e
}
func (f *BinanceFeed) Run(ctx context.Context, report func(string)) {
	if report == nil {
		report = func(string) {}
	}
	retry := time.Second
	for ctx.Err() == nil {
		e := f.runConnection(ctx, func(message string) {
			if message == "bootstrap_ok" {
				retry = time.Second
			}
			report(message)
		})
		if ctx.Err() != nil {
			return
		}
		if e != nil {
			report(e.Error())
		}
		timer := time.NewTimer(retry)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		retry *= 2
		if retry > 30*time.Second {
			retry = 30 * time.Second
		}
	}
}
func (f *BinanceFeed) runConnection(ctx context.Context, report func(string)) error {
	c, resp, e := websocket.DefaultDialer.DialContext(ctx, f.StreamURL(), nil)
	if e != nil {
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
		}
		f.mu.Lock()
		_ = f.book.Invalidate(f.now().UnixMilli(), "dial_failed")
		f.mu.Unlock()
		return e
	}
	c.SetReadLimit(8 << 20)
	_ = c.SetReadDeadline(time.Now().Add(90 * time.Second))
	ping := c.PingHandler()
	c.SetPingHandler(func(s string) error { _ = c.SetReadDeadline(time.Now().Add(90 * time.Second)); return ping(s) })
	session := f.newSession()
	notify := make(chan struct{}, 1)
	readErr := make(chan error, 1)
	done := make(chan struct{})
	runCtx, cancel := context.WithCancel(ctx)
	go func() {
		defer close(done)
		for {
			_, raw, e := c.ReadMessage()
			if e == nil {
				_ = c.SetReadDeadline(time.Now().Add(90 * time.Second))
				var m struct {
					Event  string     `json:"e"`
					Symbol string     `json:"s"`
					First  uint64     `json:"U"`
					Last   uint64     `json:"u"`
					Bids   [][]string `json:"b"`
					Asks   [][]string `json:"a"`
				}
				e = json.Unmarshal(raw, &m)
				if e == nil && (m.Event != "depthUpdate" || m.Symbol != Symbol("binance", f.asset)) {
					e = errors.New("unexpected Binance message")
				}
				if e == nil {
					var b, a []Level
					b, e = parseBinanceLevels(m.Bids, true)
					if e == nil {
						a, e = parseBinanceLevels(m.Asks, true)
					}
					if e == nil {
						e = session.onDelta(BinanceDelta{m.First, m.Last, b, a})
					}
				}
			}
			if e != nil {
				session.fail("websocket_or_sequence_failure")
				readErr <- e
				cancel()
				return
			}
			select {
			case notify <- struct{}{}:
			default:
			}
		}
	}()
	defer func() { cancel(); c.Close(); <-done; session.fail("disconnected") }()
	// Closing on context cancellation makes blocking ReadMessage interruptible.
	stop := context.AfterFunc(runCtx, func() { c.Close() })
	defer stop()
	install := func() error {
		snap, e := f.snapshot(runCtx)
		if e != nil {
			return e
		}
		timer := time.NewTimer(10 * time.Second)
		defer timer.Stop()
		for {
			e = session.tryInstall(snap)
			if e == nil {
				return nil
			}
			if !errors.Is(e, ErrBridgePending) {
				return e
			}
			select {
			case <-runCtx.Done():
				return runCtx.Err()
			case e = <-readErr:
				return e
			case <-timer.C:
				return errors.New("Binance bridge timeout")
			case <-notify:
			}
		}
	}
	if e = install(); e != nil {
		return e
	}
	report("bootstrap_ok")
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-runCtx.Done():
			return runCtx.Err()
		case e = <-readErr:
			return e
		case <-tick.C:
			reason := f.refreshReason()
			if reason == "" {
				continue
			}
			if e = session.beginRefresh(); e != nil {
				return e
			}
			if e = install(); e != nil {
				return e
			}
			report("refresh_ok:" + reason)
		}
	}
}

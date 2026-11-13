//go:build live_ws

package futures

import (
	"context"
	"time"

	"github.com/gorilla/websocket"
)

// RunWS is a public-market-only feed; no credentials or trading routes. A
// bounded reconnect loop marks uncertainty on every transport/parser failure.
func (c *Collector) RunWS(ctx context.Context, report func(string)) {
	if report == nil {
		report = func(string) {}
	}
	retry := time.Second
	for ctx.Err() == nil {
		started := time.Now()
		e := c.runWS(ctx)
		if ctx.Err() != nil {
			return
		}
		c.Invalidate()
		if e != nil {
			report(e.Error())
		}
		if time.Since(started) > 30*time.Second {
			retry = time.Second
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
func (c *Collector) runWS(ctx context.Context) error {
	conn, res, e := websocket.DefaultDialer.DialContext(ctx, MarketStreamURL, nil)
	if e != nil {
		if res != nil && res.Body != nil {
			res.Body.Close()
		}
		return e
	}
	defer conn.Close()
	conn.SetReadLimit(1 << 20)
	_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	ping := conn.PingHandler()
	conn.SetPingHandler(func(s string) error { _ = conn.SetReadDeadline(time.Now().Add(90 * time.Second)); return ping(s) })
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			conn.Close()
		case <-done:
		}
	}()
	for {
		_, raw, e := conn.ReadMessage()
		if e != nil {
			return e
		}
		_ = conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		if e = c.Accept(raw); e != nil {
			return e
		}
	}
}

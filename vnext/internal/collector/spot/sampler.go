package spot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"time"
)

var spotVenues = []string{"binance", "coinbase", "kraken", "bitfinex"}
var spotAssets = []string{"BTC", "ETH", "SOL"}

type spotREST interface {
	Exact(context.Context, string, string) (CapturedBook, error)
	Bitfinex(context.Context, string, string) (CapturedBook, error)
	KrakenGrouped(context.Context, string) (CapturedBook, error)
	KrakenFallback(context.Context, string) (CapturedBook, error)
}
type spotCut interface {
	Cut(int64) (BinanceCut, error)
}

// Sampler runs one bounded, 12-row batch. No network is started by construction.
// The scheduling caller must arrange firstTarget on the persistent Binance feeds.
type Sampler struct {
	rest    spotREST
	kraken  func(context.Context) (map[string]CapturedBook, error)
	binance map[string]spotCut
}

func NewSampler(rest *RESTSource, kraken func(context.Context) (map[string]CapturedBook, error), feeds map[string]*BinanceFeed) (*Sampler, error) {
	if rest == nil {
		return nil, errors.New("rest source must be configured")
	}
	b := map[string]spotCut{}
	for _, a := range []string{"BTC", "ETH"} {
		if feeds != nil && feeds[a] != nil {
			b[a] = feeds[a]
		}
	}
	return &Sampler{rest: rest, kraken: kraken, binance: b}, nil
}

type sampleInputs struct {
	books    map[string]*CapturedBook
	cuts     map[string]BinanceCut
	failures map[string]string
}

func newInputs() sampleInputs {
	return sampleInputs{map[string]*CapturedBook{}, map[string]BinanceCut{}, map[string]string{}}
}
func partKey(venue, asset, part string) string { return venue + ":" + asset + ":" + part }
func (in sampleInputs) buildRows(t, available int64) ([]model.Row, error) {
	out := make([]model.Row, 0, 12)
	for _, v := range spotVenues {
		for _, a := range spotAssets {
			var r model.SpotRow
			var e error
			switch v {
			case "binance":
				if _, hasCut := in.cuts[a]; hasCut {
					r, e = BinanceCutRow(t, available, a, in.cuts[a])
				} else {
					r, e = ExactCapturedRow(t, available, v, a, in.books[partKey(v, a, "exact")])
				}
			case "coinbase":
				r, e = ExactCapturedRow(t, available, v, a, in.books[partKey(v, a, "exact")])
			case "kraken":
				r, e = KrakenRow(t, available, a, in.books[partKey(v, a, "ws")], in.books[partKey(v, a, "group")], in.books[partKey(v, a, "fallback")])
			case "bitfinex":
				r, e = BitfinexRow(t, available, a, in.books[partKey(v, a, "P1")], in.books[partKey(v, a, "P2")])
			}
			if e != nil {
				return nil, e
			}
			failure := map[string]string{}
			for _, p := range []string{"exact", "ws", "group", "fallback", "P1", "P2", "cut"} {
				if s := in.failures[partKey(v, a, p)]; s != "" {
					failure[p] = s
				}
			}
			if len(failure) > 0 {
				var q map[string]any
				if r.Quality != nil {
					_ = json.Unmarshal([]byte(*r.Quality), &q)
				}
				if q == nil {
					q = map[string]any{}
				}
				q["source_failures"] = failure
				b, _ := json.Marshal(q)
				r.Quality = model.Ptr(string(b))
			}
			out = append(out, r)
		}
	}
	return out, nil
}
func waitAt(ctx context.Context, t time.Time) error {
	d := time.Until(t)
	if d <= 0 {
		return ctx.Err()
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
func missingGrid(t, available int64, reason string) ([]model.Row, error) {
	out := make([]model.Row, 0, 12)
	for _, v := range spotVenues {
		for _, a := range spotAssets {
			r, e := missingRow(t, available, nil, v, a, reason)
			if e != nil {
				return nil, e
			}
			out = append(out, r)
		}
	}
	return out, nil
}

type sampleResult struct {
	key  string
	book *CapturedBook
	ws   map[string]CapturedBook
	err  error
}

// SampleAt uses legacy T-1.5s/T+1.5s capture boundaries. It may finalize after
// the deadline but never accepts a capture outside it. Network timeouts are
// explicit missing rows. A missed scheduler window is never backfilled from now.
func (s *Sampler) SampleAt(ctx context.Context, t int64) ([]model.Row, error) {
	if t <= 0 || t%60000 != 0 {
		return nil, errors.New("invalid minute target")
	}
	lead := time.UnixMilli(t - WindowMS)
	deadline := time.UnixMilli(t + WindowMS)
	if e := waitAt(ctx, lead); e != nil {
		return nil, e
	}
	if time.Now().After(deadline) {
		return missingGrid(t, time.Now().UnixMilli(), "scheduler_miss")
	}
	batch, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	results := make(chan sampleResult, 20)
	pending := map[string]bool{}
	in := newInputs()
	launch := func(key string, fn func() (CapturedBook, error)) {
		pending[key] = true
		go func() {
			b, e := fn()
			r := sampleResult{key: key, err: e}
			if e == nil {
				r.book = &b
			}
			results <- r
		}()
	}
	for _, v := range []string{"binance", "coinbase"} {
		for _, a := range spotAssets {
			if v == "binance" && s.binance[a] != nil {
				continue
			}
			v, a := v, a
			launch(partKey(v, a, "exact"), func() (CapturedBook, error) { return s.rest.Exact(batch, v, a) })
		}
	}
	for _, a := range spotAssets {
		for _, p := range []string{"P1", "P2"} {
			a, p := a, p
			launch(partKey("bitfinex", a, p), func() (CapturedBook, error) { return s.rest.Bitfinex(batch, a, p) })
		}
	}
	for _, a := range []string{"BTC", "ETH"} {
		a := a
		launch(partKey("kraken", a, "group"), func() (CapturedBook, error) { return s.rest.KrakenGrouped(batch, a) })
	}
	wsKey := "kraken:all:ws"
	if s.kraken != nil {
		// Leave a short return/dispatch margin for partial WS results at deadline.
		pending[wsKey] = true
		go func() {
			wctx, wcancel := context.WithDeadline(batch, deadline.Add(-100*time.Millisecond))
			defer wcancel()
			m, e := s.kraken(wctx)
			results <- sampleResult{key: wsKey, ws: m, err: e}
		}()
	} else {
		launch(partKey("kraken", "SOL", "fallback"), func() (CapturedBook, error) { return s.rest.KrakenFallback(batch, "SOL") })
	}
	// A bounded processing grace does not widen capture acceptance.
	timer := time.NewTimer(time.Until(deadline.Add(150 * time.Millisecond)))
	defer timer.Stop()
	handle := func(r sampleResult) {
		if !pending[r.key] {
			return
		}
		delete(pending, r.key)
		if r.key == wsKey {
			for _, a := range spotAssets {
				k := partKey("kraken", a, "ws")
				if b, ok := r.ws[a]; ok {
					copy := b
					in.books[k] = &copy
				} else {
					reason := "snapshot_missing"
					if r.err != nil {
						reason = r.err.Error()
					}
					in.failures[k] = reason
				}
			}
		} else if r.err != nil {
			in.failures[r.key] = r.err.Error()
		} else if r.book != nil {
			in.books[r.key] = r.book
		}
	}
	fallbackStarted := map[string]bool{}
	tryFallback := func() {
		if pending[wsKey] || batch.Err() != nil {
			return
		}
		for _, a := range spotAssets {
			if fallbackStarted[a] || pending[partKey("kraken", a, "group")] {
				continue
			}
			now := time.Now().UnixMilli()
			if validCapture(t, now, in.books[partKey("kraken", a, "ws")]) || validCapture(t, now, in.books[partKey("kraken", a, "group")]) {
				continue
			}
			fallbackStarted[a] = true
			a := a
			launch(partKey("kraken", a, "fallback"), func() (CapturedBook, error) { return s.rest.KrakenFallback(batch, a) })
		}
	}
collecting:
	for len(pending) > 0 {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case r := <-results:
			handle(r)
			tryFallback()
		case <-timer.C:
			for {
				select {
				case r := <-results:
					handle(r)
				default:
					break collecting
				}
			}
		}
	}
	for k := range pending {
		if k == wsKey {
			for _, a := range spotAssets {
				in.failures[partKey("kraken", a, "ws")] = "deadline"
			}
		} else {
			in.failures[k] = "deadline"
		}
	}
	if e := waitAt(ctx, time.UnixMilli(t+1)); e != nil {
		return nil, e
	}
	for _, a := range []string{"BTC", "ETH"} {
		if s.binance[a] == nil {
			continue
		}
		c, e := s.binance[a].Cut(t)
		if e != nil {
			in.failures[partKey("binance", a, "cut")] = e.Error()
		} else {
			in.cuts[a] = c
		}
	}
	available := time.Now().UnixMilli()
	rows, e := in.buildRows(t, available)
	if e != nil {
		return nil, e
	}
	available = time.Now().UnixMilli()
	if available < t {
		return nil, fmt.Errorf("clock regressed before publish")
	}
	for i, r := range rows {
		sp := r.(model.SpotRow)
		sp.AvailableAt = model.Ptr(available)
		rows[i] = sp
	}
	return rows, nil
}

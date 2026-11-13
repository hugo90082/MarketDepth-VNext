package futures

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

const MarketStreamURL = "wss://fstream.binance.com/market/stream?streams=btcusdt@aggTrade/ethusdt@aggTrade/solusdt@aggTrade/btcusdt@kline_1m/ethusdt@kline_1m/solusdt@kline_1m"
const FinalizeDelay = 2 * time.Second

var assets = []string{"BTC", "ETH", "SOL"}

type minuteKey struct {
	asset string
	t     int64
}

// Collector admits messages and finalizes all assets under a common lock.
// Only admission before finalization may affect a stored row. For the live
// path now is time.Now; tests inject a clock. Bounded memory, no raw history.
type Collector struct {
	mu        sync.Mutex
	now       func() time.Time
	next      int64
	windows   map[string]*Window
	minutes   map[minuteKey]model.Futures1Row
	conflicts map[minuteKey]bool
}

func NewCollector(first int64) (*Collector, error) { return newCollector(first, time.Now) }
func newCollector(first int64, now func() time.Time) (*Collector, error) {
	if now == nil {
		return nil, errors.New("clock required")
	}
	c := &Collector{now: now, next: first, windows: map[string]*Window{}, minutes: map[minuteKey]model.Futures1Row{}, conflicts: map[minuteKey]bool{}}
	for _, a := range assets {
		w, e := NewWindow(a, first, MaxWindowTrades-1)
		if e != nil {
			return nil, e
		}
		c.windows[a] = w
	}
	return c, nil
}
func (c *Collector) Invalidate() {
	c.mu.Lock()
	defer c.mu.Unlock()
	at := c.now().UnixMilli()
	for _, w := range c.windows {
		w.Invalidate(at)
	}
}

// Accept validates combined-stream name against the payload, not a guessed
// symbol. Only six USD-M streams can modify state.
func (c *Collector) Accept(raw []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	var msg struct {
		Stream string          `json:"stream"`
		Data   json.RawMessage `json:"data"`
	}
	if e := json.Unmarshal(raw, &msg); e != nil {
		return e
	}
	at := c.now().UnixMilli()
	switch {
	case strings.HasSuffix(msg.Stream, "@aggTrade"):
		x, e := ParseWSAgg(msg.Data, at)
		if e != nil {
			return e
		}
		if msg.Stream != strings.ToLower(x.Asset)+"usdt@aggTrade" {
			return errors.New("trade stream mismatch")
		}
		return c.windows[x.Asset].Add(x)
	case strings.HasSuffix(msg.Stream, "@kline_1m"):
		r, e := ParseWSKline(msg.Data, at)
		if errors.Is(e, ErrOpenKline) {
			return nil
		}
		if e != nil {
			return e
		}
		if msg.Stream != strings.ToLower(r.Asset)+"usdt@kline_1m" {
			return errors.New("kline stream mismatch")
		}
		k := minuteKey{r.Asset, r.T}
		// The minute containing c.next may already be partly elapsed when starting.
		// An official closed bar is independent of stream start; a late older bar
		// is not used to silently rewrite an already finalized minute.
		if r.T+60000 <= c.next {
			return nil
		}
		if r.T > c.next+120000 {
			return errors.New("future kline buffer window")
		}
		if old, ok := c.minutes[k]; ok {
			a, b := old, r
			a.AvailableAt = nil
			b.AvailableAt = nil
			ra, _ := json.Marshal(a)
			rb, _ := json.Marshal(b)
			if string(ra) != string(rb) {
				c.conflicts[k] = true
				return errors.New("conflicting closed kline")
			}
			return nil
		}
		c.minutes[k] = r
		return nil
	default:
		return errors.New("unknown futures stream")
	}
}
func missingMinute(asset string, t, at int64, reason string) model.Futures1Row {
	b, _ := json.Marshal(map[string]any{"method": "official_ws_1m", "reason": reason})
	return model.Futures1Row{Common: model.Common{Asset: asset, T: t, AvailableAt: model.Ptr(at), Status: "missing", Source: model.Ptr(model.LiveSource), Quality: model.Ptr(string(b)), Revision: 1}}
}

// Finalize emits three 10s rows, plus three official minute rows when the
// bucket closes a minute. The writer uses their original t for Taiwan day.
// If any asset fails, the batch is not silently partially emitted.
func (c *Collector) Finalize(t int64) ([]model.Row, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	cut := c.now().UnixMilli()
	if t != c.next || cut < t+10000+FinalizeDelay.Milliseconds() {
		return nil, errors.New("unexpected bucket or grace not elapsed")
	}
	rows := make([]model.Row, 0, 6)
	for _, a := range assets {
		r, e := c.windows[a].Finalize(t, cut)
		if e != nil {
			return nil, fmt.Errorf("%s finalize: %w", a, e)
		}
		rows = append(rows, r)
	}
	at := c.now().UnixMilli()
	if at < cut {
		return nil, errors.New("clock moved backwards")
	}
	for i, r := range rows {
		x := r.(model.Futures10Row)
		x.AvailableAt = model.Ptr(at)
		rows[i] = x
	}
	end := t + 10000
	if end%60000 == 0 {
		mt := end - 60000
		for _, a := range assets {
			k := minuteKey{a, mt}
			r, ok := c.minutes[k]
			if !ok || c.conflicts[k] {
				reason := "closed_kline_not_received"
				if c.conflicts[k] {
					reason = "conflicting_closed_kline"
				}
				r = missingMinute(a, mt, at, reason)
			}
			// Receipt is evidence, not the publication time of the scheduled row.
			// Preserve the original receipt in quality; available_at is the actual
			// finalization time, just like the other rows in this batch.
			if ok && !c.conflicts[k] {
				var quality map[string]any
				if r.Quality == nil || json.Unmarshal([]byte(*r.Quality), &quality) != nil || quality == nil || r.AvailableAt == nil || *r.AvailableAt > at {
					return nil, errors.New("invalid admitted kline or clock regression")
				}
				quality["received_at"] = *r.AvailableAt
				b, _ := json.Marshal(quality)
				r.Quality = model.Ptr(string(b))
				r.AvailableAt = model.Ptr(at)
			}
			rows = append(rows, r)
			delete(c.minutes, k)
			delete(c.conflicts, k)
		}
	}
	c.next = end
	return rows, nil
}

package store

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"sort"
	"sync"
	"time"
)

// Mock is an in-memory test fixture, not a production store. Process restart changes generation.
type Mock struct {
	mu         sync.RWMutex
	generation string
	version    int64
	rows       map[model.Kind]map[model.Key]model.Row
	journal    []model.Row
}
type cursor struct {
	Generation   string
	Version      int64
	Kind         model.Kind
	From, To     int64
	Asset, Venue string
	Key          model.Key
	Seq          int
	Mode         string
}

func NewMock() *Mock {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	return &Mock{generation: hex.EncodeToString(b[:]), rows: map[model.Kind]map[model.Key]model.Row{model.Spot: {}, model.F10: {}, model.F1: {}}}
}
func encode(c cursor) string { b, _ := json.Marshal(c); return base64.RawURLEncoding.EncodeToString(b) }
func decode(s string) (cursor, error) {
	var c cursor
	if len(s) > 4096 {
		return c, ErrResync
	}
	b, e := base64.RawURLEncoding.DecodeString(s)
	if e != nil {
		return c, ErrResync
	}
	if json.Unmarshal(b, &c) != nil {
		return c, ErrResync
	}
	return c, nil
}
func (m *Mock) Put(ctx context.Context, rows []model.Row) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	pending := map[model.Kind]map[model.Key]model.Row{}
	for _, r := range rows {
		if e := ctx.Err(); e != nil {
			return e
		}
		if e := r.Validate(); e != nil {
			return e
		}
		if !r.Kind().Valid() {
			return errors.New("bad kind")
		}
		if pending[r.Kind()] == nil {
			pending[r.Kind()] = map[model.Key]model.Row{}
		}
		if pending[r.Kind()][r.Key()] != nil {
			return errors.New("duplicate key in batch")
		}
		if old := m.rows[r.Kind()][r.Key()]; old != nil {
			a, b := old.Base(), r.Base()
			if b.Revision != a.Revision+1 || (a.AvailableAt != nil && (b.AvailableAt == nil || *b.AvailableAt < *a.AvailableAt)) {
				return errors.New("invalid revision or availability")
			}
		} else if r.Base().Revision != 1 {
			return errors.New("first revision must be 1")
		}
		raw, e := json.Marshal(r)
		if e != nil {
			return e
		}
		copyRow, e := model.Decode(r.Kind(), raw)
		if e != nil {
			return e
		}
		pending[r.Kind()][r.Key()] = copyRow
	}
	for _, r := range rows {
		v := pending[r.Kind()][r.Key()]
		m.rows[r.Kind()][r.Key()] = v
		m.journal = append(m.journal, v)
	}
	if len(rows) > 0 {
		m.version++
	}
	return nil
}
func (m *Mock) History(ctx context.Context, q Query) (Page, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	p := Page{Rows: []model.Row{}, Complete: true, Gaps: []Gap{}}
	if !q.Kind.Valid() || q.Limit < 1 || q.Limit > 2000 || q.From < 0 || q.To <= q.From || q.To-q.From > 31*86400000 || q.To > 253402300799999 {
		return p, errors.New("bad query")
	}
	c := cursor{Generation: m.generation, Version: m.version, Kind: q.Kind, From: q.From, To: q.To, Asset: q.Asset, Venue: q.Venue, Mode: "history"}
	var prev *model.Key
	if q.Cursor != "" {
		got, e := decode(q.Cursor)
		if e != nil || got.Generation != c.Generation || got.Version != c.Version || got.Kind != c.Kind || got.From != c.From || got.To != c.To || got.Asset != c.Asset || got.Venue != c.Venue || got.Mode != c.Mode {
			return p, ErrResync
		}
		prev = &got.Key
	}
	// Identify missing expected grid keys independently of pagination. NULL rows are present.
	step := q.Kind.Interval()
	expected := 3
	if q.Asset != "" {
		expected = 1
	}
	if q.Kind == model.Spot && q.Venue == "" {
		expected *= 4
	}
	present := map[int64]int{}
	for k := range m.rows[q.Kind] {
		if k.T >= q.From && k.T < q.To && (q.Asset == "" || k.Asset == q.Asset) && (q.Venue == "" || k.Venue == q.Venue) {
			present[k.T]++
		}
	}
	first := q.From - q.From%step
	if first < q.From {
		first += step
	}
	for t := first; t < q.To; t += step {
		if present[t] == expected {
			continue
		}
		end := t + step
		if end > q.To {
			end = q.To
		}
		n := len(p.Gaps)
		if n > 0 && p.Gaps[n-1].To == t {
			p.Gaps[n-1].To = end
		} else {
			p.Gaps = append(p.Gaps, Gap{From: t, To: end, Reason: "fixture_grid_missing"})
		}
	}
	for k, r := range m.rows[q.Kind] {
		if k.T >= q.From && k.T < q.To && (q.Asset == "" || k.Asset == q.Asset) && (q.Venue == "" || k.Venue == q.Venue) && (prev == nil || prev.Less(k)) {
			p.Rows = append(p.Rows, r)
		}
	}
	sort.Slice(p.Rows, func(i, j int) bool { return p.Rows[i].Key().Less(p.Rows[j].Key()) })
	if len(p.Rows) > q.Limit {
		p.Rows = p.Rows[:q.Limit]
		c.Key = p.Rows[len(p.Rows)-1].Key()
		p.Next = encode(c)
		p.Complete = false
	}
	return p, ctx.Err()
}
func (m *Mock) Sync(ctx context.Context, k model.Kind, s string) (Page, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	p := Page{Rows: []model.Row{}, Complete: true, Gaps: []Gap{}}
	if !k.Valid() {
		return p, errors.New("invalid kind")
	}
	c := cursor{Generation: m.generation, Kind: k, Mode: "sync"}
	if s != "" {
		got, e := decode(s)
		if e != nil || got.Generation != c.Generation || got.Kind != k || got.Mode != "sync" || got.Seq < 0 || got.Seq > len(m.journal) {
			return p, ErrResync
		}
		c.Seq = got.Seq
	}
	for c.Seq < len(m.journal) {
		r := m.journal[c.Seq]
		c.Seq++
		if r.Kind() == k {
			p.Rows = append(p.Rows, r)
			if len(p.Rows) == 2000 {
				break
			}
		}
	}
	p.Complete = c.Seq == len(m.journal)
	p.Next = encode(c)
	return p, ctx.Err()
}
func (m *Mock) Latest(ctx context.Context, k model.Kind) ([]model.Row, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := []model.Row{}
	var max int64 = -1
	for key, r := range m.rows[k] {
		if key.T > max {
			max = key.T
			out = out[:0]
		}
		if key.T == max {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key().Less(out[j].Key()) })
	return out, ctx.Err()
}
func (m *Mock) Days(ctx context.Context, from, to string) ([]Day, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ds := map[string]Day{}
	for k, rows := range m.rows {
		for key := range rows {
			d := model.Day(key.T)
			if d < from || d > to {
				continue
			}
			v, ok := ds[d]
			if !ok {
				a, _ := time.ParseInLocation("2006-01-02", d, time.FixedZone("UTC+8", 8*3600))
				v = Day{Day: d, State: "fixture", Revision: 1, From: a.UnixMilli(), To: a.Add(24 * time.Hour).UnixMilli(), Counts: map[model.Kind]int{}, Gaps: []Gap{}}
			}
			v.Counts[k]++
			ds[d] = v
		}
	}
	out := []Day{}
	for _, d := range ds {
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Day < out[j].Day })
	return out, ctx.Err()
}
func Fixture() *Mock {
	m := NewMock()
	t := time.Date(2026, 11, 13, 0, 0, 0, 0, time.FixedZone("UTC+8", 8*3600)).UnixMilli()
	src := "synthetic_fixture"
	var rows []model.Row
	for i := int64(0); i < 2; i++ {
		tt := t + i*60000
		for _, a := range []string{"BTC", "ETH", "SOL"} {
			for _, v := range []string{"binance", "coinbase", "kraken", "bitfinex"} {
				r := model.SpotRow{Common: model.Common{T: tt, AvailableAt: model.Ptr(tt + 800), Asset: a, Status: "partial", Source: &src, Revision: 1}, Venue: v, Bid0100: model.Ptr(100.0), Ask0100: model.Ptr(0.0), CapturedAt: model.Ptr(tt + 500)}
				rows = append(rows, r)
			}
			for j := int64(0); j < 6; j++ {
				x := tt + j*10000
				rows = append(rows, model.Futures10Row{Common: model.Common{T: x, AvailableAt: model.Ptr(x + 10000), Asset: a, Status: "empty", Source: &src, Revision: 1}, BuyQty: model.Ptr(0.0), SellQty: model.Ptr(0.0), BuyUSDT: model.Ptr(0.0), SellUSDT: model.Ptr(0.0), AggCount: model.Ptr(int64(0))})
			}
			rows = append(rows, model.Futures1Row{Common: model.Common{T: tt, AvailableAt: model.Ptr(tt + 60000), Asset: a, Status: "missing", Source: &src, Revision: 1}})
		}
	}
	if e := m.Put(context.Background(), rows); e != nil {
		panic(fmt.Sprint(e))
	}
	return m
}

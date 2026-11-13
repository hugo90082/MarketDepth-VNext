package spot

import (
	"errors"
	"fmt"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"math"
	"sync"
)

const BinanceMaxAgeMS int64 = 45000 // legacy depth-data freshness; ping is not data
const BinanceRefreshMS int64 = 15 * 60 * 1000

var ErrBridgePending = errors.New("bridge not established")

const maxBinanceLevels = 1000000 // fail closed on abnormal memory growth; validate on 512MB host

type BinanceSnapshot struct {
	Last       uint64
	Bids, Asks []Level
}
type BinanceDelta struct {
	First, Last uint64
	Bids, Asks  []Level
}

// Bridge is complete only after at least one sequence-valid diff crosses the
// REST snapshot. An empty buffered channel is not proof of a bridge.
func Bridge(s BinanceSnapshot, ds []BinanceDelta) ([]BinanceDelta, uint64, error) {
	if s.Last == 0 || s.Last == ^uint64(0) {
		return nil, 0, errors.New("invalid snapshot ID")
	}
	if _, e := Normalize(s.Bids, s.Asks); e != nil {
		return nil, 0, e
	}
	last := s.Last
	out := make([]BinanceDelta, 0, len(ds))
	for _, d := range ds {
		if e := validDelta(d); e != nil {
			return nil, 0, e
		}
		if d.Last <= last {
			continue
		}
		if d.First > last+1 {
			return nil, 0, errors.New("sequence gap during bridge")
		}
		out = append(out, d)
		last = d.Last
	}
	if len(out) == 0 {
		return nil, 0, ErrBridgePending
	}
	return out, last, nil
}
func validDelta(d BinanceDelta) error {
	if d.First == 0 || d.First > d.Last || d.Last == ^uint64(0) {
		return errors.New("invalid update range")
	}
	for _, side := range [][]Level{d.Bids, d.Asks} {
		for _, l := range side {
			if !finite(l.Price) || !finite(l.Qty) || l.Price <= 0 || l.Qty < 0 {
				return errors.New("invalid delta level")
			}
		}
	}
	return nil
}

type BinanceCut struct {
	T, LastDataAt          int64
	Last                   uint64
	Depth                  Depth
	TrustedBid, TrustedAsk *float64
	Reason                 string
}

// BinanceBook owns a single mutable book. Before any event with receive time
// > T, it freezes the summary at T; the next event never contaminates that
// summary. No raw event history is kept here. The network owner must deliver
// observations serially and assign availability only when accepted by it.
// Snapshot/refresh/invalidations share the exact same causal boundary.
type BinanceBook struct {
	mu                                   sync.Mutex
	bid, ask                             map[float64]float64
	next, lastAt, lastData, refreshAt    int64
	last                                 uint64
	ready                                bool
	reason                               string
	bidEdge, askEdge, bidFloor, askFloor float64
	cuts                                 map[int64]BinanceCut
}

func NewBinanceBook(firstTarget int64) (*BinanceBook, error) {
	if firstTarget <= 0 || firstTarget%60000 != 0 {
		return nil, errors.New("invalid first target")
	}
	return &BinanceBook{bid: map[float64]float64{}, ask: map[float64]float64{}, next: firstTarget, cuts: map[int64]BinanceCut{}, reason: "starting"}, nil
}
func (b *BinanceBook) freezeBefore(at int64) {
	// Preserve at most three boundaries; skipped older samples are unavailable.
	if at-b.next > 3*60000 {
		b.next = ((at-1)/60000 - 2) * 60000
	}
	for b.next < at {
		t := b.next
		c := BinanceCut{T: t, LastDataAt: b.lastData, Last: b.last, Reason: b.reason}
		if b.ready && b.lastData > 0 && b.lastData <= t && t-b.lastData <= BinanceMaxAgeMS {
			d, e := mapDepth(b.bid, b.ask)
			if e == nil {
				c.Depth = d
				c.TrustedBid, c.TrustedAsk = trusted(d, b.bidEdge, b.askEdge)
				c.Reason = ""
			} else {
				c.Reason = "invalid_book"
			}
		} else if b.ready {
			c.Reason = "stale_depth"
		}
		b.cuts[t] = c
		delete(b.cuts, t-3*60000)
		b.next += 60000
	}
	for t := range b.cuts {
		if t < b.next-3*60000 {
			delete(b.cuts, t)
		}
	}
}
func (b *BinanceBook) clock(at int64) error {
	if at <= 0 || at < b.lastAt {
		b.ready = false
		b.reason = "non_monotonic_receive"
		return errors.New(b.reason)
	}
	b.freezeBefore(at)
	b.lastAt = at
	return nil
}
func (b *BinanceBook) Invalidate(at int64, reason string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if e := b.clock(at); e != nil {
		return e
	}
	b.ready = false
	b.reason = reason
	return nil
}
func (b *BinanceBook) Install(at int64, s BinanceSnapshot, ds []BinanceDelta, refresh bool) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if e := b.clock(at); e != nil {
		return e
	}
	updates, last, e := Bridge(s, ds)
	if e != nil {
		b.ready = false
		b.reason = "bridge_failed"
		return e
	}
	if refresh && (!b.ready || last < b.last) {
		b.ready = false
		b.reason = "refresh_sequence_regressed"
		return errors.New(b.reason)
	}
	bidEdge, askEdge := math.Inf(1), 0.0
	for _, l := range s.Bids {
		if l.Qty > 0 {
			bidEdge = math.Min(bidEdge, l.Price)
		}
	}
	for _, l := range s.Asks {
		if l.Qty > 0 {
			askEdge = math.Max(askEdge, l.Price)
		}
	}
	if !refresh {
		b.bid = map[float64]float64{}
		b.ask = map[float64]float64{}
	} else {
		for p := range b.bid {
			if p >= bidEdge {
				delete(b.bid, p)
			}
		}
		for p := range b.ask {
			if p <= askEdge {
				delete(b.ask, p)
			}
		}
	}
	applyLevels(b.bid, s.Bids)
	applyLevels(b.ask, s.Asks)
	for _, d := range updates {
		applyLevels(b.bid, d.Bids)
		applyLevels(b.ask, d.Asks)
	}
	b.last = last
	b.lastData = at
	b.refreshAt = at
	b.bidEdge = bidEdge
	b.askEdge = askEdge
	b.ready = true
	b.reason = ""
	d, e := mapDepth(b.bid, b.ask)
	if e != nil || len(b.bid)+len(b.ask) > maxBinanceLevels {
		b.ready = false
		b.reason = "invalid_or_oversize_book"
		return errors.New(b.reason)
	}
	tb, ta := trusted(d, bidEdge, askEdge)
	b.bidFloor = refreshFloor(*tb)
	b.askFloor = refreshFloor(*ta)
	return nil
}
func (b *BinanceBook) Delta(at int64, d BinanceDelta) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if e := b.clock(at); e != nil {
		return e
	}
	if !b.ready {
		return errors.New("book not ready")
	}
	if e := validDelta(d); e != nil {
		b.ready = false
		b.reason = "invalid_delta"
		return e
	}
	if d.Last <= b.last {
		return nil
	}
	if d.First > b.last+1 {
		b.ready = false
		b.reason = "sequence_gap"
		return fmt.Errorf("sequence gap U=%d last=%d", d.First, b.last)
	}
	applyLevels(b.bid, d.Bids)
	applyLevels(b.ask, d.Asks)
	b.last = d.Last
	b.lastData = at
	if len(b.bid)+len(b.ask) > maxBinanceLevels {
		b.ready = false
		b.reason = "oversize_book"
		return errors.New(b.reason)
	}
	return nil
}
func (b *BinanceBook) Cut(t, now int64) (BinanceCut, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if t%60000 != 0 || now <= t {
		return BinanceCut{}, errors.New("cut must finalize after target")
	}
	if now < b.lastAt {
		return BinanceCut{}, errors.New("finalize clock regressed")
	}
	b.freezeBefore(now)
	b.lastAt = now
	if c, ok := b.cuts[t]; ok {
		return c, nil
	}
	return BinanceCut{}, errors.New("cut unavailable or expired")
}
func (b *BinanceBook) RefreshReason(now int64) string {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.ready {
		return "not_ready"
	}
	d, e := mapDepth(b.bid, b.ask)
	if e != nil {
		return "book_side_depleted"
	}
	tb, ta := trusted(d, b.bidEdge, b.askEdge)
	if b.bidFloor > 0 && *tb < b.bidFloor {
		return "bid_headroom"
	}
	if b.askFloor > 0 && *ta < b.askFloor {
		return "ask_headroom"
	}
	if now-b.refreshAt >= BinanceRefreshMS {
		return "periodic_15m"
	}
	return ""
}
func refreshFloor(x float64) float64 {
	if x <= 0 {
		return 0
	}
	f := math.Min(25, math.Max(1, x*.25))
	if f >= x {
		f = x * .5
	}
	return f
}
func applyLevels(m map[float64]float64, ls []Level) {
	for _, l := range ls {
		if l.Qty == 0 {
			delete(m, l.Price)
		} else {
			m[l.Price] = l.Qty
		}
	}
}
func trusted(d Depth, bid, ask float64) (*float64, *float64) {
	mid := *d.Mid
	return model.Ptr(math.Max(0, (mid-bid)/mid*10000)), model.Ptr(math.Max(0, (ask-mid)/mid*10000))
}

// No copies or extra price maps on the minute cut. Maps are already validated.
func mapDepth(bids, asks map[float64]float64) (Depth, error) {
	var d Depth
	bb, minB, ba, maxA := 0.0, math.Inf(1), math.Inf(1), 0.0
	for p := range bids {
		bb = math.Max(bb, p)
		minB = math.Min(minB, p)
	}
	for p := range asks {
		ba = math.Min(ba, p)
		maxA = math.Max(maxA, p)
	}
	if bb <= 0 || !finite(ba) || bb >= ba {
		return d, errors.New("invalid BBO")
	}
	mid := (bb + ba) / 2
	if !finite(mid) {
		return d, errors.New("invalid mid")
	}
	bc, ac := (mid-minB)/mid*10000, (maxA-mid)/mid*10000
	d.Bid = model.Ptr(bb)
	d.Ask = model.Ptr(ba)
	d.Mid = model.Ptr(mid)
	d.ObservedBid = model.Ptr(bc)
	d.ObservedAsk = model.Ptr(ac)
	var bs, as [5]float64
	for p, q := range bids {
		dist := (mid - p) / mid * 10000
		for j := 0; j < 5; j++ {
			if dist >= bounds[j] && dist < bounds[j+1] {
				bs[j] += p * q
				break
			}
		}
	}
	for p, q := range asks {
		dist := (p - mid) / mid * 10000
		for j := 0; j < 5; j++ {
			if dist >= bounds[j] && dist < bounds[j+1] {
				as[j] += p * q
				break
			}
		}
	}
	for j := 0; j < 5; j++ {
		if !finite(bs[j]) || !finite(as[j]) {
			return Depth{}, errors.New("notional overflow")
		}
		if bc+1e-9 >= bounds[j+1] {
			d.Zones[j].Bid = model.Ptr(bs[j])
		}
		if ac+1e-9 >= bounds[j+1] {
			d.Zones[j].Ask = model.Ptr(as[j])
		}
	}
	return d, nil
}

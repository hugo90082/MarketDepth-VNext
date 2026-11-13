package futures

import (
	"errors"
	"sync"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// Window keeps just one predecessor plus the current and future (already
// received) buckets. Every asset has an independent bound. No late update can
// mutate a finalized bar; it must take the explicit REST repair path.
type Window struct {
	mu          sync.Mutex
	asset       string
	next        int64
	capacity    int
	trades      map[int64]Trade
	predecessor *Trade
	tainted     bool
	// clock/overflow/duplicate faults poison a bounded window, not silently discard.
	faultThrough int64
}

func NewWindow(asset string, first int64, capacity int) (*Window, error) {
	if !model.AssetOK(asset) || first < 0 || first%Interval10 != 0 || capacity < 2 || capacity > MaxWindowTrades-1 {
		return nil, errors.New("invalid futures window configuration")
	}
	return &Window{asset: asset, next: first, capacity: capacity, trades: map[int64]Trade{}}, nil
}
func (w *Window) mark(at int64) {
	w.tainted = true
	end := (at/Interval10 + 1) * Interval10
	if end > w.faultThrough {
		w.faultThrough = end
	}
	if w.next+Interval10 > w.faultThrough {
		w.faultThrough = w.next + Interval10
	}
}

// Invalidate marks uncertainty, even if ID coverage appears contiguous later.
func (w *Window) Invalidate(at int64) { w.mu.Lock(); defer w.mu.Unlock(); w.mark(at) }
func (w *Window) Add(x Trade) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if x.Asset != w.asset || !x.valid() {
		w.mark(x.Received)
		return errors.New("invalid buffered trade")
	}
	if x.T < w.next {
		// Old replay can supply the initial predecessor. Once a bar has finalized,
		// a later arrival remains diagnostic only; future REST must repair it.
		if w.predecessor == nil || x.ID > w.predecessor.ID {
			v := x
			w.predecessor = &v
		} else if x.ID == w.predecessor.ID && !x.same(*w.predecessor) {
			w.mark(x.Received)
			return errors.New("conflicting predecessor")
		}
		return nil
	}
	if p, ok := w.trades[x.ID]; ok {
		if !p.same(x) {
			w.mark(x.Received)
			return errors.New("conflicting aggregate duplicate")
		}
		return nil
	}
	if len(w.trades) >= w.capacity {
		w.mark(x.Received)
		return errors.New("futures window capacity exceeded")
	}
	w.trades[x.ID] = x
	return nil
}

// Finalize advances exactly one bucket. A caller waking late must advance each
// elapsed bucket or mark it missing, not silently skip the time grid.
func (w *Window) Finalize(t, available int64) (model.Futures10Row, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if t != w.next || available < t+Interval10 {
		return model.Futures10Row{}, errors.New("unexpected or unclosed futures bucket")
	}
	trades := make([]Trade, 0, len(w.trades)+1)
	if w.predecessor != nil {
		trades = append(trades, *w.predecessor)
	}
	for _, x := range w.trades {
		trades = append(trades, x)
	}
	row, e := BuildBar(w.asset, t, available, trades, !w.tainted || t >= w.faultThrough)
	if e != nil {
		return row, e
	}
	end := t + Interval10
	for id, x := range w.trades {
		if x.T < end {
			if x.Received <= available && (w.predecessor == nil || x.ID > w.predecessor.ID) {
				v := x
				w.predecessor = &v
			}
			delete(w.trades, id)
		}
	}
	w.next = end
	if w.tainted && w.next >= w.faultThrough {
		w.tainted = false
	}
	return row, nil
}

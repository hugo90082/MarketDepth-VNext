package futures

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

// RecoverySource is public market data only. The worker re-discovers targets
// from committed SQLite rows after restart, not from a volatile task queue.
type RecoverySource interface {
	Recover1m(context.Context, string, int64, int64) (model.Futures1Row, error)
	Recover10(context.Context, string, int64, int64, *int64) (model.Futures10Row, error)
}

type repairKey struct {
	kind     model.Kind
	key      model.Key
	revision int64
}
type retryState struct {
	attempts int
	next     int64
}
type RepairStats struct{ Attempted, Recovered, Deferred, Failed int }

// RepairWorker performs short bounded cycles; run only under the coordinator.
// It never manufactures rows for absent spot or absent time-grid keys.
// Sealed/out-of-grace days remain immutable. Limits are deployment defaults.
type RepairWorker struct {
	mu      sync.Mutex
	reader  store.Reader
	writer  store.Writer
	source  RecoverySource
	now     func() time.Time
	retries map[repairKey]retryState
}

func NewRepairWorker(r store.Reader, w store.Writer, s RecoverySource) (*RepairWorker, error) {
	if r == nil || w == nil || s == nil {
		return nil, errors.New("repair dependencies required")
	}
	return &RepairWorker{reader: r, writer: w, source: s, now: time.Now, retries: map[repairKey]retryState{}}, nil
}
func eligible(t int64, k model.Kind, now int64) bool {
	// Leave 30s before retrying; leave a minute of grace for network and commit.
	if t+k.Interval()+30000 > now || t < now-10*60000 {
		return false
	}
	if model.Day(t) == model.Day(now) {
		return true
	}
	return model.Day(t) == model.Day(now-4*60000)
}
func (w *RepairWorker) Cycle(ctx context.Context) (RepairStats, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	var stats RepairStats
	now := w.now().UnixMilli()
	for k := range w.retries {
		if !eligible(k.key.T, k.kind, now) {
			delete(w.retries, k)
		}
	}
	// Per cycle maximum 3 official minutes and 1 expensive aggTrade recovery.
	for _, k := range []model.Kind{model.F1, model.F10} {
		if e := ctx.Err(); e != nil {
			return stats, e
		}
		to := now - now%k.Interval()
		from := to - 10*60000
		if from < 0 {
			from = 0
		}
		p, e := w.reader.History(ctx, store.Query{Kind: k, From: from, To: to, Limit: 2000})
		if e != nil {
			return stats, e
		}
		if !p.Complete || p.Next != "" {
			return stats, errors.New("unexpected repair query pagination")
		}
		sort.SliceStable(p.Rows, func(i, j int) bool { return p.Rows[i].Key().T < p.Rows[j].Key().T })
		budget := 3
		if k == model.F10 {
			budget = 1
		}
		for _, r := range p.Rows {
			if budget == 0 {
				break
			}
			c := r.Base()
			if r.Kind() != k || c.Revision < 1 || c.Source == nil || *c.Source != model.LiveSource || !eligible(c.T, k, w.now().UnixMilli()) || (c.Status != "missing" && c.Status != "partial") {
				continue
			}
			key := repairKey{k, r.Key(), c.Revision}
			retry := w.retries[key]
			if retry.attempts >= 3 || retry.next > w.now().UnixMilli() {
				stats.Deferred++
				continue
			}
			budget--
			stats.Attempted++
			var fixed model.Row
			// One network recovery at a time; a cycle cannot pile up pending tasks.
			task, cancel := context.WithTimeout(ctx, 30*time.Second)
			if k == model.F1 {
				fixed, e = w.source.Recover1m(task, c.Asset, c.T, c.Revision)
			} else {
				fixed, e = w.source.Recover10(task, c.Asset, c.T, c.Revision, nil)
			}
			cancel()
			if e != nil {
				retry.attempts++
				retry.next = w.now().Add(time.Duration(retry.attempts) * time.Minute).UnixMilli()
				w.retries[key] = retry
				stats.Failed++
				if ctx.Err() != nil {
					return stats, ctx.Err()
				}
				continue
			}
			if fixed == nil || fixed.Kind() != k || fixed.Key() != r.Key() || fixed.Base().Revision != c.Revision+1 || fixed.Base().Status != "recovered" || fixed.Validate() != nil {
				return stats, errors.New("invalid recovery result")
			}
			// A response can arrive after eligibility expired; do not stage stale intent.
			if !eligible(c.T, k, w.now().UnixMilli()) {
				stats.Deferred++
				continue
			}
			if e = w.writer.Put(ctx, []model.Row{fixed}); e != nil {
				return stats, fmt.Errorf("repair commit: %w", e)
			}
			delete(w.retries, key)
			stats.Recovered++
		}
	}
	return stats, nil
}

// Package service coordinates the independent feeds and single writer. It
// never deploys a service or deletes historical files.
package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

// GuardedWriter applies conservative admission checks before any journal intent.
// No reclaim is attempted; until remote verification exists, stop rather than
// delete data. The reserve is not an OS quota and is subject to live QA.
const WriteReserve int64 = 32_000_000
const MinRootFree int64 = 1_000_000_000

var ErrCapacity = errors.New("capacity admission refused; no data deleted")

type Meter func() (used, free int64, err error)
type GuardedWriter struct {
	mu     sync.Mutex
	writer store.Writer
	meter  Meter
}

func NewGuardedWriter(w store.Writer, m Meter) (*GuardedWriter, error) {
	if w == nil || m == nil {
		return nil, errors.New("writer and capacity meter required")
	}
	return &GuardedWriter{writer: w, meter: m}, nil
}
func (w *GuardedWriter) Put(ctx context.Context, rows []model.Row) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if e := ctx.Err(); e != nil {
		return e
	}
	if len(rows) > 12 {
		return errors.New("live service batch exceeds 12 rows")
	}
	used, free, e := w.meter()
	if e != nil {
		return fmt.Errorf("capacity measurement: %w", e)
	}
	if used < 0 || free < 0 || used >= archive.HighWater-WriteReserve || free < MinRootFree+WriteReserve {
		return ErrCapacity
	}
	if e = w.writer.Put(ctx, rows); e != nil {
		return e
	}
	// Detect unexpected growth immediately. A returned error here means commit
	// MAY have succeeded; the supervisor stops, never regenerates the row.
	used, free, e = w.meter()
	if e != nil {
		return fmt.Errorf("post-commit capacity measurement: %w", e)
	}
	if used < 0 || free < 0 || used >= archive.HardLimit || free < MinRootFree {
		return ErrCapacity
	}
	return nil
}

// RunGroup cancels siblings on unexpected worker exit/failure and waits for
// all of them before resources are closed. No automatic retry of a failed
// write, because commit outcome can be ambiguous.
type Worker func(context.Context) error

func RunGroup(ctx context.Context, workers ...Worker) error {
	if len(workers) == 0 {
		return errors.New("workers required")
	}
	for _, w := range workers {
		if w == nil {
			return errors.New("nil worker")
		}
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan error, len(workers))
	for _, w := range workers {
		go func(w Worker) { done <- w(ctx) }(w)
	}
	var first error
	for range workers {
		e := <-done
		if ctx.Err() == nil {
			if e == nil {
				e = errors.New("worker exited unexpectedly")
			}
			first = e
			cancel()
		} else if first == nil && e != nil && !errors.Is(e, context.Canceled) {
			first = e
		}
	}
	return first
}

// WaitUntil preserves the target grid. It never shifts a timestamp to now.
func WaitUntil(ctx context.Context, t time.Time) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	d := time.Until(t)
	if d <= 0 {
		return nil
	}
	tm := time.NewTimer(d)
	defer tm.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-tm.C:
		return nil
	}
}

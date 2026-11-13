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

// CapacityGate serializes allocation admission with live writes. Only one
// optional job may reserve space. The full reservation is counted even after
// some of its bytes are allocated (conservative double accounting). It is
// not a kernel disk quota and never authorizes removal of daily data.
type CapacityGate struct {
	mu       sync.Mutex
	meter    Meter
	reserved int64
}

func NewCapacityGate(m Meter) (*CapacityGate, error) {
	if m == nil {
		return nil, errors.New("capacity meter required")
	}
	return &CapacityGate{meter: m}, nil
}
func (g *CapacityGate) Reserve(ctx context.Context, n int64) (func(), error) {
	if n <= 0 || n > (archive.HighWater-WriteReserve)/2 {
		return nil, ErrCapacity
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	if g.reserved != 0 {
		return nil, ErrCapacity
	}
	used, free, e := g.meter()
	if e != nil {
		return nil, fmt.Errorf("capacity measurement: %w", e)
	}
	if used < 0 || free < 0 || used >= archive.HighWater-WriteReserve-2*n || free < MinRootFree+WriteReserve+2*n {
		return nil, ErrCapacity
	}
	g.reserved = n
	var once sync.Once
	return func() { once.Do(func() { g.mu.Lock(); defer g.mu.Unlock(); g.reserved = 0 }) }, nil
}

type GuardedWriter struct {
	writer store.Writer
	gate   *CapacityGate
}

func NewGuardedWriter(w store.Writer, m Meter) (*GuardedWriter, error) {
	g, e := NewCapacityGate(m)
	if e != nil {
		return nil, e
	}
	return NewSharedGuardedWriter(w, g)
}
func NewSharedGuardedWriter(w store.Writer, g *CapacityGate) (*GuardedWriter, error) {
	if w == nil || g == nil {
		return nil, errors.New("writer and capacity gate required")
	}
	return &GuardedWriter{writer: w, gate: g}, nil
}
func (w *GuardedWriter) Put(ctx context.Context, rows []model.Row) error {
	g := w.gate
	g.mu.Lock()
	defer g.mu.Unlock()
	if e := ctx.Err(); e != nil {
		return e
	}
	if len(rows) > 12 {
		return errors.New("live service batch exceeds 12 rows")
	}
	used, free, e := g.meter()
	if e != nil {
		return fmt.Errorf("capacity measurement: %w", e)
	}
	if used < 0 || free < 0 || used >= archive.HighWater-WriteReserve-g.reserved || free < MinRootFree+WriteReserve+g.reserved {
		return ErrCapacity
	}
	if e = w.writer.Put(ctx, rows); e != nil {
		return e
	}
	// A returned error here means commit MAY have succeeded; stop, never regenerate.
	used, free, e = g.meter()
	if e != nil {
		return fmt.Errorf("post-commit capacity measurement: %w", e)
	}
	if used < 0 || free < 0 || used >= archive.HardLimit-g.reserved || free < MinRootFree+g.reserved {
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

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
	emergency bool
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
	wait time.Duration
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
// NewWaitingGuardedWriter retries only a pre-admission refusal, before the
// journal has seen the batch. The caller's immutable queued rows are reused;
// ambiguous post-commit failures are never retried. The wait is bounded so
// collection does not accumulate stale observations indefinitely.
func NewWaitingGuardedWriter(w store.Writer,g *CapacityGate,wait time.Duration)(*GuardedWriter,error){
 if wait<=0||wait>60*time.Second{return nil,errors.New("invalid capacity wait")}
 x,e:=NewSharedGuardedWriter(w,g);if e!=nil{return nil,e}
 x.wait=wait
 return x,nil
}
func (w *GuardedWriter) Put(ctx context.Context,rows []model.Row)error{
 deadline:=time.Now().Add(w.wait)
 for{
  before,e:=w.tryPut(ctx,rows)
  if !before||!errors.Is(e,ErrCapacity)||w.wait==0{return e}
  next:=time.Now().Add(200*time.Millisecond)
  if next.After(deadline){return e}
  if err:=WaitUntil(ctx,next);err!=nil{return err}
 }
}
func(w *GuardedWriter) tryPut(ctx context.Context,rows []model.Row)(bool,error){
 g:=w.gate
 g.mu.Lock()
 defer g.mu.Unlock()
 if e:=ctx.Err();e!=nil{return false,e}
 if len(rows)>12{return false,errors.New("live service batch exceeds 12 rows")}
 used,free,e:=g.meter()
 if e!=nil{return false,fmt.Errorf("capacity measurement: %w",e)}
 if g.emergency||used<0||free<0||used>=archive.HighWater-WriteReserve-g.reserved||free<MinRootFree+WriteReserve+g.reserved{return true,ErrCapacity}
 if e=w.writer.Put(ctx,rows);e!=nil{return false,e}
 used,free,e=g.meter()
 if e!=nil{return false,fmt.Errorf("post-commit capacity measurement: %w",e)}
 if used<0||free<0||used>=archive.HardLimit-g.reserved||free<MinRootFree+g.reserved{return false,ErrCapacity}
 return false,nil
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

// LossReserve covers the small durable ledger and one day's journal
// mutation/checkpoint. Actual full-day WAL allocation must be measured in
// isolated QA. Emergency work is admitted only with hard-cap and root
// headroom, not by bypassing the 1GB limit.
const LossReserve int64 = 32_000_000
type CapacityStatus struct{ Used,Free,Reserved int64 }
func(g *CapacityGate) Status()(CapacityStatus,error){
 g.mu.Lock();defer g.mu.Unlock()
 u,f,e:=g.meter()
 if e!=nil{return CapacityStatus{},e}
 if u<0||f<0{return CapacityStatus{},ErrCapacity}
 return CapacityStatus{u,f,g.reserved},nil
}
func(s CapacityStatus) NeedsForce()bool{
 // Include both collector and emergency mutation headroom. This is
 // projected pressure, not a new lower hard limit.
 return s.Reserved==0&&(s.Used>=archive.HighWater-WriteReserve-LossReserve||s.Free<MinRootFree+WriteReserve+2*LossReserve)
}
func(g *CapacityGate) ReserveEmergency(ctx context.Context,n int64)(func(),error){
 if n<=0||n>LossReserve{return nil,ErrCapacity}
 g.mu.Lock();defer g.mu.Unlock()
 if e:=ctx.Err();e!=nil{return nil,e}
 if g.reserved!=0{return nil,ErrCapacity}
 used,free,e:=g.meter()
 if e!=nil{return nil,e}
 if used<0||free<0||used>=archive.HardLimit-2*n||free<MinRootFree+2*n{return nil,ErrCapacity}
 g.reserved=n
 g.emergency=true
 var once sync.Once
 return func(){once.Do(func(){g.mu.Lock();defer g.mu.Unlock();g.reserved=0;g.emergency=false})},nil
}

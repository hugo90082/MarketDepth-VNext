package service

import (
	"context"
	"errors"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"testing"
	"time"
)

type fakeWriter struct{ calls int }

func (w *fakeWriter) Put(context.Context, []model.Row) error { w.calls++; return nil }
func TestGuardBeforeAndAfter(t *testing.T) {
	for _, tc := range []struct {
		before, after, free int64
		calls               int
		wantErr             bool
	}{{0, 0, 2e9, 1, false}, {archive.HighWater - WriteReserve, 0, 2e9, 0, true}, {0, archive.HardLimit, 2e9, 1, true}, {0, 0, 1, 0, true}} {
		w := &fakeWriter{}
		n := 0
		g, e := NewGuardedWriter(w, func() (int64, int64, error) {
			n++
			if n == 1 {
				return tc.before, tc.free, nil
			}
			return tc.after, tc.free, nil
		})
		if e != nil {
			t.Fatal(e)
		}
		e = g.Put(context.Background(), nil)
		if (e != nil) != tc.wantErr || w.calls != tc.calls {
			t.Fatal(tc, e, w.calls)
		}
	}
}
func TestGroupStopsSibling(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	boom := errors.New("writer failed")
	stopped := make(chan struct{})
	e := RunGroup(ctx, func(context.Context) error { return boom }, func(ctx context.Context) error { <-ctx.Done(); close(stopped); return ctx.Err() })
	if !errors.Is(e, boom) {
		t.Fatal(e)
	}
	select {
	case <-stopped:
	default:
		t.Fatal("sibling not joined")
	}
}

func TestSharedCapacityGate(t *testing.T) {
	ctx := context.Background()
	used, free := int64(100_000_000), int64(2_000_000_000)
	g, e := NewCapacityGate(func() (int64, int64, error) { return used, free, nil })
	if e != nil {
		t.Fatal(e)
	}
	w := &fakeWriter{}
	writer, e := NewSharedGuardedWriter(w, g)
	if e != nil {
		t.Fatal(e)
	}
	rel, e := g.Reserve(ctx, 100_000_000)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = g.Reserve(ctx, 1); !errors.Is(e, ErrCapacity) {
		t.Fatal("second optional job", e)
	}
	if e = writer.Put(ctx, nil); e != nil {
		t.Fatal(e)
	}
	used = archive.HighWater - WriteReserve - 100_000_000
	if e = writer.Put(ctx, nil); !errors.Is(e, ErrCapacity) {
		t.Fatal("reserved capacity ignored", e)
	}
	rel()
	rel()
	if e = writer.Put(ctx, nil); e != nil {
		t.Fatal("reservation not released", e)
	}
	if _, e = g.Reserve(ctx, 100_000_000); !errors.Is(e, ErrCapacity) {
		t.Fatal("double accounting not enforced", e)
	}
}

func TestEmergencyCapacityReservation(t *testing.T){
 ctx:=context.Background()
 used,free:=archive.HighWater-WriteReserve-LossReserve,int64(2_000_000_000)
 g,e:=NewCapacityGate(func()(int64,int64,error){return used,free,nil});if e!=nil{t.Fatal(e)}
 s,e:=g.Status();if e!=nil||!s.NeedsForce(){t.Fatal(s,e)}
 if _,e=g.Reserve(ctx,LossReserve);!errors.Is(e,ErrCapacity){t.Fatal("normal optional reserve at pressure",e)}
 release,e:=g.ReserveEmergency(ctx,LossReserve);if e!=nil{t.Fatal(e)}
 if _,e=g.ReserveEmergency(ctx,1);!errors.Is(e,ErrCapacity){t.Fatal("two emergency jobs",e)}
 release();release()
 used=archive.HardLimit-2*LossReserve
 if _,e=g.ReserveEmergency(ctx,LossReserve);!errors.Is(e,ErrCapacity){t.Fatal("hard limit ignored",e)}
 used=0;free=MinRootFree+2*LossReserve-1
 if _,e=g.ReserveEmergency(ctx,LossReserve);!errors.Is(e,ErrCapacity){t.Fatal("root reserve ignored",e)}
}

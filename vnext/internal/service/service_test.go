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

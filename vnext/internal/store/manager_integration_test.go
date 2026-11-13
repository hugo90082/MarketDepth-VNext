//go:build linux && sqlite_integration

package store

import (
	"context"
	"errors"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestManagerCrossDayAndLock(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "live")
	taipei := time.FixedZone("UTC+8", 8*3600)
	boundary := time.Date(2026, 11, 14, 0, 0, 0, 0, taipei).UnixMilli()
	now := time.UnixMilli(boundary + 2000)
	clock := func() time.Time { return now }
	m, e := newManager(root, SQLiteOpener, clock, 5*time.Minute)
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close()
	if other, e := NewManager(root, SQLiteOpener); e == nil {
		other.Close()
		t.Fatal("second writer allowed")
	}
	a := liveRows()[0].(model.SpotRow)
	a.T = boundary - 60000
	a.AvailableAt = model.Ptr(a.T + 1000)
	b := a
	b.T = boundary
	b.AvailableAt = model.Ptr(b.T + 1000)
	if e = m.Put(ctx, []model.Row{a, b}); e == nil {
		t.Fatal("cross-day batch accepted")
	}
	if _, e = os.Stat(filepath.Join(root, model.Day(a.T)+".sqlite")); !errors.Is(e, os.ErrNotExist) {
		t.Fatal("preflight created DB", e)
	}
	if e = m.Put(ctx, []model.Row{a}); e != nil {
		t.Fatal(e)
	}
	if e = m.Put(ctx, []model.Row{b}); e != nil {
		t.Fatal(e)
	}
	for _, r := range []model.SpotRow{a, b} {
		if got, e := m.Get(ctx, model.Spot, r.Key()); e != nil || got.Key() != r.Key() {
			t.Fatal(got, e)
		}
	}
	key := b.Key()
	key.T += 86400000
	if _, e = m.Get(ctx, model.Spot, key); !errors.Is(e, os.ErrNotExist) {
		t.Fatal("absent day", e)
	}
	if _, e = os.Stat(filepath.Join(root, model.Day(key.T)+".sqlite")); !errors.Is(e, os.ErrNotExist) {
		t.Fatal("read created day", e)
	}
	if e = m.Close(); e != nil {
		t.Fatal(e)
	}
	m2, e := newManager(root, SQLiteOpener, clock, 5*time.Minute)
	if e != nil {
		t.Fatal(e)
	}
	defer m2.Close()
	if e = m2.Put(ctx, []model.Row{a}); e != nil {
		t.Fatal("reopen retry", e)
	}
	if e = m2.Put(ctx, []model.Row{b}); e != nil {
		t.Fatal("reopen next day", e)
	}
	now = now.Add(6 * time.Minute)
	if e = m2.Put(ctx, []model.Row{a}); e == nil {
		t.Fatal("expired previous day accepted")
	}
}

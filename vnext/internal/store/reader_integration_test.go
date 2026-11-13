//go:build linux && sqlite_integration

package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func TestDurableHistoryStablePaginationAndScopedInvalidation(t *testing.T) {
	ctx := context.Background()
	old := liveRows()[0].(model.SpotRow)
	now := time.UnixMilli(old.T + 180000)
	m, e := newManager(filepath.Join(t.TempDir(), "live"), SQLiteOpener, func() time.Time { return now }, 5*time.Minute)
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close()
	j, e := m.OpenCatalog(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer j.Close()
	second := old
	second.Venue = "coinbase"
	third := old
	third.Venue = "kraken"
	if e = j.Put(ctx, []model.Row{third, old, second}); e != nil {
		t.Fatal(e)
	}
	q := Query{Kind: model.Spot, From: old.T, To: old.T + 60000, Limit: 1, Asset: "BTC"}
	p, e := j.History(ctx, q)
	if e != nil || p.Complete || len(p.Rows) != 1 || p.Rows[0].Key().Venue != "binance" || len(p.Gaps) != 1 {
		t.Fatal(p, e)
	}
	q.Cursor = p.Next
	outside := old
	outside.T += 60000
	outside.AvailableAt = model.Ptr(outside.T + 1000)
	if e = j.Put(ctx, []model.Row{outside}); e != nil {
		t.Fatal(e)
	}
	p, e = j.History(ctx, q)
	if e != nil || len(p.Rows) != 1 || p.Rows[0].Key().Venue != "coinbase" {
		t.Fatal(p, e)
	}
	q.Cursor = p.Next
	p, e = j.History(ctx, q)
	if e != nil || len(p.Rows) != 1 || !p.Complete || p.Rows[0].Key().Venue != "kraken" {
		t.Fatal(p, e)
	}
	fourth := old
	fourth.Venue = "bitfinex"
	if e = j.Put(ctx, []model.Row{fourth}); e != nil {
		t.Fatal(e)
	}
	if _, e = j.History(ctx, q); !errors.Is(e, ErrResync) {
		t.Fatal("within range insertion not invalidated", e)
	}
	q.Cursor = ""
	q.Limit = 2000
	p, e = j.History(ctx, q)
	if e != nil || len(p.Gaps) != 0 || len(p.Rows) != 4 {
		t.Fatal(p, e)
	}
	latest, e := j.Latest(ctx, model.Spot)
	if e != nil || len(latest) != 1 || latest[0].Key().T != outside.T {
		t.Fatal(latest, e)
	}
	day := model.Day(old.T)
	ds, e := j.Days(ctx, day, day)
	if e != nil || len(ds) != 1 || ds[0].State != "active_local" || ds[0].Counts[model.Spot] != 5 {
		t.Fatal(ds, e)
	}
}
func TestDurableHistoryRepairInvalidatesCursor(t *testing.T) {
	ctx := context.Background()
	old := liveRows()[2].(model.Futures1Row)
	now := time.UnixMilli(old.T + 180000)
	m, e := newManager(filepath.Join(t.TempDir(), "live"), SQLiteOpener, func() time.Time { return now }, 5*time.Minute)
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close()
	j, e := m.OpenCatalog(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer j.Close()
	second := old
	second.Asset = "SOL"
	if e = j.Put(ctx, []model.Row{old, second}); e != nil {
		t.Fatal(e)
	}
	q := Query{Kind: model.F1, From: old.T, To: old.T + 60000, Limit: 1}
	p, e := j.History(ctx, q)
	if e != nil || p.Next == "" {
		t.Fatal(p, e)
	}
	q.Cursor = p.Next
	if e = j.Put(ctx, []model.Row{repairedKline(old, now.UnixMilli())}); e != nil {
		t.Fatal(e)
	}
	if _, e = j.History(ctx, q); !errors.Is(e, ErrResync) {
		t.Fatal(e)
	}
	q.Cursor = ""
	q.Limit = 10
	p, e = j.History(ctx, q)
	if e != nil || len(p.Rows) != 2 || p.Rows[0].Base().Revision != 2 {
		t.Fatal(p, e)
	}
}

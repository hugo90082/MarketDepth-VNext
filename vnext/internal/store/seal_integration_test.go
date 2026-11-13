//go:build linux && sqlite_integration

package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func TestDaySealGraceAndRetry(t *testing.T) {
	ctx := context.Background()
	loc := time.FixedZone("UTC+8", 8*3600)
	boundary := time.Date(2026, 11, 14, 0, 0, 0, 0, loc)
	now := boundary.Add(2 * time.Minute)
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
	a := liveRows()[0].(model.SpotRow)
	a.T = boundary.Add(-time.Minute).UnixMilli()
	a.AvailableAt = model.Ptr(a.T + 1000)
	if e = j.Put(ctx, []model.Row{a}); e != nil {
		t.Fatal(e)
	}
	day := model.Day(a.T)
	if _, e = j.SealDay(ctx, day, "test"); e == nil {
		t.Fatal("sealed within grace")
	}
	b := a
	b.Venue = "coinbase"
	payload, e := journalPayload([]model.Row{b})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = j.db.ExecContext(ctx, `INSERT INTO journal_intent VALUES(1,?)`, payload); e != nil {
		t.Fatal(e)
	}
	if _, e = j.SealDay(ctx, day, "test"); !errors.Is(e, ErrPendingWrite) {
		t.Fatal("pending not blocked", e)
	}
	if e = j.Recover(ctx); e != nil {
		t.Fatal(e)
	}
	now = boundary.Add(6 * time.Minute)
	if _, e = m.SealDay(ctx, day, "test"); e == nil {
		t.Fatal("direct seal bypass")
	}
	sealed, e := j.SealDay(ctx, day, "test")
	if e != nil || sealed.SealedAt != now.UnixMilli() || sealed.Revision != 1 {
		t.Fatal(sealed, e)
	}
	now = now.Add(time.Minute)
	retry, e := j.SealDay(ctx, day, "other")
	if e != nil || retry != sealed {
		t.Fatal(retry, e)
	}
	// Repeated committed rows can be acknowledged, new old-day rows cannot.
	stage := filepath.Join(t.TempDir(), "stage")
	if e = os.Mkdir(stage, 0700); e != nil {
		t.Fatal(e)
	}
	snap, e := m.CreateSnapshot(ctx, day, stage, "sealed-g1", "other", 20_000_000)
	if e != nil || snap.Manifest.SealedAt == nil || *snap.Manifest.SealedAt != sealed.SealedAt || snap.Manifest.ProducerCommit != "test" || snap.Manifest.MissingGridCounts[string(model.Spot)] != 17278 || snap.Manifest.DataOrigin != "live" {
		t.Fatal(snap, e)
	}
	if e = j.Put(ctx, []model.Row{a, b}); e != nil {
		t.Fatal("identical sealed replay", e)
	}
	c := a
	c.T = boundary.UnixMilli()
	c.AvailableAt = model.Ptr(c.T + 1000)
	if e = j.Put(ctx, []model.Row{c}); e != nil {
		t.Fatal("current writer after seal", e)
	}
	p, e := j.Sync(ctx, model.Spot, "")
	if e != nil || len(p.Rows) != 3 {
		t.Fatal(p, e)
	}
}

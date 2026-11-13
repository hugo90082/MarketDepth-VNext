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

func TestDurableJournalRestartAndRecovery(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "live")
	rows := liveRows()
	now := time.UnixMilli(rows[0].Key().T + 120000)
	open := func() (*Manager, *Journal) {
		m, e := newManager(root, SQLiteOpener, func() time.Time { return now }, 5*time.Minute)
		if e != nil {
			t.Fatal(e)
		}
		j, e := m.OpenCatalog(ctx)
		if e != nil {
			m.Close()
			t.Fatal(e)
		}
		return m, j
	}
	m, j := open()
	if e := j.Put(ctx, rows); e != nil {
		t.Fatal(e)
	}
	p, e := j.Sync(ctx, model.Spot, "")
	if e != nil || len(p.Rows) != 1 || !p.Complete {
		t.Fatal(p, e)
	}
	cursor := p.Next
	if e = j.Put(ctx, rows); e != nil {
		t.Fatal(e)
	}
	p, e = j.Sync(ctx, model.Spot, cursor)
	if e != nil || len(p.Rows) != 0 {
		t.Fatal(p, e)
	}
	// Simulate crash after daily DB commit but before catalog publication.
	a := rows[0].(model.SpotRow)
	a.Venue = "coinbase"
	batch := []model.Row{a}
	payload, e := journalPayload(batch)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = j.db.ExecContext(ctx, `INSERT INTO journal_intent VALUES(1,?)`, payload); e != nil {
		t.Fatal(e)
	}
	if e = m.Put(ctx, batch); e == nil {
		t.Fatal("catalog bypass allowed")
	}
	if e = m.put(ctx, batch, true); e != nil {
		t.Fatal(e)
	}
	if _, e = j.Sync(ctx, model.Spot, cursor); !errors.Is(e, ErrPendingWrite) {
		t.Fatal("pending published", e)
	}
	if e = j.Close(); e != nil {
		t.Fatal(e)
	}
	if e = m.Close(); e != nil {
		t.Fatal(e)
	}
	// Even outside grace, a committed row can be published after exact readback.
	now = now.Add(48 * time.Hour)
	m, j = open()
	defer m.Close()
	defer j.Close()
	if e = j.Recover(ctx); e != nil {
		t.Fatal(e)
	}
	p, e = j.Sync(ctx, model.Spot, cursor)
	if e != nil || len(p.Rows) != 1 || p.Rows[0].Key() != a.Key() {
		t.Fatal(p, e)
	}
	if e = j.Put(ctx, batch); e != nil {
		t.Fatal("expired identical retry", e)
	}
	p, e = j.Sync(ctx, model.Spot, p.Next)
	if e != nil || len(p.Rows) != 0 {
		t.Fatal(p, e)
	}
	a.Bid0100 = model.Ptr(123.0)
	if e = j.Put(ctx, []model.Row{a}); e == nil {
		t.Fatal("conflict accepted")
	}
	if b, e := j.pending(ctx); e != nil || b != nil {
		t.Fatal("conflict staged", e)
	}
	if _, e = j.Sync(ctx, model.F10, cursor); !errors.Is(e, ErrResync) {
		t.Fatal("cross-kind cursor", e)
	}
}
func TestJournalIntentBeforeDailyCommit(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "live")
	rows := liveRows()
	now := time.UnixMilli(rows[0].Key().T + 120000)
	m, e := newManager(root, SQLiteOpener, func() time.Time { return now }, 5*time.Minute)
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close()
	j, e := m.OpenCatalog(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer j.Close()
	b, e := journalPayload(rows)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = j.db.ExecContext(ctx, `INSERT INTO journal_intent VALUES(1,?)`, b); e != nil {
		t.Fatal(e)
	}
	if e = j.Recover(ctx); e != nil {
		t.Fatal(e)
	}
	for _, k := range []model.Kind{model.Spot, model.F10, model.F1} {
		p, e := j.Sync(ctx, k, "")
		if e != nil || len(p.Rows) != 1 {
			t.Fatal(k, p, e)
		}
	}
}
func TestCatalogRequiresExplicitBootstrap(t *testing.T) {
	ctx := context.Background()
	rows := liveRows()
	now := time.UnixMilli(rows[0].Key().T + 120000)
	m, e := newManager(filepath.Join(t.TempDir(), "live"), SQLiteOpener, func() time.Time { return now }, 5*time.Minute)
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close()
	if e = m.Put(ctx, rows); e != nil {
		t.Fatal(e)
	}
	if j, e := m.OpenCatalog(ctx); e == nil {
		j.Close()
		t.Fatal("silent bootstrap")
	}
}

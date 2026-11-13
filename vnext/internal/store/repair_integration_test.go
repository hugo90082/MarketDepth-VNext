//go:build linux && sqlite_integration

package store

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func repairedKline(old model.Futures1Row, at int64) model.Futures1Row {
	p := model.Ptr(100.0)
	z := model.Ptr(0.0)
	q := model.Ptr(1.0)
	old.OHLC = model.OHLC{Open: p, High: p, Low: p, Close: p}
	old.Volume = q
	old.QuoteVolume = p
	old.TakerBuyQty = z
	old.TakerBuyUSDT = z
	old.TradeCount = model.Ptr(int64(1))
	old.AvailableAt = model.Ptr(at)
	old.Revision++
	old.Status = "recovered"
	b, _ := json.Marshal(map[string]any{"repair_method": "official_rest_1m", "repair_complete": true, "retrieved_at": at})
	old.Quality = model.Ptr(string(b))
	return old
}
func TestJournalRepairAndLatestSync(t *testing.T) {
	ctx := context.Background()
	old := liveRows()[2].(model.Futures1Row)
	now := time.UnixMilli(old.T + 180000)
	root := filepath.Join(t.TempDir(), "live")
	open := func() (*Manager, *Journal) {
		m, e := newManager(root, SQLiteOpener, func() time.Time { return now }, 5*time.Minute)
		if e != nil {
			t.Fatal(e)
		}
		j, e := m.OpenCatalog(ctx)
		if e != nil {
			t.Fatal(e)
		}
		return m, j
	}
	m, j := open()
	if e := j.Put(ctx, []model.Row{old}); e != nil {
		t.Fatal(e)
	}
	initial, e := j.Sync(ctx, model.F1, "")
	if e != nil || len(initial.Rows) != 1 {
		t.Fatal(initial, e)
	}
	next := repairedKline(old, now.UnixMilli())
	bad := next
	bad.Quality = nil
	if e = j.Put(ctx, []model.Row{bad}); e == nil {
		t.Fatal("unproven repair")
	}
	bad = next
	bad.Revision = 3
	if e = j.Put(ctx, []model.Row{bad}); e == nil {
		t.Fatal("skipped revision")
	}
	bad = next
	bad.AvailableAt = model.Ptr(now.UnixMilli() + 1)
	if e = j.Put(ctx, []model.Row{bad}); e == nil {
		t.Fatal("future repair")
	}
	if p, e := j.pending(ctx); e != nil || p != nil {
		t.Fatal("rejected repair poisoned catalog", e)
	}
	if e = j.Put(ctx, []model.Row{next}); e != nil {
		t.Fatal(e)
	}
	if e = j.Put(ctx, []model.Row{next}); e != nil {
		t.Fatal("retry", e)
	}
	for _, cursor := range []string{"", initial.Next} {
		p, e := j.Sync(ctx, model.F1, cursor)
		if e != nil || len(p.Rows) != 1 || p.Rows[0].Base().Revision != 2 {
			t.Fatal(p, e)
		}
	}
	var raw []byte
	if e = j.db.QueryRowContext(ctx, "SELECT old_row FROM journal_repair").Scan(&raw); e != nil {
		t.Fatal(e)
	}
	r, e := model.Decode(model.F1, raw)
	if e != nil || r.Base().Revision != 1 || r.Base().Status != "partial" {
		t.Fatal(r, e)
	}
	bad = repairedKline(next, now.UnixMilli())
	if e = j.Put(ctx, []model.Row{bad}); e == nil {
		t.Fatal("complete row overwritten")
	}
	if e = j.Close(); e != nil {
		t.Fatal(e)
	}
	if e = m.Close(); e != nil {
		t.Fatal(e)
	}
	m, j = open()
	defer m.Close()
	defer j.Close()
	if e = j.Recover(ctx); e != nil {
		t.Fatal(e)
	}
	p, e := j.Sync(ctx, model.F1, initial.Next)
	if e != nil || len(p.Rows) != 1 || p.Rows[0].Base().Revision != 2 {
		t.Fatal(p, e)
	}
	if e = j.Put(ctx, []model.Row{old}); e == nil {
		t.Fatal("stale retry accepted")
	}
	if b, e := j.pending(ctx); e != nil || b != nil {
		t.Fatal("stale retry staged", e)
	}
	var count int
	db, e := SQLiteOpener(filepath.Join(root, model.Day(old.T)+".sqlite"), true)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = db.QueryRowContext(ctx, "SELECT count(*) FROM events WHERE code='FUTURES_REPAIR'").Scan(&count); e != nil || count != 1 {
		t.Fatal(count, e)
	}
}
func TestRepairCrashAfterCommit(t *testing.T) {
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
	if e = j.Put(ctx, []model.Row{old}); e != nil {
		t.Fatal(e)
	}
	next := repairedKline(old, now.UnixMilli())
	b, _ := journalPayload([]model.Row{next})
	raw, _ := json.Marshal(old)
	h, _ := journalHash(next)
	if _, e = j.db.ExecContext(ctx, "INSERT INTO journal_repair VALUES(?,?,?,?,?,?,?)", model.F1, old.T, "", old.Asset, 2, raw, h); e != nil {
		t.Fatal(e)
	}
	if _, e = j.db.ExecContext(ctx, "INSERT INTO journal_intent VALUES(1,?)", b); e != nil {
		t.Fatal(e)
	}
	if e = m.put(ctx, []model.Row{next}, true); e != nil {
		t.Fatal(e)
	}
	if _, e = j.Sync(ctx, model.F1, ""); !errors.Is(e, ErrPendingWrite) {
		t.Fatal(e)
	}
	now = now.Add(48 * time.Hour)
	if e = j.Recover(ctx); e != nil {
		t.Fatal(e)
	}
	p, e := j.Sync(ctx, model.F1, "")
	if e != nil || len(p.Rows) != 1 || p.Rows[0].Base().Revision != 2 {
		t.Fatal(p, e)
	}
}

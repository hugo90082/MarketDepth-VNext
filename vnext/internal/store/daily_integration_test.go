//go:build sqlite_integration

package store

import (
	"context"
	"database/sql"
	"errors"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	_ "github.com/mattn/go-sqlite3"
	"path/filepath"
	"testing"
)

func TestSQLiteDailyIntegration(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "day.sqlite")
	rows := liveRows()
	day := model.Day(rows[0].Key().T)
	db, e := sql.Open("sqlite3", path)
	if e != nil {
		t.Fatal(e)
	}
	d, e := OpenDaily(ctx, db, day)
	if e != nil {
		t.Fatal(e)
	}
	if e = d.Put(ctx, rows); e != nil {
		t.Fatal(e)
	}
	if e = d.Put(ctx, rows); e != nil {
		t.Fatal("retry", e)
	}
	r, e := d.Get(ctx, model.F10, rows[1].Key())
	if e != nil || *r.(*model.Futures10Row).FirstAggID != 9007199254740993 {
		t.Fatal(r, e)
	}
	first := rows[0].(model.SpotRow)
	first.Bid0100 = model.Ptr(12.0)
	newRow := first
	newRow.Venue = "coinbase"
	if e = d.Put(ctx, []model.Row{newRow, first}); e == nil {
		t.Fatal("overwrite accepted")
	}
	if _, e = d.Get(ctx, model.Spot, newRow.Key()); !errors.Is(e, sql.ErrNoRows) {
		t.Fatal("batch failed atomicity", e)
	}
	newRow.T += 86400000
	newRow.AvailableAt = model.Ptr(newRow.T + 1000)
	if e = d.Put(ctx, []model.Row{newRow}); e == nil {
		t.Fatal("cross-day accepted")
	}
	if e = db.Close(); e != nil {
		t.Fatal(e)
	}
	db, e = sql.Open("sqlite3", path)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	d, e = OpenDaily(ctx, db, day)
	if e != nil {
		t.Fatal(e)
	}
	r, e = d.Get(ctx, model.Spot, rows[0].Key())
	if e != nil || *r.(*model.SpotRow).Bid0100 != 0 || r.(*model.SpotRow).Ask0100 != nil {
		t.Fatal(r, e)
	}
	if _, e = OpenDaily(ctx, db, model.Day(newRow.T)); e == nil {
		t.Fatal("wrong day accepted")
	}
}

//go:build linux && sqlite_integration

package store

import (
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func TestSnapshotIncludesWALAndNeverOverwrites(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "live")
	rows := liveRows()
	now := time.UnixMilli(rows[0].Key().T + 120000)
	m, e := newManager(root, SQLiteOpener, func() time.Time { return now }, 5*time.Minute)
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close()
	if e = m.Put(ctx, rows); e != nil {
		t.Fatal(e)
	}
	day := model.Day(rows[0].Key().T)
	if _, e = os.Stat(filepath.Join(root, day+".sqlite-wal")); e != nil {
		t.Fatal("expected live WAL", e)
	}
	stage := filepath.Join(t.TempDir(), "staging")
	if e = os.Mkdir(stage, 0700); e != nil {
		t.Fatal(e)
	}
	if _, e = m.CreateSnapshot(ctx, day, stage, "small", "test", 100); e == nil {
		t.Fatal("small reserve accepted")
	}
	s, e := m.CreateSnapshot(ctx, day, stage, "g1", "test", 20_000_000)
	if e != nil {
		t.Fatal(e)
	}
	if s.Manifest.SealedAt != nil || s.Manifest.FileID != "" || s.Manifest.RowCounts[string(model.Spot)] != 1 || s.Manifest.RowCounts[string(model.F10)] != 1 {
		t.Fatal(s)
	}
	if s.Manifest.GridThrough[string(model.Spot)] != rows[0].Key().T+60000 || s.Manifest.ExpectedCounts[string(model.Spot)] >= 17280 || s.Manifest.NullCounts[string(model.Spot)]["bid_0_100"] != 0 || s.Manifest.NullCounts[string(model.Spot)]["ask_0_100"] != 1 {
		t.Fatal("active grid or NULL stats", s.Manifest)
	}
	raw, e := os.ReadFile(s.Path)
	if e != nil {
		t.Fatal(e)
	}
	h := sha256.Sum256(raw)
	if hex.EncodeToString(h[:]) != s.Manifest.SHA256 || int64(len(raw)) != s.Manifest.Size {
		t.Fatal("hash or size")
	}
	f, e := os.Open(s.Path)
	if e != nil {
		t.Fatal(e)
	}
	defer f.Close()
	gz, e := gzip.NewReader(f)
	if e != nil {
		t.Fatal(e)
	}
	defer gz.Close()
	dest := filepath.Join(t.TempDir(), "restore.sqlite")
	w, e := os.Create(dest)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = io.Copy(w, gz); e != nil {
		w.Close()
		t.Fatal(e)
	}
	if e = w.Close(); e != nil {
		t.Fatal(e)
	}
	db, e := SQLiteOpener(dest, true)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	got, e := readRow(ctx, db, model.F10, rows[1].Key())
	if e != nil || *got.(*model.Futures10Row).FirstAggID != 9007199254740993 {
		t.Fatal(got, e)
	}
	if _, e = m.CreateSnapshot(ctx, day, stage, "g1", "test", 20_000_000); e == nil {
		t.Fatal("overwrite accepted")
	}
	a := rows[0].(model.SpotRow)
	a.Venue = "coinbase"
	if e = m.Put(ctx, []model.Row{a}); e != nil {
		t.Fatal("active writer unavailable", e)
	}
	s2, e := m.CreateSnapshot(ctx, day, stage, "g2", "test", 20_000_000)
	if e != nil || s2.Manifest.RowCounts[string(model.Spot)] != 2 {
		t.Fatal(s2, e)
	}
	if s2.Manifest.SHA256 == s.Manifest.SHA256 {
		t.Fatal("snapshot generation unchanged")
	}
	entries, e := os.ReadDir(stage)
	if e != nil || len(entries) != 2 {
		t.Fatal("temporary files leaked", entries, e)
	}
}

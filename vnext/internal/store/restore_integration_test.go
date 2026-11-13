//go:build linux && sqlite_integration

package store

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func TestVerifiedArchiveRestoreAndRejectTamper(t *testing.T) {
	ctx := context.Background()
	rows := liveRows()
	day := model.Day(rows[0].Key().T)
	now := time.UnixMilli(rows[0].Key().T + 120000)
	m, e := newManager(filepath.Join(t.TempDir(), "live"), SQLiteOpener, func() time.Time { return now }, 5*time.Minute)
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close()
	if e = m.Put(ctx, rows); e != nil {
		t.Fatal(e)
	}
	a, _, e := dayRange(day, day)
	if e != nil {
		t.Fatal(e)
	}
	now = a.Add(24*time.Hour + 6*time.Minute)
	if _, e = m.SealDay(ctx, day, "test"); e != nil {
		t.Fatal(e)
	}
	stage := filepath.Join(t.TempDir(), "stage")
	cache := filepath.Join(t.TempDir(), "cache")
	for _, p := range []string{stage, cache} {
		if e = os.Mkdir(p, 0700); e != nil {
			t.Fatal(e)
		}
	}
	snap, e := m.CreateSnapshot(ctx, day, stage, "g1", "test", 20_000_000)
	if e != nil {
		t.Fatal(e)
	}
	man := snap.Manifest
	man.FileID = "test-object"
	data, e := os.ReadFile(snap.Path)
	if e != nil {
		t.Fatal(e)
	}
	bad := man
	bad.RawSize--
	if _, e = RestoreVerifiedDay(ctx, bad, bytes.NewReader(data), cache, 20_000_000); e == nil {
		t.Fatal("raw size accepted")
	}
	bad = man
	bad.RowCounts = map[string]int64{"events": 0}
	if _, e = RestoreVerifiedDay(ctx, bad, bytes.NewReader(data), cache, 20_000_000); e == nil {
		t.Fatal("bad counts accepted")
	}
	if _, e = RestoreVerifiedDay(ctx, man, bytes.NewReader(append(append([]byte{}, data...), 1)), cache, 20_000_000); e == nil {
		t.Fatal("trailing bytes accepted")
	}
	corrupt := append([]byte{}, data...)
	corrupt[len(corrupt)/2] ^= 1
	if _, e = RestoreVerifiedDay(ctx, man, bytes.NewReader(corrupt), cache, 20_000_000); e == nil {
		t.Fatal("tampered compressed bytes accepted")
	}
	if _, e = RestoreVerifiedDay(ctx, man, bytes.NewReader(data), cache, 1); e == nil {
		t.Fatal("unreserved restore accepted")
	}
	if es, e := os.ReadDir(cache); e != nil || len(es) != 0 {
		t.Fatal("failed restore published file", es, e)
	}
	p, e := RestoreVerifiedDay(ctx, man, bytes.NewReader(data), cache, 20_000_000)
	if e != nil {
		t.Fatal(e)
	}
	db, e := SQLiteOpener(p, true)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	r, e := readRow(ctx, db, model.F10, rows[1].Key())
	if e != nil || *r.(*model.Futures10Row).FirstAggID != 9007199254740993 {
		t.Fatal(r, e)
	}
	if _, e = RestoreVerifiedDay(ctx, man, bytes.NewReader(data), cache, 20_000_000); e == nil {
		t.Fatal("overwrote verified file")
	}
}

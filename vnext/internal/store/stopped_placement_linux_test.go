//go:build linux && sqlite_integration

package store

import (
	"context"
	"crypto/sha256"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStoppedPlacementReadOnly(t *testing.T) {
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "root")
	m, e := NewManager(root, SQLiteOpener)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(root, ".marketdepth-vnext-staging"), []byte("MARKETDEPTH-VNEXT-STAGING-1\n"), 0600); e != nil {
		t.Fatal(e)
	}
	j, e := m.OpenCatalog(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = j.db.Exec("INSERT INTO journal_loss_sync VALUES('2026-09-22','{}',1)"); e != nil {
		t.Fatal(e)
	}
	if p, e := OpenStoppedPlacement(ctx, root); e == nil {
		p.Close()
		t.Fatal("running writer accepted")
	}
	j.Close()
	m.Close()
	pth := filepath.Join(root, "catalog.db")
	before, e := os.ReadFile(pth)
	if e != nil {
		t.Fatal(e)
	}
	p, e := OpenStoppedPlacement(ctx, root)
	if e != nil {
		t.Fatal(e)
	}
	defer p.Close()
	if m, e := NewManager(root, SQLiteOpener); e == nil {
		m.Close()
		t.Fatal("writer reopened while fenced")
	}
	cut := time.Date(2026, 9, 24, 0, 0, 0, 0, time.FixedZone("UTC+8", 8*3600)).UnixMilli()
	got, e := p.InspectLegacyPlacement(ctx, []string{"2026-09-21", "2026-09-22", "2026-09-24"}, cut)
	if e != nil || len(got) != 3 || !got[0].LocalClear || got[1].LocalClear || got[2].LocalClear {
		t.Fatal(got, e)
	}
	after, e := os.ReadFile(pth)
	if e != nil || sha256.Sum256(before) != sha256.Sum256(after) {
		t.Fatal("catalog modified")
	}
	if e = os.WriteFile(pth+"-wal", nil, 0600); e != nil {
		t.Fatal(e)
	}
	if _, e = p.InspectLegacyPlacement(ctx, []string{"2026-09-21"}, cut); e == nil {
		t.Fatal("sidecar accepted")
	}
}

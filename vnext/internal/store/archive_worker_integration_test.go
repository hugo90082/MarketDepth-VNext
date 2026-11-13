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

func TestArchiveWorkerHourlyRestartAndMidnight(t *testing.T) {
	ctx := context.Background()
	rows := liveRows()
	day := model.Day(rows[0].Key().T)
	a, _, e := dayRange(day, day)
	if e != nil {
		t.Fatal(e)
	}
	now := a.Add(2 * time.Minute)
	root := filepath.Join(t.TempDir(), "live")
	remote := &rotatingRemote{sealedRemote: &sealedRemote{objects: map[string]storedArchiveObject{}, keys: map[string]string{}}, trashed: map[string]bool{}}
	deny := true
	held := false
	reserve := func(ctx context.Context, n int64) (func(), error) {
		if deny {
			return nil, errors.New("capacity refused")
		}
		if held || n <= 0 {
			t.Fatal("invalid reserve")
		}
		held = true
		return func() {
			if !held {
				t.Fatal("double release")
			}
			held = false
		}, nil
	}
	open := func() (*Manager, *Journal, *ArchiveWorker) {
		m, e := newManager(root, SQLiteOpener, func() time.Time { return now }, 5*time.Minute)
		if e != nil {
			t.Fatal(e)
		}
		j, e := m.OpenCatalog(ctx)
		if e != nil {
			t.Fatal(e)
		}
		w, e := NewArchiveWorker(m, j, remote, reserve, "test")
		if e != nil {
			t.Fatal(e)
		}
		return m, j, w
	}
	m, j, w := open()
	if e = j.Put(ctx, rows); e != nil {
		t.Fatal(e)
	}
	step := func(want string) {
		t.Helper()
		s, e := w.Cycle(ctx)
		if e != nil || s != want || held {
			t.Fatal(s, e, "want", want)
		}
	}
	if _, e = w.Cycle(ctx); e == nil {
		t.Fatal("capacity refusal ignored")
	}
	if p, e := j.ArchivePending(ctx); e != nil || p != nil {
		t.Fatal(p, e)
	}
	deny = false
	step("staged")
	p, e := j.ArchivePending(ctx)
	if e != nil || p == nil || !p.Active {
		t.Fatal(p, e)
	}
	original := p.Snapshot.Path
	remote.failManifest = true
	if _, e = w.Cycle(ctx); e == nil || held {
		t.Fatal("upload error swallowed", e)
	}
	if e = j.Close(); e != nil {
		t.Fatal(e)
	}
	if e = m.Close(); e != nil {
		t.Fatal(e)
	}
	now = now.Add(time.Hour)
	m, j, w = open()
	defer m.Close()
	defer j.Close()
	p, e = j.ArchivePending(ctx)
	if e != nil || p == nil || p.Snapshot.Path != original {
		t.Fatal(p, e)
	}
	remote.failManifest = false
	step("hourly_verified")
	if _, e = os.Stat(original); !errors.Is(e, os.ErrNotExist) {
		t.Fatal("scratch not reclaimed", e)
	}
	step("staged")
	step("hourly_verified")
	step("active_retired")
	step("idle")
	now = a.Add(24*time.Hour + 4*time.Minute)
	step("idle") // grace not expired
	now = a.Add(24*time.Hour + 6*time.Minute)
	step("staged")
	p, e = j.ArchivePending(ctx)
	if e != nil || p == nil || p.Active || p.Snapshot.Manifest.SealedAt == nil {
		t.Fatal(p, e)
	}
	step("daily_verified")
	step("active_retired")
	step("idle")
	if _, e = j.ArchiveRecord(ctx, day, 0); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(filepath.Join(root, day+".sqlite")); e != nil {
		t.Fatal("daily file removed", e)
	}
}
func TestArchiveScratchRejectsUnknownFile(t *testing.T) {
	p := t.TempDir()
	d, e := os.MkdirTemp(p, "job-")
	if e != nil {
		t.Fatal(e)
	}
	f := filepath.Join(d, "unrelated.txt")
	if e = os.WriteFile(f, []byte("keep"), 0600); e != nil {
		t.Fatal(e)
	}
	if e = cleanScratch(p, stageFile, "job-"); e == nil {
		t.Fatal("unknown file accepted")
	}
	if b, e := os.ReadFile(f); e != nil || string(b) != "keep" {
		t.Fatal("unrelated file changed", e)
	}
}

//go:build linux && sqlite_integration

package store

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

type rotatingRemote struct {
	*sealedRemote
	trashed   map[string]bool
	failTrash string
	corrupt   string
}

func (r *rotatingRemote) OpenObject(ctx context.Context, id string) (archive.Object, io.ReadCloser, error) {
	if r.trashed[id] || id == r.corrupt {
		return archive.Object{}, nil, errors.New("remote unavailable")
	}
	return r.sealedRemote.OpenObject(ctx, id)
}
func (r *rotatingRemote) TrashActiveObject(ctx context.Context, o archive.Object) error {
	if o.ID == r.failTrash {
		return errors.New("trash failure")
	}
	v, ok := r.objects[o.ID]
	if !ok || v.meta != o || len(o.Key) < 7 || o.Key[:7] != "active/" {
		return errors.New("bad retirement")
	}
	r.trashed[o.ID] = true
	return nil
}
func TestActiveRotationRestartAndSealedRetirement(t *testing.T) {
	ctx := context.Background()
	rows := liveRows()
	day := model.Day(rows[0].Key().T)
	now := time.UnixMilli(rows[0].Key().T + 120000)
	a, _, e := dayRange(day, day)
	if e != nil {
		t.Fatal(e)
	}
	root := filepath.Join(t.TempDir(), "live")
	stage := filepath.Join(t.TempDir(), "stage")
	cache := filepath.Join(t.TempDir(), "cache")
	for _, p := range []string{stage, cache} {
		if e = os.Mkdir(p, 0700); e != nil {
			t.Fatal(e)
		}
	}
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
	if e = j.Put(ctx, rows); e != nil {
		t.Fatal(e)
	}
	r := &rotatingRemote{sealedRemote: &sealedRemote{objects: map[string]storedArchiveObject{}, keys: map[string]string{}}, trashed: map[string]bool{}}
	snapshot := func(i int) SnapshotResult {
		s, e := m.CreateSnapshot(ctx, day, stage, archive.HourGeneration(a.Add(time.Duration(i)*time.Hour)), "test", 20_000_000)
		if e != nil {
			t.Fatal(e)
		}
		return s
	}
	s1 := snapshot(0)
	first, e := j.PublishActiveSnapshot(ctx, r, s1, cache, 20_000_000)
	if e != nil {
		t.Fatal(e)
	}
	s2 := snapshot(1)
	r.failManifest = true
	if _, e = j.PublishActiveSnapshot(ctx, r, s2, cache, 20_000_000); e == nil {
		t.Fatal("failure accepted")
	}
	state, e := j.ActiveState(ctx, day)
	if e != nil || state.Current.Manifest.FileID != first.Manifest.FileID || state.Previous != nil {
		t.Fatal(state, e)
	}
	pending, e := j.ArchivePending(ctx)
	if e != nil || pending == nil || pending.Snapshot.Manifest.Generation != s2.Manifest.Generation {
		t.Fatal(pending, e)
	}
	s3 := snapshot(2)
	if _, e = j.PublishActiveSnapshot(ctx, r, s3, cache, 20_000_000); !errors.Is(e, ErrArchivePending) {
		t.Fatal("pending generation replaced", e)
	}
	r.failManifest = false
	second, e := j.PublishActiveSnapshot(ctx, r, s2, cache, 20_000_000)
	if e != nil {
		t.Fatal(e)
	}
	n := len(r.objects)
	if _, e = j.PublishActiveSnapshot(ctx, r, s3, cache, 20_000_000); !errors.Is(e, ErrActiveRetirementPending) || len(r.objects) != n {
		t.Fatal("unbounded third generation", e)
	}
	// Neither a corrupt replacement nor a partial retirement can drop the ledger.
	r.corrupt = second.Manifest.FileID
	if e = j.RetirePreviousActive(ctx, r, day, cache, 20_000_000); e == nil || len(r.trashed) != 0 {
		t.Fatal("corrupt replacement accepted", e)
	}
	r.corrupt = ""
	r.failTrash = first.Manifest.FileID
	if e = j.RetirePreviousActive(ctx, r, day, cache, 20_000_000); e == nil || !r.trashed[first.ManifestID] || r.trashed[first.Manifest.FileID] {
		t.Fatal("partial failure not retained", e)
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
	state, e = j.ActiveState(ctx, day)
	if e != nil || state.Previous == nil {
		t.Fatal(state, e)
	}
	r.failTrash = ""
	if e = j.RetirePreviousActive(ctx, r, day, cache, 20_000_000); e != nil {
		t.Fatal(e)
	}
	state, e = j.ActiveState(ctx, day)
	if e != nil || state.Previous != nil || r.trashed[second.Manifest.FileID] {
		t.Fatal(state, e)
	}
	if _, e = j.PublishActiveSnapshot(ctx, r, s3, cache, 20_000_000); e != nil {
		t.Fatal(e)
	}
	if e = j.RetireSealedActive(ctx, r, day, cache, 20_000_000); e == nil {
		t.Fatal("retired before sealed publication")
	}
	now = a.Add(24*time.Hour + 6*time.Minute)
	if _, e = j.SealDay(ctx, day, "test"); e != nil {
		t.Fatal(e)
	}
	sealed, e := m.CreateSnapshot(ctx, day, stage, "sealed1", "test", 20_000_000)
	if e != nil {
		t.Fatal(e)
	}
	rec, e := j.PublishSealedSnapshot(ctx, r, sealed, cache, 20_000_000)
	if e != nil {
		t.Fatal(e)
	}
	if e = j.RetireSealedActive(ctx, r, day, cache, 20_000_000); e != nil {
		t.Fatal(e)
	}
	if _, e = j.ActiveState(ctx, day); e == nil {
		t.Fatal("active ledger remains")
	}
	if r.trashed[rec.Manifest.FileID] || r.trashed[rec.ManifestID] {
		t.Fatal("sealed archive trashed")
	}
	if _, e = j.PublishActiveSnapshot(ctx, r, s3, cache, 20_000_000); e == nil {
		t.Fatal("sealed day accepted active snapshot")
	}
	if _, e = os.Stat(filepath.Join(root, day+".sqlite")); e != nil {
		t.Fatal("local data removed", e)
	}
}

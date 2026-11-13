//go:build linux && sqlite_integration

package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

type storedArchiveObject struct {
	meta archive.Object
	data []byte
}
type sealedRemote struct {
	objects      map[string]storedArchiveObject
	keys         map[string]string
	failManifest bool
}

func (r *sealedRemote) PutImmutable(ctx context.Context, key string, n int64, sha string, body io.Reader) (archive.Object, error) {
	if r.failManifest && strings.HasSuffix(key, ".json") {
		return archive.Object{}, errors.New("upload failed")
	}
	b, e := io.ReadAll(body)
	sum := sha256.Sum256(b)
	if e != nil || int64(len(b)) != n || hex.EncodeToString(sum[:]) != sha {
		return archive.Object{}, errors.New("bad body")
	}
	if id := r.keys[key]; id != "" {
		o := r.objects[id]
		if !bytes.Equal(o.data, b) {
			return archive.Object{}, errors.New("immutable conflict")
		}
		return o.meta, nil
	}
	id := fmt.Sprintf("id_%d", len(r.objects)+1)
	o := archive.Object{ID: id, Key: key, Size: n, SHA256: sha}
	r.keys[key] = id
	r.objects[id] = storedArchiveObject{o, b}
	return o, nil
}
func (r *sealedRemote) OpenObject(ctx context.Context, id string) (archive.Object, io.ReadCloser, error) {
	v, ok := r.objects[id]
	if !ok {
		return archive.Object{}, nil, errors.New("missing")
	}
	return v.meta, io.NopCloser(bytes.NewReader(v.data)), nil
}
func TestSealedPublishCatalogRestart(t *testing.T) {
	ctx := context.Background()
	rows := liveRows()
	day := model.Day(rows[0].Key().T)
	now := time.UnixMilli(rows[0].Key().T + 120000)
	root := filepath.Join(t.TempDir(), "live")
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
	a, _, e := dayRange(day, day)
	if e != nil {
		t.Fatal(e)
	}
	now = a.Add(24*time.Hour + 6*time.Minute)
	if _, e = j.SealDay(ctx, day, "test"); e != nil {
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
	r := &sealedRemote{objects: map[string]storedArchiveObject{}, keys: map[string]string{}, failManifest: true}
	if _, e = j.PublishSealedSnapshot(ctx, r, snap, cache, 20_000_000); e == nil {
		t.Fatal("manifest failure accepted")
	}
	if _, e = j.ArchiveRecord(ctx, day, 0); e == nil {
		t.Fatal("catalog before manifest")
	}
	if len(r.objects) != 1 {
		t.Fatal("bad data upload count")
	}
	r.failManifest = false
	rec, e := j.PublishSealedSnapshot(ctx, r, snap, cache, 20_000_000)
	if e != nil {
		t.Fatal(e)
	}
	if len(r.objects) != 2 {
		t.Fatal("duplicate remote objects")
	}
	if _, e = j.PublishSealedSnapshot(ctx, r, snap, cache, 20_000_000); e != nil || len(r.objects) != 2 {
		t.Fatal(e)
	}
	if es, e := os.ReadDir(cache); e != nil || len(es) != 0 {
		t.Fatal("verification temp leaked", es, e)
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
	got, e := j.ArchiveRecord(ctx, day, 0)
	if e != nil || got.Manifest.FileID != rec.Manifest.FileID || got.ManifestSHA256 != rec.ManifestSHA256 {
		t.Fatal(got, e)
	}
	if _, e = os.Stat(snap.Path); e != nil {
		t.Fatal("source was removed", e)
	}
	if _, e = j.History(ctx, Query{Kind: model.Spot, From: rec.Manifest.From, To: rec.Manifest.To, Limit: 10}); e != nil {
		t.Fatal("archive unexpectedly evicted", e)
	}
}

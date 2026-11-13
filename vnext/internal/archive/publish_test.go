package archive

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

type mockObject struct {
	o Object
	b []byte
}
type mockRemote struct {
	objects                                                        map[string]mockObject
	keys                                                           map[string]string
	failManifest, corruptData, corruptManifest, timeoutAfterCreate bool
	creates                                                        int
}

func newRemote() *mockRemote {
	return &mockRemote{objects: map[string]mockObject{}, keys: map[string]string{}}
}
func (r *mockRemote) PutImmutable(ctx context.Context, k string, n int64, h string, b io.Reader) (Object, error) {
	if r.failManifest && strings.HasSuffix(k, ".json") {
		return Object{}, errors.New("manifest upload failed")
	}
	data, e := io.ReadAll(b)
	sum := sha256.Sum256(data)
	if e != nil || int64(len(data)) != n || hex.EncodeToString(sum[:]) != h {
		return Object{}, errors.New("input mismatch")
	}
	if id := r.keys[k]; id != "" {
		o := r.objects[id]
		if o.o.Size != n || o.o.SHA256 != h || !bytes.Equal(o.b, data) {
			return Object{}, errors.New("immutable collision")
		}
		return o.o, nil
	}
	r.creates++
	id := fmt.Sprintf("obj_%d", r.creates)
	o := Object{ID: id, Key: k, Size: n, SHA256: h}
	r.objects[id] = mockObject{o, data}
	r.keys[k] = id
	if r.timeoutAfterCreate {
		r.timeoutAfterCreate = false
		return Object{}, errors.New("ambiguous timeout")
	}
	return o, nil
}
func (r *mockRemote) OpenObject(ctx context.Context, id string) (Object, io.ReadCloser, error) {
	v, ok := r.objects[id]
	if !ok {
		return Object{}, nil, errors.New("missing")
	}
	b := append([]byte{}, v.b...)
	if r.corruptData && strings.HasSuffix(v.o.Key, ".gz") || r.corruptManifest && strings.HasSuffix(v.o.Key, ".json") {
		b[0] ^= 1
	}
	return v.o, io.NopCloser(bytes.NewReader(b)), nil
}
func testManifest(b []byte) Manifest {
	a, _ := time.ParseInLocation("2006-01-02", "2026-11-12", time.FixedZone("UTC+8", 8*3600))
	end := a.Add(24 * time.Hour).UnixMilli()
	seal := end + 360000
	sum := sha256.Sum256(b)
	return Manifest{ContractID: model.Contract, Timezone: model.Timezone, Day: "2026-11-12", Revision: 1, Generation: "g1", From: a.UnixMilli(), To: end, SealedAt: &seal, DataOrigin: "live", ProducerCommit: "test", Size: int64(len(b)), SHA256: hex.EncodeToString(sum[:]), RawSize: 100, RawSHA256: strings.Repeat("a", 64)}
}
func consume(ctx context.Context, m Manifest, r io.Reader) error {
	_, e := io.Copy(io.Discard, r)
	return e
}
func TestSealedPublisherRetryAndReadback(t *testing.T) {
	ctx := context.Background()
	b := []byte("test snapshot")
	m := testManifest(b)
	r := newRemote()
	r.timeoutAfterCreate = true
	pub := func() (Publication, error) { return PublishSealed(ctx, r, m, bytes.NewReader(b), consume) }
	if p, e := pub(); e == nil {
		t.Fatal("ambiguous create accepted", p)
	}
	if r.creates != 1 {
		t.Fatal(r.creates)
	}
	r.failManifest = true
	if _, e := pub(); e == nil {
		t.Fatal("failed manifest accepted")
	}
	if r.creates != 1 {
		t.Fatal(r.creates)
	}
	r.failManifest = false
	r.corruptManifest = true
	if _, e := pub(); e == nil {
		t.Fatal("corrupt manifest accepted")
	}
	if r.creates != 2 {
		t.Fatal(r.creates)
	}
	r.corruptManifest = false
	p, e := pub()
	if e != nil {
		t.Fatal(e)
	}
	rec, e := p.Record()
	if e != nil || ValidateRecord(rec) != nil || rec.Manifest.FileID != "obj_1" || rec.ManifestID != "obj_2" {
		t.Fatal(rec, e)
	}
	if _, e = pub(); e != nil || r.creates != 2 {
		t.Fatal(e, r.creates)
	}
	bad := rec
	bad.Manifest.Generation = "changed"
	if ValidateRecord(bad) == nil {
		t.Fatal("altered manifest accepted")
	}
}
func TestSealedPublisherNoManifestBeforeDataVerified(t *testing.T) {
	ctx := context.Background()
	b := []byte("snapshot")
	m := testManifest(b)
	for _, tc := range []struct {
		name    string
		corrupt bool
		v       SnapshotVerifier
	}{{"corrupt", true, consume}, {"sqlite reject", false, func(context.Context, Manifest, io.Reader) error { return errors.New("bad db") }}, {"unconsumed", false, func(context.Context, Manifest, io.Reader) error { return nil }}} {
		t.Run(tc.name, func(t *testing.T) {
			r := newRemote()
			r.corruptData = tc.corrupt
			if p, e := PublishSealed(ctx, r, m, bytes.NewReader(b), tc.v); e == nil {
				t.Fatal("false verification", p)
			}
			if r.creates != 1 {
				t.Fatal("manifest created before data verification", r.creates)
			}
		})
	}
	r := newRemote()
	m.SealedAt = nil
	if _, e := PublishSealed(ctx, r, m, bytes.NewReader(b), consume); e == nil || r.creates != 0 {
		t.Fatal("active snapshot accepted", e, r.creates)
	}
}

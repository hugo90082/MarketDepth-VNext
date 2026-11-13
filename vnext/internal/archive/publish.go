package archive

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// RemoteObjects is the immutable object protocol used by the sealed publisher.
// An implementation must resolve the exact logical key (not just a filename),
// refuse duplicates/conflicts, and return the same ID on an identical retry.
// It must not overwrite/delete existing remote objects. Ambiguous uploads may
// return errors; the caller retries the same key/size/hash, not a new generation.
type RemoteObjects interface {
	PutImmutable(ctx context.Context, key string, size int64, sha256 string, body io.Reader) (Object, error)
	OpenObject(ctx context.Context, id string) (Object, io.ReadCloser, error)
}
type Object struct {
	ID, Key, SHA256 string
	Size            int64
}

// SnapshotVerifier must stream/decompress and validate the SQLite archive and
// all manifest metadata. The publisher also independently verifies the exact
// compressed byte count and SHA256 on the remote readback.
type SnapshotVerifier func(context.Context, Manifest, io.Reader) error

// Publication is proof of the two remote readbacks in this process. No public
// constructor: a zero value is invalid. Record returns a detached copy of the
// durable payload for the catalog. A record alone is not proof of local eviction.
type Publication struct {
	record PublishedRecord
	valid  bool
}
type PublishedRecord struct {
	Manifest       Manifest `json:"manifest"`
	ManifestID     string   `json:"manifest_id"`
	ManifestSHA256 string   `json:"manifest_sha256"`
}

func (p Publication) Record() (PublishedRecord, error) {
	if !p.valid {
		return PublishedRecord{}, errors.New("publication not verified")
	}
	b, e := json.Marshal(p.record)
	if e != nil {
		return PublishedRecord{}, e
	}
	var r PublishedRecord
	e = json.Unmarshal(b, &r)
	return r, e
}
func validDigest(s string) bool {
	b, e := hex.DecodeString(s)
	return e == nil && len(b) == sha256.Size && strings.ToLower(s) == s
}
func safeID(s string) bool {
	return len(s) > 0 && len(s) <= 256 && strings.Trim(s, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_") == ""
}
func sealedKeys(m Manifest) (string, string, error) {
	a, e := time.ParseInLocation("2006-01-02", m.Day, time.FixedZone("UTC+8", 8*3600))
	if e != nil || m.Day != a.Format("2006-01-02") || m.ContractID != model.Contract || m.Timezone != model.Timezone || m.From != a.UnixMilli() || m.To != a.Add(24*time.Hour).UnixMilli() || m.SealedAt == nil || *m.SealedAt < m.To || m.Revision < 1 || m.DataOrigin != "live" || m.ProducerCommit == "" || len(m.ProducerCommit) > 128 || !safeID(m.Generation) || len(m.Generation) > 80 || !validDigest(m.SHA256) || !validDigest(m.RawSHA256) || m.Size <= 0 || m.RawSize <= 0 || m.Size > HardLimit || m.RawSize > HardLimit-m.Size {
		return "", "", errors.New("invalid sealed publication manifest")
	}
	base := fmt.Sprintf("historical/%s/%s/%s.r%d", m.Day[:4], m.Day[5:7], m.Day, m.Revision)
	return base + ".sqlite.gz", base + ".manifest.json", nil
}
func validateObject(o Object, key string, size int64, digest string) error {
	if !safeID(o.ID) || o.Key != key || o.Size != size || (o.SHA256 != "" && o.SHA256 != digest) {
		return errors.New("remote object identity or metadata mismatch")
	}
	return nil
}
func closeObject(r io.ReadCloser) {
	if r != nil {
		_ = r.Close()
	}
}

type countedReader struct {
	r io.Reader
	n int64
}

func (r *countedReader) Read(p []byte) (int, error) {
	n, e := r.r.Read(p)
	r.n += int64(n)
	return n, e
}

// PublishSealed publishes one immutable daily revision. Both data and the
// manifest are verified by exact object-ID readback. A partial failure may
// leave an unreferenced object remotely; no catalog proof is returned and no
// local or remote files are removed. Retry with the identical manifest/body.
// Network/SQLite verification must run outside the collector writer lock.
func PublishSealed(ctx context.Context, remote RemoteObjects, manifest Manifest, body io.Reader, verify SnapshotVerifier) (Publication, error) {
	var zero Publication
	if remote == nil || body == nil || verify == nil || manifest.FileID != "" {
		return zero, errors.New("remote, new manifest, body and verifier required")
	}
	// Freeze caller-owned maps before any external side effects.
	raw, e := json.Marshal(manifest)
	if e != nil {
		return zero, e
	}
	var m Manifest
	if e = json.Unmarshal(raw, &m); e != nil {
		return zero, e
	}
	dataKey, manifestKey, e := sealedKeys(m)
	if e != nil {
		return zero, e
	}
	if e = ctx.Err(); e != nil {
		return zero, e
	}
	obj, e := remote.PutImmutable(ctx, dataKey, m.Size, m.SHA256, body)
	if e != nil {
		return zero, e
	}
	if e = validateObject(obj, dataKey, m.Size, m.SHA256); e != nil {
		return zero, e
	}
	m.FileID = obj.ID
	read, stream, e := remote.OpenObject(ctx, obj.ID)
	if e != nil {
		closeObject(stream)
		return zero, e
	}
	e = func() error {
		if stream == nil {
			return errors.New("missing remote body")
		}
		defer stream.Close()
		if read.ID != obj.ID {
			return errors.New("remote data id mismatch")
		}
		if e := validateObject(read, dataKey, m.Size, m.SHA256); e != nil {
			return e
		}
		h := sha256.New()
		r := &countedReader{r: io.TeeReader(io.LimitReader(stream, m.Size+1), h)}
		if e := verify(ctx, m, r); e != nil {
			return e
		}
		var extra [1]byte
		n, err := io.ReadFull(r, extra[:])
		if n != 0 || !errors.Is(err, io.EOF) || r.n != m.Size || hex.EncodeToString(h.Sum(nil)) != m.SHA256 {
			return errors.New("remote data readback mismatch")
		}
		return ctx.Err()
	}()
	if e != nil {
		return zero, e
	}
	// Canonical Go JSON with deterministic map ordering. Manifest only becomes
	// visible after the data readback and SQLite verifier both succeeded.
	b, e := json.Marshal(m)
	if e != nil {
		return zero, e
	}
	if len(b) > 1<<20 {
		return zero, errors.New("manifest exceeds 1MiB")
	}
	sum := sha256.Sum256(b)
	digest := hex.EncodeToString(sum[:])
	meta, e := remote.PutImmutable(ctx, manifestKey, int64(len(b)), digest, bytes.NewReader(b))
	if e != nil {
		return zero, e
	}
	if e = validateObject(meta, manifestKey, int64(len(b)), digest); e != nil {
		return zero, e
	}
	if meta.ID == obj.ID {
		return zero, errors.New("data and manifest IDs coincide")
	}
	got, r, e := remote.OpenObject(ctx, meta.ID)
	if e != nil {
		closeObject(r)
		return zero, e
	}
	if r == nil {
		return zero, errors.New("missing remote manifest body")
	}
	defer r.Close()
	if got.ID != meta.ID {
		return zero, errors.New("remote manifest ID mismatch")
	}
	if e = validateObject(got, manifestKey, int64(len(b)), digest); e != nil {
		return zero, e
	}
	received, e := io.ReadAll(io.LimitReader(r, int64(len(b))+1))
	if e != nil || !bytes.Equal(received, b) {
		return zero, errors.New("manifest readback mismatch")
	}
	if e = ctx.Err(); e != nil {
		return zero, e
	}
	return Publication{record: PublishedRecord{Manifest: m, ManifestID: meta.ID, ManifestSHA256: digest}, valid: true}, nil
}

// ValidateRecord checks a durable catalog record's structural identity and
// manifest hash. It is NOT remote verification; a rebuild must re-read bytes.
func ValidateRecord(r PublishedRecord) error {
	if _, _, e := sealedKeys(r.Manifest); e != nil {
		return e
	}
	if !safeID(r.Manifest.FileID) || !safeID(r.ManifestID) || r.Manifest.FileID == r.ManifestID || !validDigest(r.ManifestSHA256) {
		return errors.New("invalid published identity")
	}
	b, e := json.Marshal(r.Manifest)
	if e != nil {
		return e
	}
	h := sha256.Sum256(b)
	if hex.EncodeToString(h[:]) != r.ManifestSHA256 {
		return errors.New("manifest digest mismatch")
	}
	return nil
}

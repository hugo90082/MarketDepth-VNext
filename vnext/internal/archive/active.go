package archive

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
)

// ActiveRetirer is deliberately separate from RemoteObjects. Implementations
// must restrict trash operations to exact app-owned active generation objects.
type ActiveRetirer interface {
	RemoteObjects
	TrashActiveObject(context.Context, Object) error
}

// PublishedObjects derives exact immutable IDs, keys and checksums from a
// structurally valid record. It does not imply that remote bytes are present.
func PublishedObjects(r PublishedRecord, active bool) (Object, Object, error) {
	var zero Object
	if e := validateRecord(r, active); e != nil {
		return zero, zero, e
	}
	dk, mk, e := manifestKeys(r.Manifest, active)
	if e != nil {
		return zero, zero, e
	}
	b, e := json.Marshal(r.Manifest)
	if e != nil || len(b) > 1<<20 {
		return zero, zero, errors.New("invalid manifest size")
	}
	return Object{ID: r.Manifest.FileID, Key: dk, Size: r.Manifest.Size, SHA256: r.Manifest.SHA256}, Object{ID: r.ManifestID, Key: mk, Size: int64(len(b)), SHA256: r.ManifestSHA256}, nil
}

// VerifyPublished rechecks a persisted record from the remote source. It is
// used before retirement and later can be used to recover the local catalog.
func VerifyPublished(ctx context.Context, remote RemoteObjects, r PublishedRecord, active bool, verify SnapshotVerifier) error {
	if remote == nil || verify == nil {
		return errors.New("remote and verifier required")
	}
	data, manifest, e := PublishedObjects(r, active)
	if e != nil {
		return e
	}
	expected, e := json.Marshal(r.Manifest)
	if e != nil {
		return e
	}
	got, body, e := remote.OpenObject(ctx, manifest.ID)
	if e != nil {
		closeObject(body)
		return e
	}
	if body == nil {
		return errors.New("manifest missing")
	}
	e = func() error {
		defer body.Close()
		if got.ID != manifest.ID {
			return errors.New("manifest ID mismatch")
		}
		if e := validateObject(got, manifest.Key, manifest.Size, manifest.SHA256); e != nil {
			return e
		}
		b, e := io.ReadAll(io.LimitReader(body, manifest.Size+1))
		if e != nil || !bytes.Equal(b, expected) {
			return errors.New("manifest readback mismatch")
		}
		return nil
	}()
	if e != nil {
		return e
	}
	got, body, e = remote.OpenObject(ctx, data.ID)
	if e != nil {
		closeObject(body)
		return e
	}
	if body == nil {
		return errors.New("snapshot missing")
	}
	defer body.Close()
	if got.ID != data.ID {
		return errors.New("snapshot ID mismatch")
	}
	if e = validateObject(got, data.Key, data.Size, data.SHA256); e != nil {
		return e
	}
	h := sha256.New()
	cr := &countedReader{r: io.TeeReader(io.LimitReader(body, data.Size+1), h)}
	if e = verify(ctx, r.Manifest, cr); e != nil {
		return e
	}
	var extra [1]byte
	n, e := io.ReadFull(cr, extra[:])
	if n != 0 || !errors.Is(e, io.EOF) || cr.n != data.Size || hex.EncodeToString(h.Sum(nil)) != data.SHA256 {
		return errors.New("snapshot readback mismatch")
	}
	return ctx.Err()
}

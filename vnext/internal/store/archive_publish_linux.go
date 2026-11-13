//go:build linux && sqlite_integration

package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"syscall"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
)

// PublishSealedSnapshot performs the remote protocol with the real SQLite
// restore verifier, then records the publication. Callers must hold an
// appropriate local snapshot lease and reserve disk for the verification
// copy. No deletion of the source, daily DB or remote objects is performed.
func (j *Journal) PublishSealedSnapshot(ctx context.Context, remote archive.RemoteObjects, snap SnapshotResult, cache string, reserve int64) (archive.PublishedRecord, error) {
	var zero archive.PublishedRecord
	m := snap.Manifest
	if remote == nil || m.SealedAt == nil || m.FileID != "" || reserve <= 0 || reserve > archive.HardLimit || m.Size <= 0 || m.RawSize <= 0 || m.Size > reserve || m.RawSize > reserve-m.Size {
		return zero, errors.New("sealed snapshot and verification reserve required")
	}
	cache, e := filepath.Abs(cache)
	if e != nil {
		return zero, e
	}
	real, e := filepath.EvalSymlinks(cache)
	if e != nil || real != cache {
		return zero, errors.New("unsafe verification directory")
	}
	st, e := os.Stat(cache)
	if e != nil || !st.IsDir() || st.Mode().Perm()&0077 != 0 {
		return zero, errors.New("private verification directory required")
	}
	source, e := filepath.Abs(snap.Path)
	if e != nil {
		return zero, e
	}
	real, e = filepath.EvalSymlinks(source)
	if e != nil || real != source {
		return zero, errors.New("unsafe snapshot source")
	}
	fd, e := syscall.Open(source, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if e != nil {
		return zero, e
	}
	f := os.NewFile(uintptr(fd), source)
	defer f.Close()
	st, e = f.Stat()
	if e != nil || !st.Mode().IsRegular() || st.Size() != m.Size {
		return zero, errors.New("snapshot source mismatch")
	}
	// Check exact local compressed hash before any remote side effects, and
	// rewind the same descriptor. Published snapshots are immutable by lease.
	if e = verifyLocalCompressed(ctx, f, m); e != nil {
		return zero, e
	}
	if _, e = f.Seek(0, io.SeekStart); e != nil {
		return zero, e
	}
	verify := func(ctx context.Context, man archive.Manifest, body io.Reader) error {
		dir, e := os.MkdirTemp(cache, ".verify-")
		if e != nil {
			return e
		}
		// Only our newly-created private directory, never caller-owned data.
		defer os.RemoveAll(dir)
		_, e = RestoreVerifiedDay(ctx, man, body, dir, reserve)
		return e
	}
	p, e := archive.PublishSealed(ctx, remote, m, f, verify)
	if e != nil {
		return zero, e
	}
	if e = j.RegisterArchive(ctx, p); e != nil {
		return zero, e
	}
	return p.Record()
}

func verifyLocalCompressed(ctx context.Context, f io.Reader, m archive.Manifest) error {
	h := sha256.New()
	n, e := io.Copy(h, io.LimitReader(&contextReader{ctx: ctx, r: f}, m.Size+1))
	if e != nil {
		return e
	}
	if n != m.Size || hex.EncodeToString(h.Sum(nil)) != m.SHA256 {
		return errors.New("local compressed snapshot integrity mismatch")
	}
	return ctx.Err()
}

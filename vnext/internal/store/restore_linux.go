//go:build linux && sqlite_integration

package store

import (
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// RestoreVerifiedDay validates a sealed live archive into a private cache
// directory, not the writer's active directory. The caller must supply a
// trusted catalog manifest and reserve physical space for both temporary files.
// No local daily file or catalog is replaced, and no eviction is performed.
func RestoreVerifiedDay(ctx context.Context, manifest archive.Manifest, compressed io.Reader, cache string, reserve int64) (string, error) {
	return restoreVerified(ctx, manifest, compressed, cache, reserve, false)
}

// RestoreVerifiedActive is separate from sealed-day restore; an active backup
// cannot be mistaken for a complete daily archive.
func RestoreVerifiedActive(ctx context.Context, manifest archive.Manifest, compressed io.Reader, cache string, reserve int64) (string, error) {
	if _, _, e := archive.ActiveKeys(manifest); e != nil {
		return "", e
	}
	return restoreVerified(ctx, manifest, compressed, cache, reserve, true)
}
func restoreVerified(ctx context.Context, manifest archive.Manifest, compressed io.Reader, cache string, reserve int64, active bool) (string, error) {
	m := manifest
	a, b, e := dayRange(m.Day, m.Day)
	if e != nil || m.ContractID != model.Contract || m.Timezone != model.Timezone || m.From != a.UnixMilli() || m.To != b.Add(24*time.Hour).UnixMilli() || (!active && (m.SealedAt == nil || *m.SealedAt < m.To)) || (active && m.SealedAt != nil) || m.Revision < 1 || m.DataOrigin != "live" || m.ProducerCommit == "" || m.FileID == "" || len(m.Generation) < 1 || len(m.Generation) > 80 || strings.Trim(m.Generation, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_") != "" || !validSHA(m.SHA256) || !validSHA(m.RawSHA256) || compressed == nil {
		return "", errors.New("invalid sealed archive manifest")
	}
	if reserve <= 0 || reserve > archive.HardLimit || m.Size <= 0 || m.RawSize <= 0 || m.Size > reserve || m.RawSize > reserve-m.Size {
		return "", errors.New("restore reservation insufficient")
	}
	cache, e = filepath.Abs(cache)
	if e != nil {
		return "", e
	}
	real, e := filepath.EvalSymlinks(cache)
	if e != nil || real != cache {
		return "", errors.New("unsafe cache path")
	}
	st, e := os.Stat(cache)
	if e != nil || !st.IsDir() || st.Mode().Perm()&0077 != 0 {
		return "", errors.New("cache must be private directory")
	}
	final := filepath.Join(cache, m.Day+".restore."+m.Generation+".sqlite")
	if _, e = os.Lstat(final); !errors.Is(e, os.ErrNotExist) {
		return "", errors.New("restore destination exists or inaccessible")
	}
	zip, e := os.CreateTemp(cache, ".restore-*.gz.part")
	if e != nil {
		return "", e
	}
	defer os.Remove(zip.Name())
	defer zip.Close()
	h := sha256.New()
	n, e := io.Copy(io.MultiWriter(zip, h), io.LimitReader(&contextReader{ctx, compressed}, m.Size))
	if e != nil || n != m.Size || hex.EncodeToString(h.Sum(nil)) != m.SHA256 {
		return "", errors.New("compressed archive integrity mismatch")
	}
	var extra [1]byte
	if n, e := io.ReadFull(&contextReader{ctx, compressed}, extra[:]); n != 0 || !errors.Is(e, io.EOF) {
		return "", errors.New("compressed archive length mismatch")
	}
	if _, e = zip.Seek(0, io.SeekStart); e != nil {
		return "", e
	}
	buf := bufio.NewReader(zip)
	gz, e := gzip.NewReader(buf)
	if e != nil {
		return "", e
	}
	defer gz.Close()
	gz.Multistream(false)
	raw, e := os.CreateTemp(cache, ".restore-*.sqlite.part")
	if e != nil {
		return "", e
	}
	defer os.Remove(raw.Name())
	defer raw.Close()
	h = sha256.New()
	bw := &budgetWriter{w: io.MultiWriter(raw, h), remaining: m.RawSize}
	n, e = io.Copy(bw, &contextReader{ctx, gz})
	if e != nil || n != m.RawSize || hex.EncodeToString(h.Sum(nil)) != m.RawSHA256 {
		return "", errors.New("raw archive integrity mismatch")
	}
	if _, e = buf.ReadByte(); !errors.Is(e, io.EOF) {
		return "", errors.New("trailing gzip data")
	}
	if e = raw.Sync(); e != nil {
		return "", e
	}
	if e = raw.Close(); e != nil {
		return "", e
	}
	d, e := checkSnapshot(ctx, raw.Name(), m.Day)
	if e != nil {
		return "", e
	}
	if d.revision != m.Revision || d.origin != m.DataOrigin || (!active && (d.producer != m.ProducerCommit || d.sealed == nil || *d.sealed != *m.SealedAt)) || (active && d.sealed != nil) || !reflect.DeepEqual(d.counts, m.RowCounts) || !reflect.DeepEqual(d.expected, m.ExpectedCounts) || !reflect.DeepEqual(d.missing, m.MissingGridCounts) || !reflect.DeepEqual(d.through, m.GridThrough) || !reflect.DeepEqual(d.status, m.StatusCounts) || !reflect.DeepEqual(d.nulls, m.NullCounts) {
		return "", errors.New("archive metadata/counts mismatch")
	}
	if e = ctx.Err(); e != nil {
		return "", e
	}
	if e = os.Link(raw.Name(), final); e != nil {
		return "", e
	}
	dir, e := os.Open(cache)
	if e != nil {
		return "", e
	}
	e = errors.Join(dir.Sync(), dir.Close())
	if e != nil {
		return "", e
	}
	return final, nil
}

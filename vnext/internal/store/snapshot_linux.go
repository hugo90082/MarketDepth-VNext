//go:build linux && sqlite_integration

package store

import (
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// SnapshotResult is an immutable local generation. FileID and SealedAt remain
// unset: a snapshot is not an uploaded, verified or sealed day.
type SnapshotResult struct {
	Manifest archive.Manifest
	Path     string
	RawBytes int64
}

// CreateSnapshot uses SQLite's consistent VACUUM INTO snapshot of the committed
// database (including WAL). It never copies the live database file directly,
// closes the writer, changes the day, overwrites an existing generation or
// performs any remote I/O. Caller must hold an eviction lease and reserve disk
// space before calling. This isolated primitive is not a hard quota executor:
// SQLite can allocate the raw temporary file before its actual size is known.
func (m *Manager) CreateSnapshot(ctx context.Context, day, staging, generation, producer string, reserve int64) (SnapshotResult, error) {
	var out SnapshotResult
	if len(generation) == 0 || len(generation) > 80 || strings.Trim(generation, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_") != "" {
		return out, errors.New("invalid snapshot generation")
	}
	if producer == "" || reserve <= 0 || reserve > archive.HardLimit {
		return out, errors.New("producer and bounded reservation required")
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return out, errors.New("manager closed")
	}
	source, e := m.path(day)
	m.mu.Unlock()
	if e != nil {
		return out, e
	}
	// Existing source only. Refuse unknown/unsafe staging and source paths.
	st, e := os.Lstat(source)
	if e != nil {
		return out, e
	}
	if !st.Mode().IsRegular() {
		return out, errors.New("invalid source file")
	}
	staging, e = filepath.Abs(staging)
	if e != nil {
		return out, e
	}
	real, e := filepath.EvalSymlinks(staging)
	if e != nil || real != staging {
		return out, errors.New("invalid staging path")
	}
	ds, e := os.Stat(staging)
	if e != nil {
		return out, e
	}
	if !ds.IsDir() || ds.Mode().Perm()&0077 != 0 {
		return out, errors.New("unsafe staging directory")
	}
	// Estimate raw+gzip+temporary overhead conservatively from the current files.
	size := st.Size()
	if w, e := os.Stat(source + "-wal"); e == nil {
		size += w.Size()
	} else if !errors.Is(e, os.ErrNotExist) {
		return out, e
	}
	if size < 0 || size > (reserve-1_048_576)/3 || reserve < 1_048_576 {
		return out, errors.New("insufficient snapshot reservation")
	}
	final := filepath.Join(staging, day+".snapshot."+generation+".sqlite.gz")
	if _, e = os.Lstat(final); !errors.Is(e, os.ErrNotExist) {
		return out, errors.New("snapshot generation already exists or inaccessible")
	}
	raw, e := os.CreateTemp(staging, ".snapshot-*.sqlite.part")
	if e != nil {
		return out, e
	}
	rawPath := raw.Name()
	defer os.Remove(rawPath)
	if e = raw.Close(); e != nil {
		return out, e
	}
	// mode=ro remains enforced by SQLite; query_only must be off on this dedicated
	// connection to allow writing the separate destination database.
	db, e := SQLiteOpener(source, true)
	if e != nil {
		return out, e
	}
	db.SetMaxOpenConns(1)
	e = func() error {
		defer db.Close()
		conn, e := db.Conn(ctx)
		if e != nil {
			return e
		}
		defer conn.Close()
		if _, e = conn.ExecContext(ctx, "PRAGMA query_only=OFF"); e != nil {
			return e
		}
		return execVacuum(ctx, conn, rawPath)
	}()
	if e != nil {
		return out, e
	}
	st, e = os.Stat(rawPath)
	if e != nil {
		return out, e
	}
	if st.Size() <= 0 || st.Size() >= reserve {
		return out, errors.New("snapshot raw size exceeds reservation")
	}
	out.RawBytes = st.Size()
	counts, rev, e := checkSnapshot(ctx, rawPath, day)
	if e != nil {
		return out, e
	}
	f, e := os.OpenFile(rawPath, os.O_RDONLY, 0)
	if e != nil {
		return out, e
	}
	defer f.Close()
	part, e := os.CreateTemp(staging, ".snapshot-*.gz.part")
	if e != nil {
		return out, e
	}
	partPath := part.Name()
	defer os.Remove(partPath)
	defer part.Close()
	h := sha256.New()
	limit := &budgetWriter{w: io.MultiWriter(part, h), remaining: reserve - out.RawBytes}
	gz := gzip.NewWriter(limit)
	_, copyErr := io.Copy(gz, &contextReader{ctx: ctx, r: f})
	closeErr := gz.Close()
	if e = errors.Join(copyErr, closeErr); e != nil {
		return out, e
	}
	if e = part.Sync(); e != nil {
		return out, e
	}
	if e = part.Close(); e != nil {
		return out, e
	}
	compressed, e := os.Stat(partPath)
	if e != nil {
		return out, e
	}
	if compressed.Size() <= 0 || compressed.Size()+out.RawBytes > reserve {
		return out, errors.New("snapshot reservation exceeded")
	}
	// Link is no-replace atomic publication on the same filesystem; unlike
	// Rename it cannot accidentally overwrite an existing generation.
	if e = os.Link(partPath, final); e != nil {
		return out, e
	}
	dir, e := os.Open(staging)
	if e != nil {
		return out, e
	}
	e = dir.Sync()
	closeErr = dir.Close()
	if e = errors.Join(e, closeErr); e != nil {
		return out, e
	}
	a, e := time.ParseInLocation("2006-01-02", day, time.FixedZone("UTC+8", 8*3600))
	if e != nil {
		return out, e
	}
	out.Path = final
	out.Manifest = archive.Manifest{ContractID: model.Contract, Day: day, Timezone: model.Timezone, Revision: rev, Generation: generation, SHA256: hex.EncodeToString(h.Sum(nil)), Size: compressed.Size(), From: a.UnixMilli(), To: a.Add(24 * time.Hour).UnixMilli(), RowCounts: counts, ProducerCommit: producer}
	return out, nil
}
func execVacuum(ctx context.Context, c *sql.Conn, dest string) error {
	_, e := c.ExecContext(ctx, "VACUUM INTO ?", dest)
	return e
}
func checkSnapshot(ctx context.Context, path, day string) (map[string]int64, int64, error) {
	db, e := SQLiteOpener(path, true)
	if e != nil {
		return nil, 0, e
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	var integrity string
	if e = db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&integrity); e != nil || integrity != "ok" {
		return nil, 0, fmt.Errorf("snapshot quick_check: %s %v", integrity, e)
	}
	var schema int
	if e = db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&schema); e != nil || schema != 1 {
		return nil, 0, errors.New("invalid snapshot schema version")
	}
	for k, want := range map[string]string{"day": day, "contract_id": model.Contract, "timezone": model.Timezone} {
		var got string
		if e = db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key=?", k).Scan(&got); e != nil || got != want {
			return nil, 0, fmt.Errorf("snapshot metadata mismatch: %s", k)
		}
	}
	var revision int64
	if e = db.QueryRowContext(ctx, "SELECT CAST(value AS INTEGER) FROM meta WHERE key='archive_revision'").Scan(&revision); e != nil || revision < 1 {
		return nil, 0, errors.New("invalid snapshot revision")
	}
	counts := map[string]int64{}
	for _, k := range []string{string(model.Spot), string(model.F10), string(model.F1), "events"} {
		var n int64
		if e = db.QueryRowContext(ctx, "SELECT count(*) FROM "+k).Scan(&n); e != nil {
			return nil, 0, e
		}
		counts[k] = n
	}
	return counts, revision, nil
}

type budgetWriter struct {
	w         io.Writer
	remaining int64
}

func (b *budgetWriter) Write(p []byte) (int, error) {
	if int64(len(p)) > b.remaining {
		return 0, errors.New("snapshot budget exhausted")
	}
	n, e := b.w.Write(p)
	b.remaining -= int64(n)
	return n, e
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (c *contextReader) Read(p []byte) (int, error) {
	if e := c.ctx.Err(); e != nil {
		return 0, e
	}
	return c.r.Read(p)
}

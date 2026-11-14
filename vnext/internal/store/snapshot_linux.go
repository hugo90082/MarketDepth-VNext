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
	"strconv"
	"strings"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// SnapshotResult is an immutable local generation. FileID remains unset.
// SealedAt is copied only from a previously sealed day; the snapshot itself
// neither seals the writer nor proves remote verification.
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
	details, e := checkSnapshot(ctx, rawPath, day)
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
	rawHash := sha256.New()
	limit := &budgetWriter{w: io.MultiWriter(part, h), remaining: reserve - out.RawBytes}
	gz := gzip.NewWriter(limit)
	_, copyErr := io.Copy(gz, &contextReader{ctx: ctx, r: io.TeeReader(f, rawHash)})
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
	if details.sealed != nil {
		producer = details.producer
	}
	out.Manifest = archive.Manifest{ContractID: model.Contract, Day: day, Timezone: model.Timezone, Revision: details.revision, Generation: generation, SHA256: hex.EncodeToString(h.Sum(nil)), Size: compressed.Size(), From: a.UnixMilli(), To: a.Add(24 * time.Hour).UnixMilli(), RowCounts: details.counts, ProducerCommit: producer, SealedAt: details.sealed, DataOrigin: details.origin, ExpectedCounts: details.expected, MissingGridCounts: details.missing, GridThrough: details.through, NullCounts: details.nulls, StatusCounts: details.status, RawSize: out.RawBytes, RawSHA256: hex.EncodeToString(rawHash.Sum(nil))}

	return out, nil
}
func execVacuum(ctx context.Context, c *sql.Conn, dest string) error {
	_, e := c.ExecContext(ctx, "VACUUM INTO ?", dest)
	return e
}

type snapshotDetails struct {
	counts, expected, missing, through map[string]int64
	status, nulls                      map[string]map[string]int64
	revision                           int64
	origin, producer                   string
	sealed                             *int64
}

func checkSnapshot(ctx context.Context, path, day string) (snapshotDetails, error) {
	return checkSnapshotWithLegacy(ctx, path, day, nil)
}
func checkSnapshotWithLegacy(ctx context.Context, path, day string, legacy *archive.Manifest) (snapshotDetails, error) {
	var d snapshotDetails
	db, e := SQLiteOpener(path, true)
	if e != nil {
		return d, e
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if e = rejectFixtureMeta(ctx, db); e != nil {
		return d, e
	}
	var integrity string
	if e = db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&integrity); e != nil || integrity != "ok" {
		return d, fmt.Errorf("snapshot quick_check: %s %v", integrity, e)
	}
	var schema int
	if e = db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&schema); e != nil || schema != 1 {
		return d, errors.New("invalid snapshot schema version")
	}
	for k, want := range map[string]string{"day": day, "contract_id": model.Contract, "timezone": model.Timezone} {
		var got string
		if e = db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key=?", k).Scan(&got); e != nil || got != want {
			return d, fmt.Errorf("snapshot metadata mismatch: %s", k)
		}
	}
	if e = db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key='data_origin'").Scan(&d.origin); e != nil || (legacy == nil && d.origin != "live") || (legacy != nil && d.origin != "legacy") {
		return d, errors.New("unsupported snapshot origin")
	}
	var rev string
	if e = db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key='archive_revision'").Scan(&rev); e != nil {
		return d, e
	}
	d.revision, e = strconv.ParseInt(rev, 10, 64)
	if e != nil || d.revision < 1 {
		return d, errors.New("invalid snapshot revision")
	}
	a, e := time.ParseInLocation("2006-01-02", day, time.FixedZone("UTC+8", 8*3600))
	if e != nil {
		return d, e
	}
	from, to := a.UnixMilli(), a.Add(24*time.Hour).UnixMilli()
	var seal string
	e = db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key='sealed_at'").Scan(&seal)
	if e == nil {
		v, err := strconv.ParseInt(seal, 10, 64)
		if err != nil || v < to {
			return d, errors.New("invalid snapshot seal")
		}
		d.sealed = &v
		if e = db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key='producer_commit'").Scan(&d.producer); e != nil || d.producer == "" {
			return d, errors.New("sealed snapshot lacks producer")
		}
	} else if !errors.Is(e, sql.ErrNoRows) {
		return d, e
	}
	d.counts = map[string]int64{}
	d.expected = map[string]int64{}
	d.through = map[string]int64{}
	d.nulls = map[string]map[string]int64{}
	d.missing = map[string]int64{}
	d.status = map[string]map[string]int64{}
	for _, k := range []model.Kind{model.Spot, model.F10, model.F1} {
		name := string(k)
		var n, bad int64
		var last sql.NullInt64
		if e = db.QueryRowContext(ctx, "SELECT count(*),COALESCE(SUM(CASE WHEN t<? OR t>=? THEN 1 ELSE 0 END),0),max(t) FROM "+name, from, to).Scan(&n, &bad, &last); e != nil || bad != 0 {
			return d, fmt.Errorf("invalid snapshot grid %s: %v", name, e)
		}
		if legacy == nil {
			if e = db.QueryRowContext(ctx, "SELECT count(*) FROM "+name+" WHERE source IS NULL OR source<>? OR available_at IS NULL OR status='legacy_unknown'", model.LiveSource).Scan(&bad); e != nil || bad != 0 {
				return d, fmt.Errorf("non-live snapshot rows: %s", name)
			}
		}
		through := from
		if d.sealed != nil {
			through = to
		} else if last.Valid {
			through = last.Int64 + k.Interval()
		}
		keysPerGrid := int64(3)
		if k == model.Spot {
			keysPerGrid = 12
		}
		expected := (through - from) / k.Interval() * keysPerGrid
		if through > to || through < from || n > expected {
			return d, fmt.Errorf("snapshot grid count exceeds expected: %s", name)
		}
		d.through[name] = through
		d.expected[name] = expected
		d.counts[name] = n
		d.missing[name] = expected - n
		// Only fixed schema columns; NULL counts are measured independently from
		// missing grid keys. In particular, zero notional is never counted as NULL.
		cols := columns[k]
		expr := make([]string, len(cols))
		values := make([]int64, len(cols))
		args := make([]any, len(cols))
		for i, c := range cols {
			expr[i] = "COALESCE(SUM(" + c + " IS NULL),0)"
			args[i] = &values[i]
		}
		if e = db.QueryRowContext(ctx, "SELECT "+strings.Join(expr, ",")+" FROM "+name).Scan(args...); e != nil {
			return d, e
		}
		d.nulls[name] = map[string]int64{}
		for i, c := range cols {
			d.nulls[name][c] = values[i]
		}
		rs, e := db.QueryContext(ctx, "SELECT status,count(*) FROM "+name+" GROUP BY status")
		if e != nil {
			return d, e
		}
		d.status[name] = map[string]int64{}
		for rs.Next() {
			var status string
			var n int64
			if e = rs.Scan(&status, &n); e != nil {
				rs.Close()
				return d, e
			}
			d.status[name][status] = n
		}
		e = rs.Err()
		rs.Close()
		if e != nil {
			return d, e
		}
		if d.sealed != nil {
			if e = db.QueryRowContext(ctx, "SELECT count(*) FROM "+name+" WHERE available_at IS NOT NULL AND available_at>?", *d.sealed).Scan(&bad); e != nil || bad != 0 {
				return d, errors.New("row availability after seal")
			}
		}
	}
	var eventCount int64
	if e = db.QueryRowContext(ctx, "SELECT count(*) FROM events").Scan(&eventCount); e != nil {
		return d, e
	}
	d.counts["events"] = eventCount
	if legacy != nil {
		if legacy.LegacyProof == nil || legacy.SealedAt == nil {
			return d, errors.New("missing legacy proof")
		}
		want, e := legacySealedMeta(*legacy.LegacyProof, *legacy.SealedAt, legacy.ProducerCommit)
		if e != nil {
			return d, e
		}
		if e = legacySchemaMeta(ctx, db, want); e != nil {
			return d, e
		}
		if e = auditLegacyRows(ctx, db, *legacy.LegacyProof, nil); e != nil {
			return d, e
		}
	}
	return d, nil
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

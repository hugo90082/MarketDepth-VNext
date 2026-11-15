//go:build linux && sqlite_integration

package store

import (
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/contract"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/legacyproof"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func validateLegacyArchiveRow(r model.Row, day string) error {
	if rowNil(r) || r.Validate() != nil || model.Day(r.Key().T) != day || r.Kind() != model.Spot && r.Kind() != model.F1 {
		return errors.New("invalid historical row")
	}
	c := r.Base()
	if c.Source == nil || *c.Source != "legacy:v66-browser-jsonl-v1" || c.AvailableAt != nil || c.Status != "legacy_unknown" || c.Revision != 1 || c.Quality == nil {
		return errors.New("historical row provenance differs")
	}
	switch s := r.(type) {
	case *model.SpotRow:
		if s.ObservedBid != nil || s.ObservedAsk != nil || s.TrustedBid != nil || s.TrustedAsk != nil {
			return errors.New("legacy coverage promoted")
		}
	}
	return nil
}

// auditLegacyRows independently recomputes the ordered canonical digest from
// actual SQL rows. An optional sink writes into a new, empty database only.
func auditLegacyRows(ctx context.Context, db *sql.DB, p legacyproof.LegacyDayProof, sink func(model.Row) error) error {
	h := sha256.New()
	for _, k := range []model.Kind{model.Spot, model.F1} {
		rows, e := db.QueryContext(ctx, "SELECT "+strings.Join(columns[k], ",")+" FROM "+string(k)+" ORDER BY "+strings.Join(keyCols(k), ","))
		if e != nil {
			return e
		}
		var n int64
		e = func() error {
			defer rows.Close()
			for rows.Next() {
				vals := make([]any, len(columns[k]))
				args := make([]any, len(vals))
				for i := range vals {
					args[i] = &vals[i]
				}
				if e := rows.Scan(args...); e != nil {
					return e
				}
				fields := map[string]any{}
				for i, col := range columns[k] {
					v := vals[i]
					if b, ok := v.([]byte); ok {
						v = string(b)
					}
					fields[col] = v
				}
				b, e := json.Marshal(fields)
				if e != nil {
					return e
				}
				r, e := model.Decode(k, b)
				if e != nil {
					return e
				}
				if e = validateLegacyArchiveRow(r, p.Day); e != nil {
					return e
				}
				b, e = json.Marshal(r)
				if e != nil {
					return e
				}
				key := r.Key()
				digest := sha256.Sum256(b)
				fmt.Fprintf(h, "%s\t%d\t%s\t%s\t%x\n", k, key.T, key.Venue, key.Asset, digest)
				n++
				if sink != nil {
					if e = sink(r); e != nil {
						return e
					}
				}
			}
			return rows.Err()
		}()
		if e != nil {
			return e
		}
		want := p.UniqueSpot
		if k == model.F1 {
			want = p.UniqueFutures1m
		}
		if n != want {
			return errors.New("legacy count mismatch")
		}
	}
	if hex.EncodeToString(h.Sum(nil)) != p.CanonicalRowsSHA256 {
		return errors.New("legacy canonical row digest mismatch")
	}
	for _, table := range []string{"futures_10s", "events"} {
		var n int64
		if e := db.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&n); e != nil || n != 0 {
			return errors.New("historical unexpected rows")
		}
	}
	return nil
}
func legacySchemaMeta(ctx context.Context, db *sql.DB, want map[string]string) error {
	ref, e := sql.Open("sqlite3", ":memory:")
	if e != nil {
		return e
	}
	defer ref.Close()
	ref.SetMaxOpenConns(1)
	if _, e = ref.ExecContext(ctx, contract.Schema); e != nil {
		return e
	}
	x, e := schemaObjects(ctx, ref)
	if e != nil {
		return e
	}
	y, e := schemaObjects(ctx, db)
	if e != nil || !reflect.DeepEqual(x, y) {
		return errors.New("legacy schema differs")
	}
	var n, ver int
	var check string
	if e = db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&ver); e != nil || ver != 1 {
		return errors.New("legacy version differs")
	}
	if e = db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&check); e != nil || check != "ok" {
		return errors.New("legacy integrity differs")
	}
	if e = db.QueryRowContext(ctx, "SELECT count(*) FROM meta").Scan(&n); e != nil || n != len(want) {
		return errors.New("legacy metadata shape differs")
	}
	for k, v := range want {
		var got string
		if e = db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key=?", k).Scan(&got); e != nil || got != v {
			return fmt.Errorf("legacy metadata differs: %s", k)
		}
	}
	return nil
}
func legacyBaseMeta(p legacyproof.LegacyDayProof) map[string]string {
	schema := sha256.Sum256([]byte(contract.Schema))
	return map[string]string{"contract_id": model.Contract, "timezone": model.Timezone, "day": p.Day, "data_origin": "legacy", "archive_revision": "1", "source_sha256": p.Sources[0].CompressedSHA256, "adapter": p.Sources[0].Adapter, "schema_sha256": hex.EncodeToString(schema[:])}
}
func legacySealedMeta(p legacyproof.LegacyDayProof, seal int64, producer string) (map[string]string, error) {
	b, d, e := legacyproof.CanonicalLegacyProof(p)
	if e != nil {
		return nil, e
	}
	m := legacyBaseMeta(p)
	m["sealed_at"] = strconv.FormatInt(seal, 10)
	m["producer_commit"] = producer
	m["legacy_proof"] = string(b)
	m["legacy_proof_sha256"] = d
	return m, nil
}

// checkLegacySealed verifies the full proof and row digest independently of the
// caller. No candidate flags are removed from an input database.
func checkLegacySealed(ctx context.Context, db *sql.DB, m archive.Manifest) error {
	if e := archive.ValidateSealedManifest(m); e != nil {
		return e
	}
	if m.DataOrigin != "legacy" || m.LegacyProof == nil || m.SealedAt == nil {
		return errors.New("legacy manifest required")
	}
	want, e := legacySealedMeta(*m.LegacyProof, *m.SealedAt, m.ProducerCommit)
	if e != nil {
		return e
	}
	if e = legacySchemaMeta(ctx, db, want); e != nil {
		return e
	}
	return auditLegacyRows(ctx, db, *m.LegacyProof, nil)
}

// BuildReviewedLegacySnapshot is an offline primitive, not a publication grant.
// The caller must supply independently reviewed candidate/proof digests, and
// separately establish actual placement and authorization. The destination is
// a new private directory, never a writer root. Only whole V66 days supported.
func BuildReviewedLegacySnapshot(ctx context.Context, candidate, candidateSHA string, p legacyproof.LegacyDayProof, proofSHA, stage, producer string, sealedAt time.Time, reserve int64) (SnapshotResult, error) {
	var out SnapshotResult
	if e := p.ValidateV66(); e != nil {
		return out, e
	}
	_, digest, e := legacyproof.CanonicalLegacyProof(p)
	if e != nil || digest != proofSHA || !validSHA(candidateSHA) || len(producer) != 40 || strings.Trim(producer, "0123456789abcdef") != "" || sealedAt.UnixMilli() < p.CutoverMS || reserve <= 0 || reserve > archive.HardLimit {
		return out, errors.New("invalid reviewed build inputs")
	}
	candidate, e = filepath.Abs(candidate)
	if e != nil {
		return out, e
	}
	real, e := filepath.EvalSymlinks(candidate)
	if e != nil || real != candidate {
		return out, errors.New("unsafe candidate path")
	}
	before, e := auditHash(ctx, candidate)
	if e != nil || before != candidateSHA {
		return out, errors.New("candidate digest mismatch")
	}
	st, e := os.Stat(candidate)
	if e != nil || st.Size() > (reserve-1048576)/3 {
		return out, errors.New("insufficient build reserve")
	}
	stage, e = filepath.Abs(stage)
	if e != nil {
		return out, e
	}
	if e = os.Mkdir(stage, 0700); e != nil {
		return out, e
	}
	real, e = filepath.EvalSymlinks(stage)
	if e != nil || real != stage {
		return out, errors.New("unsafe output path")
	}
	// New schema, not a relabelled copy: only verified rows are inserted.
	db, e := SQLiteOpener(candidate, true)
	if e != nil {
		return out, e
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	want := legacyBaseMeta(p)
	want["candidate_only"] = "true"
	if e = legacySchemaMeta(ctx, db, want); e != nil {
		return out, e
	}
	raw := filepath.Join(stage, p.Day+".sqlite.part")
	f, e := os.OpenFile(raw, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return out, e
	}
	if e = f.Close(); e != nil {
		return out, e
	}
	defer os.Remove(raw)
	dst, e := SQLiteOpener(raw, false)
	if e != nil {
		return out, e
	}
	defer dst.Close()
	dst.SetMaxOpenConns(1)
	if _, e = dst.ExecContext(ctx, contract.Schema); e != nil {
		return out, e
	}
	tx, e := dst.BeginTx(ctx, nil)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	meta, e := legacySealedMeta(p, sealedAt.UnixMilli(), producer)
	if e != nil {
		return out, e
	}
	keys := make([]string, 0, len(meta))
	for k := range meta {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if _, e = tx.ExecContext(ctx, "INSERT INTO meta(key,value) VALUES(?,?)", k, meta[k]); e != nil {
			return out, e
		}
	}
	if e = auditLegacyRows(ctx, db, p, func(r model.Row) error {
		args, e := rowValues(r)
		if e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, insertSQL(r.Kind()), args...)
		return e
	}); e != nil {
		return out, e
	}
	if e = tx.Commit(); e != nil {
		return out, e
	}
	if e = dst.Close(); e != nil {
		return out, e
	}
	if e = db.Close(); e != nil {
		return out, e
	}
	after, e := auditHash(ctx, candidate)
	if e != nil || before != after {
		return out, errors.New("candidate changed")
	}
	a, _, e := dayRange(p.Day, p.Day)
	if e != nil {
		return out, e
	}
	seal := sealedAt.UnixMilli()
	m := archive.Manifest{ContractID: model.Contract, Timezone: model.Timezone, Day: p.Day, From: a.UnixMilli(), To: a.Add(24 * time.Hour).UnixMilli(), DataOrigin: "legacy", Revision: 1, Generation: "legacy-r1", ProducerCommit: producer, SealedAt: &seal, LegacyProof: &p, LegacyProofSHA256: proofSHA}
	st, e = os.Stat(raw)
	if e != nil || st.Size() <= 0 || st.Size() >= reserve {
		return out, errors.New("raw reserve exceeded")
	}
	m.RawSize = st.Size()
	m.RawSHA256, e = auditHash(ctx, raw)
	if e != nil {
		return out, e
	}
	// Fill actual statistics before checking full manifest and source proof.
	details, e := checkSnapshotWithLegacy(ctx, raw, p.Day, &m)
	if e != nil {
		return out, e
	}
	m.RowCounts = details.counts
	m.ExpectedCounts = details.expected
	m.MissingGridCounts = details.missing
	m.GridThrough = details.through
	m.NullCounts = details.nulls
	m.StatusCounts = details.status
	src, e := os.Open(raw)
	if e != nil {
		return out, e
	}
	defer src.Close()
	part, e := os.OpenFile(filepath.Join(stage, "archive.gz.part"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return out, e
	}
	defer os.Remove(part.Name())
	defer part.Close()
	h := sha256.New()
	bw := &budgetWriter{w: io.MultiWriter(part, h), remaining: reserve - m.RawSize}
	gz := gzip.NewWriter(bw)
	_, ce := io.Copy(gz, &contextReader{ctx, src})
	if e = errors.Join(ce, gz.Close()); e != nil {
		return out, e
	}
	if e = part.Sync(); e != nil {
		return out, e
	}
	if e = part.Close(); e != nil {
		return out, e
	}
	st, e = os.Stat(part.Name())
	if e != nil {
		return out, e
	}
	m.Size = st.Size()
	m.SHA256 = hex.EncodeToString(h.Sum(nil))
	if e = archive.ValidateSealedManifest(m); e != nil {
		return out, e
	}
	final := filepath.Join(stage, p.Day+".legacy-r1.sqlite.gz")
	if e = os.Link(part.Name(), final); e != nil {
		return out, e
	}
	dir, e := os.Open(stage)
	if e != nil {
		return out, e
	}
	if e = errors.Join(dir.Sync(), dir.Close()); e != nil {
		return out, e
	}
	return SnapshotResult{Manifest: m, Path: final, RawBytes: m.RawSize}, nil
}

// PublishPreparedLegacySnapshot performs a local, complete readback before
// any remote call, then uses the immutable two-object publisher and verifies
// both remote objects. The caller must separately approve the real placement
// and hold an exclusive import lease; this primitive has no deployment CLI.
// Retrying requires the same prepared bytes and manifest, not rebuilding them.
func PublishPreparedLegacySnapshot(ctx context.Context, remote archive.RemoteObjects, snap SnapshotResult, proofSHA, scratch string, reserve int64) (archive.Publication, error) {
	var zero archive.Publication
	b, e := json.Marshal(snap.Manifest)
	if e != nil {
		return zero, e
	}
	var m archive.Manifest
	if e = json.Unmarshal(b, &m); e != nil {
		return zero, e
	}
	if remote == nil || m.DataOrigin != "legacy" || m.FileID != "" || m.LegacyProofSHA256 != proofSHA || !validSHA(proofSHA) || reserve <= 0 || reserve > archive.HardLimit {
		return zero, errors.New("reviewed legacy snapshot required")
	}
	if e = archive.ValidateSealedManifest(m); e != nil {
		return zero, e
	}
	if m.Size > reserve/2 || m.RawSize > reserve-2*m.Size {
		return zero, errors.New("legacy publication verification reserve insufficient")
	}
	scratch, e = filepath.Abs(scratch)
	if e != nil {
		return zero, e
	}
	real, e := filepath.EvalSymlinks(scratch)
	if e != nil || real != scratch {
		return zero, errors.New("unsafe publication scratch")
	}
	st, e := os.Stat(scratch)
	if e != nil || !st.IsDir() || st.Mode().Perm()&0077 != 0 {
		return zero, errors.New("private publication scratch required")
	}
	src, e := filepath.Abs(snap.Path)
	if e != nil {
		return zero, e
	}
	real, e = filepath.EvalSymlinks(src)
	if e != nil || real != src {
		return zero, errors.New("unsafe snapshot path")
	}
	st, e = os.Lstat(src)
	if e != nil || !st.Mode().IsRegular() || st.Size() != m.Size {
		return zero, errors.New("prepared snapshot size/type differs")
	}
	f, e := os.Open(src)
	if e != nil {
		return zero, e
	}
	defer f.Close()
	opened, e := f.Stat()
	if e != nil || !os.SameFile(st, opened) {
		return zero, errors.New("prepared snapshot replaced")
	}
	tmp, e := os.MkdirTemp(scratch, "legacy-publish-")
	if e != nil {
		return zero, e
	}
	defer os.RemoveAll(tmp)
	// Pin a private exact byte copy so remote calls never depend on mutable input.
	copyFile, e := os.OpenFile(filepath.Join(tmp, "pinned.gz"), os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if e != nil {
		return zero, e
	}
	defer copyFile.Close()
	h := sha256.New()
	n, e := io.Copy(io.MultiWriter(copyFile, h), io.LimitReader(&contextReader{ctx, f}, m.Size+1))
	if e != nil || n != m.Size || hex.EncodeToString(h.Sum(nil)) != m.SHA256 {
		return zero, errors.New("prepared snapshot digest differs")
	}
	if _, e = copyFile.Seek(0, io.SeekStart); e != nil {
		return zero, e
	}
	pre := m
	pre.FileID = "local_preflight_only"
	dir, e := os.MkdirTemp(tmp, "preflight-")
	if e != nil {
		return zero, e
	}
	if _, e = RestoreVerifiedDay(ctx, pre, copyFile, dir, reserve-m.Size); e != nil {
		return zero, e
	}
	if e = os.RemoveAll(dir); e != nil {
		return zero, e
	}
	if _, e = copyFile.Seek(0, io.SeekStart); e != nil {
		return zero, e
	}
	verify := func(ctx context.Context, man archive.Manifest, r io.Reader) error {
		dir, e := os.MkdirTemp(tmp, "readback-")
		if e != nil {
			return e
		}
		defer os.RemoveAll(dir)
		_, e = RestoreVerifiedDay(ctx, man, r, dir, reserve-m.Size)
		return e
	}
	return archive.PublishLegacySealed(ctx, remote, m, copyFile, verify)
}

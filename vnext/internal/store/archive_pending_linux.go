//go:build linux && sqlite_integration

package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

// PendingArchive is a durable single-item upload spool. The exact snapshot
// must survive until both remote readbacks and catalog commit succeed.
// No automatic regeneration of an ambiguous immutable upload is permitted.
type PendingArchive struct {
	Snapshot SnapshotResult
	Active   bool
}

var ErrArchivePending = errors.New("another immutable archive upload is pending")

func (j *Journal) ArchivePending(ctx context.Context) (*PendingArchive, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.archivePending(ctx)
}
func (j *Journal) archivePending(ctx context.Context) (*PendingArchive, error) {
	var b []byte
	e := j.db.QueryRowContext(ctx, `SELECT payload FROM journal_archive_pending WHERE id=1`).Scan(&b)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var p PendingArchive
	if len(b) > 2<<20 || json.Unmarshal(b, &p) != nil || p.Snapshot.Path == "" || p.Snapshot.Manifest.FileID != "" || p.Active != (p.Snapshot.Manifest.SealedAt == nil) {
		return nil, ErrUnavailable
	}
	return &p, nil
}
func pendingBytes(p PendingArchive) ([]byte, error) {
	b, e := json.Marshal(p)
	if e != nil || len(b) > 2<<20 {
		return nil, errors.New("invalid archive intent")
	}
	return b, nil
}
func (j *Journal) checkArchiveIntent(ctx context.Context, p PendingArchive, create bool) error {
	b, e := pendingBytes(p)
	if e != nil {
		return e
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	var old []byte
	e = j.db.QueryRowContext(ctx, `SELECT payload FROM journal_archive_pending WHERE id=1`).Scan(&old)
	if e == nil {
		if string(old) != string(b) {
			return ErrArchivePending
		}
		return nil
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return e
	}
	if !create {
		return nil
	}
	if e = j.ready(ctx); e != nil {
		return e
	}
	_, e = j.db.ExecContext(ctx, `INSERT INTO journal_archive_pending(id,payload) VALUES(1,?)`, b)
	return e
}
func (j *Journal) clearArchiveIntent(ctx context.Context, p PendingArchive) error {
	b, e := pendingBytes(p)
	if e != nil {
		return e
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	r, e := j.db.ExecContext(ctx, `DELETE FROM journal_archive_pending WHERE id=1 AND payload=?`, b)
	if e != nil {
		return e
	}
	n, e := r.RowsAffected()
	if e != nil || n != 1 {
		return ErrArchivePending
	}
	return nil
}

package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
)

// RegisterArchive commits immutable remote publication evidence only. This
// does not authorize eviction, alter daily rows, or expose remote reads yet.
// All network verification must already have finished, outside this lock.
func (j *Journal) RegisterArchive(ctx context.Context, p archive.Publication) error {
	r, e := p.Record()
	if e != nil {
		return e
	}
	if e = archive.ValidateRecord(r); e != nil {
		return e
	}
	b, e := json.Marshal(r)
	if e != nil {
		return e
	}
	if len(b) > 2<<20 {
		return errors.New("archive catalog record too large")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if e = j.ready(ctx); e != nil {
		return e
	}
	var old []byte
	e = j.db.QueryRowContext(ctx, `SELECT record_json FROM journal_archive WHERE day=? AND revision=?`, r.Manifest.Day, r.Manifest.Revision).Scan(&old)
	if e == nil {
		if string(old) != string(b) {
			return errors.New("immutable archive revision conflict")
		}
		return nil
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return e
	}
	_, e = j.db.ExecContext(ctx, `INSERT INTO journal_archive(day,revision,record_json,verified_at) VALUES(?,?,?,?)`, r.Manifest.Day, r.Manifest.Revision, b, time.Now().UnixMilli())
	return e
}

// ArchiveRecord reads exact revision, or latest registered revision when 0.
// A local record is not a guarantee of current remote accessibility.
func (j *Journal) ArchiveRecord(ctx context.Context, day string, revision int64) (archive.PublishedRecord, error) {
	var r archive.PublishedRecord
	if a, e := time.Parse("2006-01-02", day); e != nil || a.Format("2006-01-02") != day || revision < 0 {
		return r, errors.New("invalid archive lookup")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	var b []byte
	var rev int64
	q := `SELECT revision,record_json FROM journal_archive WHERE day=? ORDER BY revision DESC LIMIT 1`
	args := []any{day}
	if revision > 0 {
		q = `SELECT revision,record_json FROM journal_archive WHERE day=? AND revision=?`
		args = append(args, revision)
	}
	if e := j.db.QueryRowContext(ctx, q, args...).Scan(&rev, &b); e != nil {
		return r, e
	}
	if len(b) > 2<<20 || json.Unmarshal(b, &r) != nil || r.Manifest.Day != day || r.Manifest.Revision != rev || archive.ValidateRecord(r) != nil {
		return archive.PublishedRecord{}, ErrUnavailable
	}
	return r, nil
}

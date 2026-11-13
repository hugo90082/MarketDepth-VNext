package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
)

// ActiveState retains the current verified hourly snapshot and at most one
// previous generation awaiting retirement. A third generation is rejected
// before upload by the coordinator, until the previous pair is retired.
type ActiveState struct {
	Current  archive.PublishedRecord
	Previous *archive.PublishedRecord
}

var ErrActiveRetirementPending = errors.New("previous active generation must be retired before advancing")

func decodeActive(day string, b []byte) (archive.PublishedRecord, error) {
	var r archive.PublishedRecord
	if len(b) == 0 || len(b) > 2<<20 || json.Unmarshal(b, &r) != nil || r.Manifest.Day != day || archive.ValidateActiveRecord(r) != nil {
		return r, ErrUnavailable
	}
	return r, nil
}
func (j *Journal) activeState(ctx context.Context, day string) (ActiveState, error) {
	var out ActiveState
	var a, b []byte
	if e := j.db.QueryRowContext(ctx, `SELECT current_json,previous_json FROM journal_active WHERE day=?`, day).Scan(&a, &b); e != nil {
		return out, e
	}
	r, e := decodeActive(day, a)
	if e != nil {
		return out, e
	}
	out.Current = r
	if b != nil {
		old, e := decodeActive(day, b)
		if e != nil || old.Manifest.Generation >= r.Manifest.Generation {
			return ActiveState{}, ErrUnavailable
		}
		out.Previous = &old
	}
	return out, nil
}
func (j *Journal) ActiveState(ctx context.Context, day string) (ActiveState, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.activeState(ctx, day)
}
func activeAdvance(old, next archive.Manifest) error {
	if old.Day != next.Day || old.Revision != next.Revision || next.Generation <= old.Generation {
		return errors.New("active generation regression")
	}
	for k, v := range old.GridThrough {
		if next.GridThrough[k] < v {
			return errors.New("active grid regression")
		}
	}
	for k, v := range old.RowCounts {
		if next.RowCounts[k] < v {
			return errors.New("active row count regression")
		}
	}
	return nil
}

// registerActive only accepts a freshly verified publication. The previous
// generation remains intact even if the process dies before retirement.
func (j *Journal) registerActive(ctx context.Context, p archive.Publication) error {
	r, e := p.Record()
	if e != nil {
		return e
	}
	if e = archive.ValidateActiveRecord(r); e != nil {
		return e
	}
	b, e := json.Marshal(r)
	if e != nil || len(b) > 2<<20 {
		return errors.New("invalid active catalog record")
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if e = j.ready(ctx); e != nil {
		return e
	}
	// Once a sealed record exists no further active publication is accepted.
	var n int
	if e = j.db.QueryRowContext(ctx, `SELECT count(*) FROM journal_archive WHERE day=?`, r.Manifest.Day).Scan(&n); e != nil {
		return e
	}
	if n != 0 {
		return errors.New("day already published as sealed")
	}
	s, e := j.activeState(ctx, r.Manifest.Day)
	if errors.Is(e, sql.ErrNoRows) {
		_, e = j.db.ExecContext(ctx, `INSERT INTO journal_active(day,current_json,verified_at) VALUES(?,?,?)`, r.Manifest.Day, b, time.Now().UnixMilli())
		return e
	}
	if e != nil {
		return e
	}
	old, e := json.Marshal(s.Current)
	if e != nil {
		return e
	}
	if s.Current.Manifest.Generation == r.Manifest.Generation {
		if string(old) != string(b) {
			return errors.New("active immutable generation conflict")
		}
		return nil
	}
	if s.Previous != nil {
		return ErrActiveRetirementPending
	}
	if e = activeAdvance(s.Current.Manifest, r.Manifest); e != nil {
		return e
	}
	_, e = j.db.ExecContext(ctx, `UPDATE journal_active SET previous_json=current_json,current_json=?,verified_at=? WHERE day=?`, b, time.Now().UnixMilli(), r.Manifest.Day)
	return e
}

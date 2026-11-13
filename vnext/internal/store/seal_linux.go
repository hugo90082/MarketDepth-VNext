//go:build linux

package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"os"
	"strconv"
	"time"
)

// SealInfo is a local logical seal, not proof of cloud upload or permission to
// remove the file. A checkpoint failure leaves the seal marker intact and is
// reported so a retry can finish checkpointing without rewriting metadata.
type SealInfo struct {
	Day            string
	Revision       int64
	SealedAt       int64
	ProducerCommit string
}

type journalSealer interface {
	sealDay(context.Context, string, string) (SealInfo, error)
}

// SealDay protects the catalog path against sealing a day while an intent is
// unresolved. Caller schedules this after the cross-day grace interval.
func (j *Journal) SealDay(ctx context.Context, day, producer string) (SealInfo, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	var out SealInfo
	if b, e := j.pending(ctx); e != nil {
		return out, e
	} else if b != nil {
		return out, ErrPendingWrite
	}
	target, ok := j.target.(journalSealer)
	if !ok {
		return out, errors.New("journal target cannot seal")
	}
	return target.sealDay(ctx, day, producer)
}
func (x managerJournalTarget) sealDay(ctx context.Context, day, producer string) (SealInfo, error) {
	return x.m.sealDay(ctx, day, producer, true)
}

// SealDay is only the non-catalog writer mode (e.g. isolated fixture). For the
// real catalog writer use Journal.SealDay so pending writes cannot be missed.
func (m *Manager) SealDay(ctx context.Context, day, producer string) (SealInfo, error) {
	return m.sealDay(ctx, day, producer, false)
}
func (m *Manager) sealDay(ctx context.Context, day, producer string, catalog bool) (SealInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out SealInfo
	if m.closed || m.catalogOpened != catalog || (m.catalogRequired && !catalog) {
		return out, errors.New("invalid seal writer mode")
	}
	if producer == "" || len(producer) > 128 {
		return out, errors.New("producer commit required")
	}
	loc := time.FixedZone("UTC+8", 8*3600)
	a, e := time.ParseInLocation("2006-01-02", day, loc)
	if e != nil {
		return out, e
	}
	now := m.now()
	if now.Before(a.Add(24 * time.Hour).Add(m.grace)) {
		return out, errors.New("day is active or within grace")
	}
	p, e := m.path(day)
	if e != nil {
		return out, e
	}
	if _, e = os.Stat(p); e != nil {
		return out, e
	}
	// Keep at most one writable daily handle, even while sealing a previous day.
	if m.db != nil {
		e = m.db.Close()
		m.db = nil
		m.daily = nil
		if e != nil {
			return out, e
		}
	}
	db, e := m.open(p, false)
	if e != nil {
		return out, e
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if e = validateDayMetadata(ctx, db, day); e != nil {
		return out, e
	}
	var existing string
	e = db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key='sealed_at'").Scan(&existing)
	switch {
	case e == nil:
		stamp, err := strconv.ParseInt(existing, 10, 64)
		if err != nil || stamp < a.Add(24*time.Hour).UnixMilli() || stamp > now.UnixMilli() {
			return out, errors.New("invalid existing seal timestamp")
		}
		out.SealedAt = stamp
		if e = db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key='producer_commit'").Scan(&out.ProducerCommit); e != nil || out.ProducerCommit == "" {
			return out, errors.New("existing seal lacks producer")
		}
	case errors.Is(e, sql.ErrNoRows):
		// Reopen with normal daily validation, including all data columns, WAL and
		// quick_check, before mutating a previously unsealed day.
		if _, e = OpenDaily(ctx, db, day); e != nil {
			return out, e
		}
		tx, e := db.BeginTx(ctx, nil)
		if e != nil {
			return out, e
		}
		defer tx.Rollback()
		out.SealedAt = now.UnixMilli()
		out.ProducerCommit = producer
		if _, e = tx.ExecContext(ctx, "INSERT INTO meta(key,value) VALUES('sealed_at',?)", strconv.FormatInt(out.SealedAt, 10)); e != nil {
			return out, e
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO meta(key,value) VALUES('producer_commit',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", producer); e != nil {
			return out, e
		}
		if e = tx.Commit(); e != nil {
			return out, e
		}
	default:
		return out, e
	}
	out.Day = day
	var revision string
	if e = db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key='archive_revision'").Scan(&revision); e != nil {
		return out, e
	}
	out.Revision, e = strconv.ParseInt(revision, 10, 64)
	if e != nil || out.Revision < 1 {
		return out, errors.New("invalid archive revision")
	}
	var busy, logFrames, checkpointed int
	if e = db.QueryRowContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy, &logFrames, &checkpointed); e != nil {
		return out, e
	}
	if busy != 0 || logFrames != 0 || checkpointed != 0 {
		return out, fmt.Errorf("sealed but checkpoint not complete: busy=%d log=%d checkpointed=%d", busy, logFrames, checkpointed)
	}
	return out, nil
}
func validateDayMetadata(ctx context.Context, db *sql.DB, day string) error {
	var version int
	if e := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); e != nil || version != 1 {
		return errors.New("unsupported day schema")
	}
	for name, want := range map[string]string{"day": day, "contract_id": model.Contract, "timezone": model.Timezone, "data_origin": "live"} {
		var got string
		if e := db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key=?", name).Scan(&got); e != nil || got != want {
			return fmt.Errorf("day metadata mismatch: %s", name)
		}
	}
	return nil
}

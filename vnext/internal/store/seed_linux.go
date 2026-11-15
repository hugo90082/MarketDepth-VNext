//go:build linux && sqlite_integration

package store

import (
	"context"
	"database/sql"
	"errors"
	"sort"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// SeedDay bulk-imports validated rows for a single calendar day into the daily
// SQLite database and catalog journal_change in one transaction per database.
// Existing keys in the day database are preserved without overwriting.
func (j *Journal) SeedDay(ctx context.Context, day string, rows []model.Row) (int, error) {
	if len(rows) == 0 {
		return 0, nil
	}
	target, ok := j.target.(managerJournalTarget)
	if !ok {
		return 0, errors.New("manager journal target required")
	}
	m := target.m
	j.archiveMu.Lock()
	defer j.archiveMu.Unlock()
	j.mu.Lock()
	defer j.mu.Unlock()
	if e := j.ready(ctx); e != nil {
		return 0, e
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return 0, errors.New("manager closed")
	}
	if m.db != nil {
		if e := m.db.Close(); e != nil {
			return 0, e
		}
		m.db = nil
		m.daily = nil
	}
	p, e := m.path(day)
	if e != nil {
		return 0, e
	}
	db, e := m.open(p, false)
	if e != nil {
		return 0, e
	}
	defer db.Close()
	d, e := OpenDaily(ctx, db, day)
	if e != nil {
		return 0, e
	}
	type seedItem struct {
		row  model.Row
		args []any
		hash string
	}
	type keyPair struct {
		K   model.Kind
		Key model.Key
	}
	rank := func(r model.Row) int {
		switch r.Base().Status {
		case "ok":
			return 3
		case "recovered", "partial":
			return 2
		default:
			return 1
		}
	}
	dedup := make([]model.Row, 0, len(rows))
	idxByKey := make(map[keyPair]int, len(rows))
	for _, r := range rows {
		if rowNil(r) || !r.Kind().Valid() {
			return 0, errors.New("invalid seed row")
		}
		if e := r.Validate(); e != nil {
			return 0, e
		}
		if e := validateLiveWrite(r, false); e != nil {
			return 0, e
		}
		if model.Day(r.Key().T) != day {
			return 0, errors.New("cross-day seed row")
		}
		k := keyPair{r.Kind(), r.Key()}
		if existingIdx, exists := idxByKey[k]; exists {
			if rank(r) > rank(dedup[existingIdx]) {
				dedup[existingIdx] = r
			}
			continue
		}
		idxByKey[k] = len(dedup)
		dedup = append(dedup, r)
	}
	sort.Slice(dedup, func(i, k int) bool {
		if dedup[i].Kind() != dedup[k].Kind() {
			return dedup[i].Kind() < dedup[k].Kind()
		}
		return dedup[i].Key().Less(dedup[k].Key())
	})
	items := make([]seedItem, 0, len(dedup))
	for _, r := range dedup {
		args, e := rowValues(r)
		if e != nil {
			return 0, e
		}
		h, e := journalHash(r)
		if e != nil {
			return 0, e
		}
		items = append(items, seedItem{r, args, h})
	}
	tx, e := d.db.BeginTx(ctx, nil)
	if e != nil {
		return 0, e
	}
	defer tx.Rollback()
	inserted := make([]seedItem, 0, len(items))
	for _, it := range items {
		r := it.row
		k := r.Kind()
		got, err := readRow(ctx, tx, k, r.Key())
		if err == nil {
			gh, err := journalHash(got)
			if err != nil {
				return 0, err
			}
			inserted = append(inserted, seedItem{got, nil, gh})
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return 0, err
		}
		if _, err = tx.ExecContext(ctx, insertSQL(k), it.args...); err != nil {
			return 0, err
		}
		inserted = append(inserted, it)
	}
	if e = tx.Commit(); e != nil {
		return 0, e
	}
	var busy, logFrames, checkpointed int
	_ = d.db.QueryRowContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy, &logFrames, &checkpointed)

	ctxTx, e := j.db.BeginTx(ctx, nil)
	if e != nil {
		return 0, e
	}
	defer ctxTx.Rollback()
	stmt, e := ctxTx.PrepareContext(ctx, `INSERT OR IGNORE INTO journal_change(kind,t,venue,asset,revision,hash) VALUES(?,?,?,?,?,?)`)
	if e != nil {
		return 0, e
	}
	defer stmt.Close()
	for _, it := range inserted {
		r := it.row
		k := r.Key()
		if _, e = stmt.ExecContext(ctx, r.Kind(), k.T, k.Venue, k.Asset, r.Base().Revision, it.hash); e != nil {
			return 0, e
		}
	}
	if e = ctxTx.Commit(); e != nil {
		return 0, e
	}
	return len(inserted), nil
}

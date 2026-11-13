//go:build linux

package store

import (
	"context"
	"errors"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"os"
	"path/filepath"
	"strings"
)

// OpenCatalog binds the journal to the Manager's exclusive process lock.
// Refuse silently rebuilding an index for existing daily data: that needs an
// explicit verified bootstrap/recovery path. Caller closes catalog first.
func (m *Manager) OpenCatalog(ctx context.Context) (*Journal, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, errors.New("manager closed")
	}
	if m.catalogOpened {
		return nil, errors.New("catalog already opened")
	}
	p := filepath.Join(m.root, "catalog.db")
	exists := false
	for _, f := range []string{p, p + "-wal", p + "-shm"} {
		st, e := os.Lstat(f)
		if e == nil {
			if !st.Mode().IsRegular() {
				return nil, errors.New("catalog path not regular")
			}
			if f == p {
				exists = true
			}
		} else if !errors.Is(e, os.ErrNotExist) {
			return nil, e
		}
	}
	hasDays := false
	{
		files, e := os.ReadDir(m.root)
		if e != nil {
			return nil, e
		}
		for _, f := range files {
			if strings.HasSuffix(f.Name(), ".sqlite") || strings.HasSuffix(f.Name(), ".sqlite-wal") || strings.HasSuffix(f.Name(), ".sqlite-shm") || f.Name() == "catalog.db-wal" || f.Name() == "catalog.db-shm" {
				hasDays = true
			}
		}
	}
	if !exists && hasDays {
		return nil, errors.New("existing data without catalog: explicit rebuild required")
	}
	db, e := m.open(p, false)
	if e != nil {
		return nil, e
	}
	if hasDays {
		var generation string
		if e = db.QueryRowContext(ctx, `SELECT value FROM journal_meta WHERE key='generation'`).Scan(&generation); e != nil || len(generation) != 32 {
			db.Close()
			return nil, errors.New("existing data without valid catalog: explicit rebuild required")
		}
	}
	j, e := OpenJournal(ctx, db, managerJournalTarget{m})
	if e != nil {
		db.Close()
		return nil, e
	}
	m.catalogOpened = true
	m.catalogRequired = true
	return j, nil
}

// Only the journal adapter may call the manager's catalog write path.
type managerJournalTarget struct{ m *Manager }

func (x managerJournalTarget) Put(ctx context.Context, rows []model.Row) error {
	return x.m.put(ctx, rows, true)
}
func (x managerJournalTarget) Get(ctx context.Context, k model.Kind, key model.Key) (model.Row, error) {
	return x.m.Get(ctx, k, key)
}
func (x managerJournalTarget) GetMany(ctx context.Context, keys []JournalKey) ([]model.Row, error) {
	return x.m.GetMany(ctx, keys)
}

// Reject deterministic policy failures before persisting a new intent. The
// actual put still rechecks because a day boundary can pass after preflight.
func (x managerJournalTarget) preflight(ctx context.Context, rows []model.Row) error {
	m := x.m
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || !m.catalogOpened {
		return errors.New("catalog manager closed or inactive")
	}
	if len(rows) == 0 {
		return nil
	}
	now := m.now()
	day := model.Day(rows[0].Key().T)
	if day != model.Day(now.UnixMilli()) && (m.grace <= 0 || day != model.Day(now.Add(-m.grace).UnixMilli())) {
		return errors.New("day outside active/grace window")
	}
	for _, r := range rows {
		if r.Base().AvailableAt == nil || *r.Base().AvailableAt > now.UnixMilli() || r.Key().T > now.UnixMilli() {
			return errors.New("future row refused")
		}
	}
	p, e := m.path(day)
	if e != nil {
		return e
	}
	if _, e = os.Stat(p); errors.Is(e, os.ErrNotExist) {
		return nil
	} else if e != nil {
		return e
	}
	db, e := m.open(p, true)
	if e != nil {
		return e
	}
	defer db.Close()
	if e = validateDayMetadata(ctx, db, day); e != nil {
		return e
	}
	var sealed int
	if e = db.QueryRowContext(ctx, "SELECT count(*) FROM meta WHERE key='sealed_at'").Scan(&sealed); e != nil {
		return e
	}
	if sealed != 0 {
		return errors.New("sealed day immutable")
	}
	return nil
}

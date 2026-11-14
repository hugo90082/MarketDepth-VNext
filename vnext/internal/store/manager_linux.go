//go:build linux

package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// DayOpener must use a read-only SQLite connection for readOnly=true and a
// create-capable, dedicated connection otherwise. Never reuse a production path.
type DayOpener func(path string, readOnly bool) (*sql.DB, error)

// Manager owns one exclusive process lock and at most one writable daily DB.
// It never removes, seals, or rewrites a day. A batch is atomic within one day;
// callers must split cross-day data explicitly and handle failures per day.
type Manager struct {
	mu              sync.Mutex
	root            string
	lock            *os.File
	open            DayOpener
	db              *sql.DB
	daily           *Daily
	closed          bool
	catalogOpened   bool
	catalogRequired bool
	historyCacheOpened bool
	now             func() time.Time
	grace           time.Duration
}

func NewManager(root string, open DayOpener) (*Manager, error) {
	return newManager(root, open, time.Now, 5*time.Minute)
}

func newManager(root string, open DayOpener, now func() time.Time, grace time.Duration) (*Manager, error) {
	if root == "" || open == nil {
		return nil, errors.New("root and opener required")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	if real != root {
		return nil, errors.New("symlink data root refused")
	}
	// The dedicated directory must not be writable by other users.
	st, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !st.IsDir() || st.Mode().Perm()&0077 != 0 {
		return nil, errors.New("unsafe data directory")
	}
	fd, err := syscall.Open(filepath.Join(root, ".writer.lock"), syscall.O_CREAT|syscall.O_RDWR|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
	if err != nil {
		return nil, err
	}
	lock := os.NewFile(uintptr(fd), "writer.lock")
	if err = syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		lock.Close()
		return nil, fmt.Errorf("exclusive writer lock: %w", err)
	}
	required := false
	for _, name := range []string{"catalog.db", "catalog.db-wal", "catalog.db-shm"} {
		if st, e := os.Lstat(filepath.Join(root, name)); e == nil {
			if !st.Mode().IsRegular() {
				lock.Close()
				return nil, errors.New("unsafe catalog file")
			}
			required = true
		} else if !errors.Is(e, os.ErrNotExist) {
			lock.Close()
			return nil, e
		}
	}
	return &Manager{root: root, lock: lock, open: open, now: now, grace: grace, catalogRequired: required}, nil
}

func (m *Manager) path(day string) (string, error) {
	if _, err := time.Parse("2006-01-02", day); err != nil {
		return "", err
	}
	p := filepath.Join(m.root, day+".sqlite")
	for _, name := range []string{p, p + "-wal", p + "-shm"} {
		st, e := os.Lstat(name)
		if e == nil && !st.Mode().IsRegular() {
			return "", fmt.Errorf("not a regular file: %s", name)
		}
		if e != nil && !errors.Is(e, os.ErrNotExist) {
			return "", e
		}
	}
	return p, nil
}

func (m *Manager) Put(ctx context.Context, rows []model.Row) error { return m.put(ctx, rows, false) }

func (m *Manager) put(ctx context.Context, rows []model.Row, catalog bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return errors.New("manager closed")
	}
	if m.catalogOpened != catalog || (m.catalogRequired && !catalog) {
		return errors.New("catalog writer mode mismatch")
	}
	if len(rows) == 0 {
		return nil
	}
	if len(rows) > 1000 {
		return errors.New("batch exceeds 1000 rows")
	}
	if rowNil(rows[0]) {
		return errors.New("nil row")
	}
	day := model.Day(rows[0].Key().T)
	now := m.now()
	today := model.Day(now.UnixMilli())
	if day != today && (day != model.Day(now.Add(-m.grace).UnixMilli()) || m.grace <= 0) {
		return errors.New("day outside active/grace window")
	}
	// Preflight before opening or creating a day.
	for _, r := range rows {
		if rowNil(r) {
			return errors.New("nil row")
		}
		if err := r.Validate(); err != nil {
			return err
		}
		if model.Day(r.Key().T) != day {
			return errors.New("cross-day batch rejected")
		}
		c := r.Base()
		if e := validateLiveWrite(r, catalog); e != nil {
			return e
		}
		if c.T > now.UnixMilli() || *c.AvailableAt > now.UnixMilli() {
			return errors.New("future row refused")
		}
	}
	if m.daily == nil || m.daily.day != day {
		path, err := m.path(day)
		if err != nil {
			return err
		}
		// Close previous handle first to bound memory and allow SQLite checkpoint.
		if m.db != nil {
			err = m.db.Close()
			m.db = nil
			m.daily = nil
			if err != nil {
				return err
			}
		}
		db, err := m.open(path, false)
		if err != nil {
			return err
		}
		d, err := OpenDaily(ctx, db, day)
		if err != nil {
			db.Close()
			return err
		}
		m.db = db
		m.daily = d
	}
	return m.daily.put(ctx, rows, catalog)
}

// Get opens a separate read-only handle for a committed row. The manager lock
// protects lifecycle, not long-lived history scans; a dedicated Reader follows.
func (m *Manager) Get(ctx context.Context, k model.Kind, key model.Key) (model.Row, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, errors.New("manager closed")
	}
	if !k.Valid() {
		return nil, errors.New("invalid kind")
	}
	day := model.Day(key.T)
	p, err := m.path(day)
	if err != nil {
		return nil, err
	}
	if _, err = os.Stat(p); err != nil {
		return nil, err
	}
	db, err := m.open(p, true)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if err=validateDayMetadata(ctx,db,day);err!=nil{return nil,err}
	return readRow(ctx, db, k, key)
}
func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil
	}
	m.closed = true
	var err error
	if m.db != nil {
		err = m.db.Close()
		m.db = nil
		m.daily = nil
	}
	if m.lock != nil {
		err = errors.Join(err, m.lock.Close())
		m.lock = nil
	}
	return err
}

// GetMany preserves input order, grouping lookups by calendar day and using
// one read-only connection per day. The bounded manager lock protects against
// concurrent lifecycle changes. Production eviction must also respect leases.
func (m *Manager) GetMany(ctx context.Context, keys []JournalKey) ([]model.Row, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, errors.New("manager closed")
	}
	if len(keys) > 2000 {
		return nil, errors.New("read batch exceeds 2000")
	}
	out := make([]model.Row, len(keys))
	byDay := map[string][]int{}
	for i, k := range keys {
		if !k.Kind.Valid() {
			return nil, errors.New("invalid kind")
		}
		d := model.Day(k.Key.T)
		byDay[d] = append(byDay[d], i)
	}
	for day, indices := range byDay {
		if e := func() error {
			p, e := m.path(day)
			if e != nil {
				return e
			}
			if _, e = os.Stat(p); e != nil {
				return e
			}
			db, e := m.open(p, true)
			if e != nil {
				return e
			}
			defer db.Close()
			db.SetMaxOpenConns(1)
			if e=validateDayMetadata(ctx,db,day);e!=nil{return e}
			tx, e := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
			if e != nil {
				return e
			}
			defer tx.Rollback()
			for _, i := range indices {
				k := keys[i]
				r, e := readRow(ctx, tx, k.Kind, k.Key)
				if e != nil {
					return e
				}
				out[i] = r
			}
			return tx.Commit()
		}(); e != nil {
			return nil, e
		}
	}
	return out, nil
}

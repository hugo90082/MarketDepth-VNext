//go:build linux && sqlite_integration

package store

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/lease"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// StoppedPlacement holds an EXISTING manager lock and inspects the stopped
// catalog without migrations, checkpointing, journal replay or any DB writes.
// It cannot prove that the caller enumerated every root or host.
type StoppedPlacement struct {
	root string
	lock *lease.Lock
	db   *sql.DB
	stat os.FileInfo
}

func catalogFile(root string) (os.FileInfo, error) {
	for _, s := range []string{"-wal", "-shm", "-journal"} {
		if _, e := os.Lstat(filepath.Join(root, "catalog.db"+s)); !errors.Is(e, os.ErrNotExist) {
			return nil, errors.New("catalog sidecar present or unreadable; do not checkpoint automatically")
		}
	}
	st, e := os.Lstat(filepath.Join(root, "catalog.db"))
	if e != nil || !st.Mode().IsRegular() || st.Size() <= 0 {
		return nil, errors.New("existing clean catalog required")
	}
	return st, nil
}
func OpenStoppedPlacement(ctx context.Context, root string) (out *StoppedPlacement, err error) {
	l, e := lease.AcquireStoppedRoot(root)
	if e != nil {
		return nil, e
	}
	p := &StoppedPlacement{root: root, lock: l}
	defer func() {
		if err != nil {
			p.Close()
		}
	}()
	marker := filepath.Join(root, ".marketdepth-vnext-staging")
	st, e := os.Lstat(marker)
	if e != nil || !st.Mode().IsRegular() || st.Size() != int64(len("MARKETDEPTH-VNEXT-STAGING-1\n")) {
		return nil, errors.New("staging marker required")
	}
	b, e := os.ReadFile(marker)
	if e != nil || string(b) != "MARKETDEPTH-VNEXT-STAGING-1\n" {
		return nil, errors.New("invalid staging marker")
	}
	if _, e = os.Lstat(filepath.Join(root, ".recovery-build")); !errors.Is(e, os.ErrNotExist) {
		return nil, errors.New("incomplete recovery root")
	}
	p.stat, e = catalogFile(root)
	if e != nil {
		return nil, e
	}
	u := url.URL{Scheme: "file", Path: filepath.Join(root, "catalog.db")}
	q := u.Query()
	q.Set("mode", "ro")
	q.Set("immutable", "1")
	q.Set("_query_only", "1")
	u.RawQuery = q.Encode()
	p.db, e = sql.Open("sqlite3", u.String())
	if e != nil {
		return nil, e
	}
	p.db.SetMaxOpenConns(1)
	var check, version, generation string
	if e = p.db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&check); e != nil || check != "ok" {
		return nil, errors.New("catalog integrity check failed")
	}
	if e = p.db.QueryRowContext(ctx, "SELECT value FROM journal_meta WHERE key='version'").Scan(&version); e != nil || version != "1" {
		return nil, errors.New("invalid catalog version")
	}
	if e = p.db.QueryRowContext(ctx, "SELECT value FROM journal_meta WHERE key='generation'").Scan(&generation); e != nil || len(generation) != 32 {
		return nil, errors.New("invalid catalog generation")
	}
	var recovery string
	e = p.db.QueryRowContext(ctx, "SELECT value FROM journal_meta WHERE key='recovery_state'").Scan(&recovery)
	if e != nil && !errors.Is(e, sql.ErrNoRows) || e == nil && recovery != "complete" {
		return nil, errors.New("incomplete catalog recovery")
	}
	if e = p.check(); e != nil {
		return nil, e
	}
	return p, nil
}
func (p *StoppedPlacement) check() error {
	if p == nil || p.db == nil || p.lock == nil {
		return errors.New("stopped catalog unavailable")
	}
	if e := p.lock.Check(p.lock.ID()); e != nil {
		return e
	}
	s, e := catalogFile(p.root)
	if e != nil {
		return e
	}
	if !os.SameFile(s, p.stat) || s.Size() != p.stat.Size() || s.ModTime() != p.stat.ModTime() {
		return errors.New("stopped catalog changed")
	}
	return nil
}
func (p *StoppedPlacement) Close() error {
	if p == nil {
		return nil
	}
	var e error
	if p.db != nil {
		e = p.db.Close()
		p.db = nil
	}
	return errors.Join(e, p.lock.Close())
}
func (p *StoppedPlacement) InspectLegacyPlacement(ctx context.Context, days []string, cutover int64) ([]LegacyPlacement, error) {
	if e := p.check(); e != nil {
		return nil, e
	}
	if len(days) == 0 || len(days) > 366 || cutover <= 0 || cutover > time.Now().UnixMilli() {
		return nil, errors.New("invalid placement bounds")
	}
	for _, q := range []string{"SELECT count(*) FROM journal_intent", "SELECT count(*) FROM journal_archive_pending", "SELECT count(*) FROM journal_loss WHERE state='prepared'", "SELECT count(*) FROM journal_partial_loss WHERE state='prepared'"} {
		var n int
		if e := p.db.QueryRowContext(ctx, q).Scan(&n); e != nil || n != 0 {
			return nil, errors.New("pending or unreadable catalog operation")
		}
	}
	ordered := append([]string{}, days...)
	sort.Strings(ordered)
	loc := time.FixedZone("UTC+8", 8*3600)
	bounds := map[string]time.Time{}
	reasons := map[string]map[string]bool{}
	for _, day := range ordered {
		d, e := time.ParseInLocation("2006-01-02", day, loc)
		if e != nil || d.Format("2006-01-02") != day || d.UnixMilli() < 0 || reasons[day] != nil {
			return nil, errors.New("invalid or repeated date")
		}
		bounds[day] = d
		rs := map[string]bool{}
		reasons[day] = rs
		if d.Add(24*time.Hour).UnixMilli() > cutover {
			rs["cutover_boundary_or_after"] = true
		}
		if time.Now().Before(d.Add(24*time.Hour + 5*time.Minute)) {
			rs["active_or_grace"] = true
		}
		for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
			s, e := os.Lstat(filepath.Join(p.root, day+".sqlite"+suffix))
			if e == nil {
				if !s.Mode().IsRegular() {
					return nil, errors.New("unsafe day file")
				}
				rs["local_file_or_sidecar"] = true
			} else if !errors.Is(e, os.ErrNotExist) {
				return nil, e
			}
		}
	}
	for _, table := range []string{"journal_archive", "journal_active", "journal_active_recovery", "journal_compact", "journal_loss", "journal_partial_loss", "journal_loss_sync", "journal_recovered_active"} {
		rows, e := p.db.QueryContext(ctx, "SELECT DISTINCT day FROM "+table)
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var d string
			if e = rows.Scan(&d); e != nil {
				rows.Close()
				return nil, e
			}
			if rs := reasons[d]; rs != nil {
				rs[table] = true
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
	}
	for _, table := range []string{"journal_change", "journal_repair"} {
		rows, e := p.db.QueryContext(ctx, "SELECT DISTINCT t FROM "+table+" WHERE t>=? AND t<?", bounds[ordered[0]].UnixMilli(), bounds[ordered[len(ordered)-1]].Add(24*time.Hour).UnixMilli())
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var t int64
			if e = rows.Scan(&t); e != nil {
				rows.Close()
				return nil, e
			}
			if rs := reasons[model.Day(t)]; rs != nil {
				rs[table] = true
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
	}
	// Preserved generations may exist only in journal_meta; retain their dates.
	rows, e := p.db.QueryContext(ctx, "SELECT key FROM journal_meta WHERE key LIKE 'archive_preserved/%'")
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var k string
		if e = rows.Scan(&k); e != nil {
			rows.Close()
			return nil, e
		}
		if len(k) < len("archive_preserved/")+10 {
			rows.Close()
			return nil, errors.New("invalid preserved archive key")
		}
		if rs := reasons[k[len("archive_preserved/"):len("archive_preserved/")+10]]; rs != nil {
			rs["journal_preserved"] = true
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	if e = p.check(); e != nil {
		return nil, e
	}
	out := []LegacyPlacement{}
	for _, d := range ordered {
		rs := []string{}
		for r := range reasons[d] {
			rs = append(rs, r)
		}
		sort.Strings(rs)
		out = append(out, LegacyPlacement{d, rs, len(rs) == 0})
	}
	return out, ctx.Err()
}

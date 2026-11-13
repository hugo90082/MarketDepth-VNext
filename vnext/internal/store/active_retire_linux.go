//go:build linux && sqlite_integration

package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
)

// RetirePreviousActive re-verifies the latest generation (including the
// restored SQLite) before moving the previous pair to trash. Only the single
// archive worker may call publication/retirement. No sealed objects are removed.
// A crash between the two trash calls is safely retried from the catalog.
func (j *Journal) RetirePreviousActive(ctx context.Context, remote archive.ActiveRetirer, day, cache string, reserve int64) error {
	j.archiveMu.Lock()
	defer j.archiveMu.Unlock()
	if remote == nil || reserve <= 0 || reserve > archive.HardLimit {
		return errors.New("remote and reserve required")
	}
	s, e := j.ActiveState(ctx, day)
	if e != nil {
		return e
	}
	if s.Previous == nil {
		return nil
	}
	cache, e = filepath.Abs(cache)
	if e != nil {
		return e
	}
	real, e := filepath.EvalSymlinks(cache)
	if e != nil || real != cache {
		return errors.New("unsafe retirement cache")
	}
	st, e := os.Stat(cache)
	if e != nil || !st.IsDir() || st.Mode().Perm()&0077 != 0 {
		return errors.New("private retirement cache required")
	}
	verify := func(ctx context.Context, m archive.Manifest, b io.Reader) error {
		dir, e := os.MkdirTemp(cache, ".retire-verify-")
		if e != nil {
			return e
		}
		defer os.RemoveAll(dir)
		_, e = RestoreVerifiedActive(ctx, m, b, dir, reserve)
		return e
	}
	if e = archive.VerifyPublished(ctx, remote, s.Current, true, verify); e != nil {
		return e
	}
	data, manifest, e := archive.PublishedObjects(*s.Previous, true)
	if e != nil {
		return e
	}
	// Manifest first: no discoverable previous manifest may reference a trashed DB.
	if e = remote.TrashActiveObject(ctx, manifest); e != nil {
		return e
	}
	if e = remote.TrashActiveObject(ctx, data); e != nil {
		return e
	}
	a, e := json.Marshal(s.Current)
	if e != nil {
		return e
	}
	b, e := json.Marshal(s.Previous)
	if e != nil {
		return e
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	r, e := j.db.ExecContext(ctx, `UPDATE journal_active SET previous_json=NULL WHERE day=? AND current_json=? AND previous_json=?`, day, a, b)
	if e != nil {
		return e
	}
	n, e := r.RowsAffected()
	if e != nil || n != 1 {
		return errors.New("active retirement catalog conflict")
	}
	return nil
}

// RetireSealedActive removes hourly backups for a day only after re-reading
// its verified sealed archive. It does not touch the sealed archive or local
// daily DB. Both active generations are kept in catalog until all trash calls
// succeed, so an interrupted operation is safely retried.
func (j *Journal) RetireSealedActive(ctx context.Context, remote archive.ActiveRetirer, day, cache string, reserve int64) error {
	j.archiveMu.Lock()
	defer j.archiveMu.Unlock()
	if remote == nil || reserve <= 0 || reserve > archive.HardLimit {
		return errors.New("remote and reserve required")
	}
	s, e := j.ActiveState(ctx, day)
	if errors.Is(e, sql.ErrNoRows) {
		return nil
	}
	if e != nil {
		return e
	}
	sealed, e := j.ArchiveRecord(ctx, day, 0)
	if e != nil {
		return e
	}
	if sealed.Manifest.Revision < s.Current.Manifest.Revision {
		return errors.New("sealed archive revision older than active")
	}
	for k, v := range s.Current.Manifest.RowCounts {
		if sealed.Manifest.RowCounts[k] < v {
			return errors.New("sealed archive omits active rows")
		}
	}
	for k, v := range s.Current.Manifest.GridThrough {
		if sealed.Manifest.GridThrough[k] < v {
			return errors.New("sealed archive coverage regression")
		}
	}
	cache, e = filepath.Abs(cache)
	if e != nil {
		return e
	}
	real, e := filepath.EvalSymlinks(cache)
	if e != nil || real != cache {
		return errors.New("unsafe retirement cache")
	}
	st, e := os.Stat(cache)
	if e != nil || !st.IsDir() || st.Mode().Perm()&0077 != 0 {
		return errors.New("private retirement cache required")
	}
	verify := func(ctx context.Context, m archive.Manifest, b io.Reader) error {
		dir, e := os.MkdirTemp(cache, ".sealed-retire-verify-")
		if e != nil {
			return e
		}
		defer os.RemoveAll(dir)
		_, e = RestoreVerifiedDay(ctx, m, b, dir, reserve)
		return e
	}
	if e = archive.VerifyPublished(ctx, remote, sealed, false, verify); e != nil {
		return e
	}
	for _, rec := range []*archive.PublishedRecord{s.Previous, &s.Current} {
		if rec == nil {
			continue
		}
		data, manifest, e := archive.PublishedObjects(*rec, true)
		if e != nil {
			return e
		}
		if e = remote.TrashActiveObject(ctx, manifest); e != nil {
			return e
		}
		if e = remote.TrashActiveObject(ctx, data); e != nil {
			return e
		}
	}
	a, e := json.Marshal(s.Current)
	if e != nil {
		return e
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	tx,e:=j.db.BeginTx(ctx,nil)
	if e!=nil{return e}
	defer tx.Rollback()
	r, e := tx.ExecContext(ctx, `DELETE FROM journal_active WHERE day=? AND current_json=?`, day, a)
	if e != nil {
		return e
	}
	n, e := r.RowsAffected()
	if e != nil || n != 1 {
		return errors.New("active retirement catalog conflict")
	}
	if _,e=tx.ExecContext(ctx,"DELETE FROM journal_active_recovery WHERE day=?",day);e!=nil{return e}
	return tx.Commit()
}

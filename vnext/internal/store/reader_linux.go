//go:build linux

package store

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strconv"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func (x managerJournalTarget) localDays(ctx context.Context, from, to string) ([]Day, error) {
	a, b, e := dayRange(from, to)
	if e != nil {
		return nil, e
	}
	m := x.m
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, errors.New("manager closed")
	}
	out := []Day{}
	for ; !a.After(b); a = a.Add(24 * time.Hour) {
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		day := a.Format("2006-01-02")
		p, e := m.path(day)
		if e != nil {
			return nil, e
		}
		d := Day{Day: day, State: "missing", From: a.UnixMilli(), To: a.Add(24 * time.Hour).UnixMilli(), Counts: map[model.Kind]int{}, Gaps: []Gap{}}
		if _, e = os.Stat(p); errors.Is(e, os.ErrNotExist) {
			d.Gaps = append(d.Gaps, Gap{d.From, d.To, "local_day_unavailable"})
			out = append(out, d)
			continue
		} else if e != nil {
			return nil, e
		}
		e = func() error {
			db, e := m.open(p, true)
			if e != nil {
				return e
			}
			defer db.Close()
			db.SetMaxOpenConns(1)
			if e = validateDayMetadata(ctx, db, day); e != nil {
				return e
			}
			var rev string
			if e = db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key='archive_revision'").Scan(&rev); e != nil {
				return e
			}
			d.Revision, e = strconv.ParseInt(rev, 10, 64)
			if e != nil || d.Revision < 1 {
				return ErrUnavailable
			}
			d.Counts, e = dayCounts(ctx, db)
			if e != nil {
				return e
			}
			var seal string
			e = db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key='sealed_at'").Scan(&seal)
			if errors.Is(e, sql.ErrNoRows) {
				d.State = "active_local"
				return nil
			}
			if e != nil {
				return e
			}
			stamp, e := strconv.ParseInt(seal, 10, 64)
			if e != nil || stamp < d.To {
				return ErrUnavailable
			}
			d.State = "sealed_local"
			return nil
		}()
		if e != nil {
			return nil, e
		}
		out = append(out, d)
	}
	return out, nil
}

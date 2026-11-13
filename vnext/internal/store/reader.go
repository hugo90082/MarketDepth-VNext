package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// Local reader: catalog published pointers are authoritative until remote
// archive/rebuild support is enabled. Any mismatched/unavailable pointer is
// explicit 503, not a synthetic row or a silently shortened page.
var _ Reader = (*Journal)(nil)

const historyMode = "durable-history-v1"
const latestOnly = `NOT EXISTS (SELECT 1 FROM journal_change n WHERE n.kind=c.kind AND n.t=c.t AND n.venue=c.venue AND n.asset=c.asset AND n.revision>c.revision)`

type readPointer struct {
	key  model.Key
	rev  int64
	hash string
}

func (j *Journal) ready(ctx context.Context) error {
	b, e := j.pending(ctx)
	if e != nil {
		return e
	}
	if b != nil {
		return ErrPendingWrite
	}
	var n int
	if e=j.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM journal_loss WHERE state='prepared'").Scan(&n);e!=nil{return e}
	if n!=0{return ErrPendingLoss}
	// A failed Commit may have an ambiguous result. Never keep serving with
	// an in-memory cursor generation that differs from the durable catalog.
	var generation string
	if e=j.db.QueryRowContext(ctx,"SELECT value FROM journal_meta WHERE key='generation'").Scan(&generation);e!=nil{return e}
	if generation!=j.generation{return ErrResync}
	return nil
}
func validQuery(q Query) bool {
	return q.Kind.Valid() && q.Limit >= 1 && q.Limit <= 2000 && q.From >= 0 && q.To > q.From && q.To-q.From <= 31*86400000 && q.To <= 253402300799999 && (q.Asset == "" || model.AssetOK(q.Asset)) && (q.Venue == "" || (q.Kind == model.Spot && model.VenueOK(q.Venue)))
}
func rangeWhere(q Query) (string, []any) {
	s := "c.kind=? AND c.t>=? AND c.t<?"
	args := []any{q.Kind, q.From, q.To}
	if q.Asset != "" {
		s += " AND c.asset=?"
		args = append(args, q.Asset)
	}
	if q.Venue != "" {
		s += " AND c.venue=?"
		args = append(args, q.Venue)
	}
	return s, args
}
func (j *Journal) readPointers(ctx context.Context, k model.Kind, where string, args []any, limit int) ([]readPointer, error) {
	args = append(append([]any{}, args...), limit)
	rs, e := j.db.QueryContext(ctx, `SELECT c.t,c.venue,c.asset,c.revision,c.hash FROM journal_change c WHERE `+where+` AND `+latestOnly+` ORDER BY c.t,c.venue,c.asset LIMIT ?`, args...)
	if e != nil {
		return nil, e
	}
	defer rs.Close()
	out := make([]readPointer, 0, limit)
	for rs.Next() {
		var p readPointer
		if e = rs.Scan(&p.key.T, &p.key.Venue, &p.key.Asset, &p.rev, &p.hash); e != nil {
			return nil, e
		}
		out = append(out, p)
	}
	return out, rs.Err()
}
func (j *Journal) resolvePointers(ctx context.Context, k model.Kind, p []readPointer) ([]model.Row, error) {
	keys := make([]JournalKey, 0, len(p))
	for _, x := range p {
		keys = append(keys, JournalKey{k, x.key})
	}
	rows, e := j.getMany(ctx, keys)
	if e != nil {
		return nil, fmt.Errorf("%w: catalog row unavailable", ErrUnavailable)
	}
	if len(rows) != len(p) {
		return nil, ErrUnavailable
	}
	for i, r := range rows {
		x := p[i]
		if rowNil(r) || r.Kind() != k || r.Key() != x.key || r.Base().Revision != x.rev {
			return nil, ErrUnavailable
		}
		h, e := journalHash(r)
		if e != nil || h != x.hash {
			return nil, ErrUnavailable
		}
	}
	return rows, nil
}

// History binds keyset cursor to the selected range/filter and the highest
// committed sequence in that range. Unrelated live writes do not invalidate it.
// A correction or a newly inserted old key within the query forces resync,
// including mid-export, so a paginated result never silently mixes revisions.
func (j *Journal) History(ctx context.Context, q Query) (Page, error) {
 j.mu.Lock()
 defer j.mu.Unlock()
 if has,e:=j.hasCompactLocked(ctx,q.From,q.To);e!=nil{return Page{},e}else if has{return Page{},ErrArchiveUnavailable}
 p,ptr,_,e:=j.planHistoryLocked(ctx,q)
 if e!=nil{return p,e}
 p.Rows,e=j.resolvePointers(ctx,q.Kind,ptr)
 if e!=nil{return Page{},e}
 return p,nil
}

// planHistoryLocked selects an immutable bounded page of catalog pointers.
// The caller must hold j.mu; network work must happen after releasing it.
func (j *Journal) planHistoryLocked(ctx context.Context, q Query) (Page, []readPointer, string, error) {
	p := Page{Rows: []model.Row{}, Gaps: []Gap{}, Complete: true}
	if !validQuery(q) {
		return p, nil, "", errors.New("bad history query")
	}
	if e := j.ready(ctx); e != nil {
		return p, nil, "", e
	}
	where, args := rangeWhere(q)
	var version int64
	if e := j.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(c.seq),0) FROM journal_change c WHERE `+where, args...).Scan(&version); e != nil {
		return p, nil, "", e
	}
	c := cursor{Generation: j.generation, Version: version, Kind: q.Kind, From: q.From, To: q.To, Asset: q.Asset, Venue: q.Venue, Mode: historyMode}
	if q.Cursor != "" {
		old, e := decode(q.Cursor)
		if e != nil || old.Generation != c.Generation || old.Version != version || old.Kind != q.Kind || old.From != q.From || old.To != q.To || old.Asset != q.Asset || old.Venue != q.Venue || old.Mode != historyMode || old.Key.T < q.From || old.Key.T >= q.To || old.Key.T%q.Kind.Interval() != 0 || !model.AssetOK(old.Key.Asset) || (q.Kind == model.Spot && !model.VenueOK(old.Key.Venue)) || (q.Kind != model.Spot && old.Key.Venue != "") || (q.Asset != "" && old.Key.Asset != q.Asset) || (q.Venue != "" && old.Key.Venue != q.Venue) {
			return p, nil, "", ErrResync
		}
		where += " AND (c.t,c.venue,c.asset)>(?,?,?)"
		args = append(args, old.Key.T, old.Key.Venue, old.Key.Asset)
	} else {
		var e error
		p.Gaps, e = j.gridGaps(ctx, q)
		if e != nil {
			return p, nil, "", e
		}
	}
	ptr, e := j.readPointers(ctx, q.Kind, where, args, q.Limit+1)
	if e != nil {
		return p, nil, "", e
	}
	if len(ptr) > q.Limit {
		ptr = ptr[:q.Limit]
		p.Complete = false
		c.Key = ptr[len(ptr)-1].key
		p.Next = encode(c)
	}
	return p, ptr, fmt.Sprintf("%s:%s:%d", j.generation, q.Kind, version), nil
}

// Group grid counts in SQLite; do not materialize 31 days of raw rows in RAM.
// A present NULL row counts as present (source state remains in the row).
// Bound gap ranges; pathological fragmentation requires smaller date queries.
func (j *Journal) gridGaps(ctx context.Context, q Query) ([]Gap, error) {
	out := []Gap{}
	where, args := rangeWhere(q)
	rs, e := j.db.QueryContext(ctx, `SELECT c.t,COUNT(*) FROM journal_change c WHERE `+where+` AND `+latestOnly+` GROUP BY c.t ORDER BY c.t`, args...)
	if e != nil {
		return nil, e
	}
	defer rs.Close()
	step := q.Kind.Interval()
	first := q.From - q.From%step
	if first < q.From {
		first += step
	}
	expected := 3
	if q.Asset != "" {
		expected = 1
	}
	if q.Kind == model.Spot && q.Venue == "" {
		expected *= 4
	}
	add := func(a, b int64) error {
		if b > q.To {
			b = q.To
		}
		if a >= b {
			return nil
		}
		if n := len(out); n > 0 && out[n-1].To == a {
			out[n-1].To = b
			return nil
		}
		if len(out) >= 4096 {
			return errors.New("too many gap intervals; query a smaller range")
		}
		out = append(out, Gap{a, b, "grid_missing"})
		return nil
	}
	for rs.Next() {
		var t int64
		var count int
		if e = rs.Scan(&t, &count); e != nil {
			return nil, e
		}
		if t < first || t%step != 0 || count > expected {
			return nil, ErrUnavailable
		}
		if e = add(first, t); e != nil {
			return nil, e
		}
		if count < expected {
			if e = add(t, t+step); e != nil {
				return nil, e
			}
		}
		first = t + step
	}
	if e = rs.Err(); e != nil {
		return nil, e
	}
	if e = add(first, q.To); e != nil {
		return nil, e
	}
	// Close the row cursor before reading the ledger on the single DB connection.
	if e=rs.Close();e!=nil{return nil,e}
	return j.annotateLossGaps(ctx,q.From,q.To,out)
}
func (j *Journal) Latest(ctx context.Context, k model.Kind) ([]model.Row, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if !k.Valid() {
		return nil, errors.New("bad kind")
	}
	if e := j.ready(ctx); e != nil {
		return nil, e
	}
	var t sql.NullInt64
	if e := j.db.QueryRowContext(ctx, `SELECT MAX(t) FROM journal_change WHERE kind=?`, k).Scan(&t); e != nil {
		return nil, e
	}
	if !t.Valid {
		return []model.Row{}, nil
	}
	p, e := j.readPointers(ctx, k, "c.kind=? AND c.t=?", []any{k, t.Int64}, 13)
	if e != nil {
		return nil, e
	}
	max := 3
	if k == model.Spot {
		max = 12
	}
	if len(p) > max {
		return nil, ErrUnavailable
	}
	return j.resolvePointers(ctx, k, p)
}

type localDayReader interface {
	localDays(context.Context, string, string) ([]Day, error)
}

func (j *Journal) Days(ctx context.Context, from, to string) ([]Day, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if e := j.ready(ctx); e != nil {
		return nil, e
	}
	target, ok := j.target.(localDayReader)
	if !ok {
		return nil, errors.New("local day catalog unavailable")
	}
	days,e:=target.localDays(ctx,from,to)
	if e!=nil{return nil,e}
	for i:=range days{
		loss,e:=j.lossRecordLocked(ctx,days[i].Day)
		if errors.Is(e,sql.ErrNoRows){continue}
		if e!=nil{return nil,e}
		if loss.State!="removed"||days[i].State!="missing"{return nil,ErrUnavailable}
		days[i].State="permanent_loss"
		days[i].Gaps=[]Gap{{loss.Record.From,loss.Record.To,"permanent_loss"}}
	}
	return days,nil
}
func dayRange(from, to string) (time.Time, time.Time, error) {
	loc := time.FixedZone("UTC+8", 8*3600)
	a, e := time.ParseInLocation("2006-01-02", from, loc)
	b, e2 := time.ParseInLocation("2006-01-02", to, loc)
	if e != nil || e2 != nil || a.After(b) || b.Sub(a) > 366*24*time.Hour || a.UnixMilli() < 0 {
		return time.Time{}, time.Time{}, errors.New("invalid day range")
	}
	return a, b, nil
}

// Count only fixed identifiers in a validated daily database.
func dayCounts(ctx context.Context, db *sql.DB) (map[model.Kind]int, error) {
	out := map[model.Kind]int{}
	for _, k := range []model.Kind{model.Spot, model.F10, model.F1} {
		var n int
		if e := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+string(k)).Scan(&n); e != nil {
			return nil, e
		}
		out[k] = n
	}
	return out, nil
}

// used by the local catalog and future archive manifest verification.
func validSHA(s string) bool { return len(s) == 64 && strings.Trim(s, "0123456789abcdef") == "" }

// RangeVersion is a bounded optimistic read barrier for multi-kind export.
// No long-running database transaction or writer lock is held while streaming.
// Compare the token before and after export; a changed selected range must not
// receive a complete manifest. Future writes outside the range do not matter.
func (j *Journal) RangeVersion(ctx context.Context, kinds []model.Kind, from, to int64) (string, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if len(kinds) == 0 || len(kinds) > 3 {
		return "", errors.New("invalid export kinds")
	}
	if e := j.ready(ctx); e != nil {
		return "", e
	}
	token := j.generation
	seen := map[model.Kind]bool{}
	for _, k := range kinds {
		q := Query{Kind: k, From: from, To: to, Limit: 1}
		if !validQuery(q) || seen[k] {
			return "", errors.New("invalid export range")
		}
		seen[k] = true
		where, args := rangeWhere(q)
		var seq int64
		if e := j.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(c.seq),0) FROM journal_change c WHERE `+where, args...).Scan(&seq); e != nil {
			return "", e
		}
		token += fmt.Sprintf(":%s:%d", k, seq)
	}
	return token, nil
}

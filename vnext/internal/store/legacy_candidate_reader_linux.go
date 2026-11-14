//go:build linux && sqlite_integration

package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/contract"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// CandidateReader is exclusively for offline QA. No writer, sealed download,
// live journal, or publication interface is implemented.
type CandidateReader struct {
	days        map[string]*candidateDay
	ordered     []string
	generation  string
	root        string
	manifestSHA string
}
type candidateDay struct {
	db     *sql.DB
	path   string
	info   os.FileInfo
	sha    string
	grid   *GridIndex
	counts map[model.Kind]int
}
type candidateManifest struct {
	Status        string `json:"status"`
	CandidateOnly bool   `json:"candidate_only"`
	Approved      bool   `json:"production_import_approved"`
	Sealed        bool   `json:"sealed"`
	Source        string `json:"source_sha256"`
	Schema        string `json:"schema_sha256"`
	Adapter       string `json:"adapter"`
	DayCount      int    `json:"day_count"`
	Unique        int    `json:"unique_keys"`
	Files         []struct {
		Day    string             `json:"day"`
		Name   string             `json:"name"`
		Bytes  int64              `json:"bytes"`
		SHA    string             `json:"sha256"`
		Counts map[model.Kind]int `json:"counts"`
	} `json:"files"`
}

func (r *CandidateReader) OfflineCandidate() bool { return true }
func candidateHash(p string) (string, error) {
	f, e := os.Open(p)
	if e != nil {
		return "", e
	}
	defer f.Close()
	h := sha256.New()
	_, e = io.Copy(h, f)
	return hex.EncodeToString(h.Sum(nil)), e
}
func noCandidateSidecars(p string) bool {
	for _, s := range []string{"-wal", "-shm", "-journal"} {
		if _, e := os.Lstat(p + s); !errors.Is(e, os.ErrNotExist) {
			return false
		}
	}
	return true
}
func (r *CandidateReader) Close() error {
	var e error
	for _, d := range r.days {
		e = errors.Join(e, d.db.Close())
	}
	return e
}
func (r *CandidateReader) unchanged(d *candidateDay) bool {
	st, e := os.Lstat(d.path)
	return e == nil && st.Mode().IsRegular() && os.SameFile(st, d.info) && st.Size() == d.info.Size() && st.ModTime() == d.info.ModTime() && noCandidateSidecars(d.path)
}

// VerifyFiles rehashes every file after the offline QA session. The caller
// must keep this directory exclusive, stopped and read-only throughout.
func (r *CandidateReader) VerifyFiles() error {
	h, e := candidateHash(filepath.Join(r.root, "manifest.json"))
	if e != nil || h != r.manifestSHA {
		return ErrUnavailable
	}
	for _, d := range r.days {
		h, e = candidateHash(d.path)
		if e != nil || h != d.sha || !r.unchanged(d) {
			return ErrUnavailable
		}
	}
	return nil
}
func OpenCandidateReader(ctx context.Context, root, want string) (out *CandidateReader, err error) {
	root, e := filepath.Abs(root)
	if e != nil {
		return nil, e
	}
	real, e := filepath.EvalSymlinks(root)
	if e != nil || real != root {
		return nil, errors.New("unsafe candidate root")
	}
	if _, e = os.Lstat(filepath.Join(root, ".candidate-building")); !errors.Is(e, os.ErrNotExist) {
		return nil, errors.New("incomplete candidate build")
	}
	p := filepath.Join(root, "manifest.json")
	st, e := os.Lstat(p)
	if e != nil || !st.Mode().IsRegular() || st.Size() > 4<<20 {
		return nil, ErrUnavailable
	}
	b, e := os.ReadFile(p)
	h := sha256.Sum256(b)
	if e != nil || !validSHA(want) || hex.EncodeToString(h[:]) != want {
		return nil, errors.New("candidate manifest hash mismatch")
	}
	var m candidateManifest
	schema := sha256.Sum256([]byte(contract.Schema))
	if json.Unmarshal(b, &m) != nil || m.Status != "offline_candidate_days_verified" || !m.CandidateOnly || m.Approved || m.Sealed || !validSHA(m.Source) || m.Schema != hex.EncodeToString(schema[:]) || m.Adapter != "v66-browser-jsonl-v1" || m.DayCount != len(m.Files) || len(m.Files) < 1 || len(m.Files) > 366 {
		return nil, errors.New("candidate manifest invalid")
	}
	var nonce [16]byte
	if _, e = rand.Read(nonce[:]); e != nil {
		return nil, e
	}
	r := &CandidateReader{days: map[string]*candidateDay{}, generation: hex.EncodeToString(nonce[:]), root: root, manifestSHA: want}
	defer func() {
		if err != nil {
			r.Close()
		}
	}()
	ref, e := sql.Open("sqlite3", ":memory:")
	if e != nil {
		return nil, e
	}
	defer ref.Close()
	ref.SetMaxOpenConns(1)
	if _, e = ref.ExecContext(ctx, contract.Schema); e != nil {
		return nil, e
	}
	objects, e := schemaObjects(ctx, ref)
	if e != nil {
		return nil, e
	}
	folder := filepath.Join(root, "days")
	real, e = filepath.EvalSymlinks(folder)
	if e != nil || real != folder {
		return nil, ErrUnavailable
	}
	entries, e := os.ReadDir(folder)
	if e != nil || len(entries) != len(m.Files) {
		return nil, ErrUnavailable
	}
	total := 0
	for _, f := range m.Files {
		if _, _, e = dayRange(f.Day, f.Day); e != nil || f.Name != "days/candidate-"+f.Day+".sqlite" || r.days[f.Day] != nil || !validSHA(f.SHA) || f.Bytes <= 0 || f.Bytes > 100<<20 {
			return nil, ErrUnavailable
		}
		p := filepath.Join(root, f.Name)
		st, e = os.Lstat(p)
		if e != nil || !st.Mode().IsRegular() || st.Size() != f.Bytes || !noCandidateSidecars(p) {
			return nil, ErrUnavailable
		}
		sha, e := candidateHash(p)
		if e != nil || sha != f.SHA {
			return nil, ErrUnavailable
		}
		db, e := SQLiteOpener(p, true)
		if e != nil {
			return nil, e
		}
		db.SetMaxOpenConns(1)
		d := &candidateDay{db: db, path: p, info: st, sha: sha, counts: map[model.Kind]int{}}
		r.days[f.Day] = d
		r.ordered = append(r.ordered, f.Day)
		var ver int
		var check string
		if e = db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&ver); e != nil || ver != 1 {
			return nil, ErrUnavailable
		}
		if e = db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&check); e != nil || check != "ok" {
			return nil, ErrUnavailable
		}
		actual, e := schemaObjects(ctx, db)
		if e != nil || !reflect.DeepEqual(objects, actual) {
			return nil, ErrUnavailable
		}
		meta := map[string]string{"contract_id": model.Contract, "day": f.Day, "timezone": model.Timezone, "data_origin": "legacy", "archive_revision": "1", "candidate_only": "true", "source_sha256": m.Source, "adapter": m.Adapter, "schema_sha256": m.Schema}
		var n int
		if e = db.QueryRowContext(ctx, "SELECT count(*) FROM meta").Scan(&n); e != nil || n != len(meta) {
			return nil, ErrUnavailable
		}
		for k, v := range meta {
			var got string
			if e = db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key=?", k).Scan(&got); e != nil || got != v {
				return nil, ErrUnavailable
			}
		}
		if e = db.QueryRowContext(ctx, "SELECT count(*) FROM events").Scan(&n); e != nil || n != 0 {
			return nil, ErrUnavailable
		}
		d.grid, e = NewGridIndex(f.Day, 1, sha)
		if e != nil {
			return nil, e
		}
		for _, k := range []model.Kind{model.Spot, model.F10, model.F1} {
			v := "venue"
			if k != model.Spot {
				v = "''"
			}
			rs, e := db.QueryContext(ctx, "SELECT t,"+v+",asset FROM "+string(k))
			if e != nil {
				return nil, e
			}
			for rs.Next() {
				var key model.Key
				if e = rs.Scan(&key.T, &key.Venue, &key.Asset); e != nil {
					rs.Close()
					return nil, e
				}
				if e = d.grid.Add(k, key); e != nil {
					rs.Close()
					return nil, e
				}
				d.counts[k]++
			}
			e = rs.Err()
			rs.Close()
			if e != nil || d.counts[k] != f.Counts[k] || k == model.F10 && d.counts[k] != 0 {
				return nil, ErrUnavailable
			}
			total += d.counts[k]
		}
		if !r.unchanged(d) {
			return nil, ErrUnavailable
		}
	}
	if total != m.Unique {
		return nil, ErrUnavailable
	}
	sort.Strings(r.ordered)
	return r, nil
}
func (r *CandidateReader) grid(day string) (*GridIndex, error) {
	if d := r.days[day]; d != nil {
		if !r.unchanged(d) {
			return nil, ErrUnavailable
		}
		return d.grid, nil
	}
	return NewGridIndex(day, 1, r.manifestSHA)
}
func (r *CandidateReader) History(ctx context.Context, q Query) (Page, error) {
	p := Page{Rows: []model.Row{}, Gaps: []Gap{}, Complete: true}
	if !validQuery(q) {
		return p, ErrUnavailable
	}
	c := cursor{Generation: r.generation, Kind: q.Kind, From: q.From, To: q.To, Asset: q.Asset, Venue: q.Venue, Mode: "offline-candidate-history"}
	var after *model.Key
	if q.Cursor != "" {
		old, e := decode(q.Cursor)
		if e != nil || old.Generation != c.Generation || old.Kind != c.Kind || old.From != c.From || old.To != c.To || old.Asset != c.Asset || old.Venue != c.Venue || old.Mode != c.Mode || old.Key.T < q.From || old.Key.T >= q.To || old.Key.T%q.Kind.Interval() != 0 || !model.AssetOK(old.Key.Asset) || q.Asset != "" && old.Key.Asset != q.Asset || q.Kind == model.Spot && !model.VenueOK(old.Key.Venue) || q.Kind != model.Spot && old.Key.Venue != "" || q.Venue != "" && old.Key.Venue != q.Venue {
			return p, ErrResync
		}
		after = &old.Key
	}
	a, b, e := dayRange(model.Day(q.From), model.Day(q.To-1))
	if e != nil {
		return p, e
	}
	for t := a; !t.After(b); t = t.Add(24 * time.Hour) {
		if e = ctx.Err(); e != nil {
			return Page{}, e
		}
		day := t.Format("2006-01-02")
		g, e := r.grid(day)
		if e != nil {
			return Page{}, e
		}
		if after == nil {
			gaps, e := g.Gaps(q)
			if e != nil {
				return Page{}, e
			}
			for _, gap := range gaps {
				n := len(p.Gaps)
				if n > 0 && p.Gaps[n-1].To == gap.From {
					p.Gaps[n-1].To = gap.To
				} else {
					p.Gaps = append(p.Gaps, gap)
				}
				if len(p.Gaps) > 4096 {
					return Page{}, ErrUnavailable
				}
			}
		}
		if len(p.Rows) > q.Limit {
			continue
		}
		keys, e := g.Keys(q, after, q.Limit+1-len(p.Rows))
		if e != nil {
			return Page{}, e
		}
		for _, key := range keys {
			d := r.days[day]
			if d == nil {
				return Page{}, ErrUnavailable
			}
			row, e := readRow(ctx, d.db, q.Kind, key)
			if e != nil || row.Key() != key || row.Validate() != nil || row.Base().Status != "legacy_unknown" || row.Base().AvailableAt != nil || row.Base().Source == nil || *row.Base().Source != "legacy:v66-browser-jsonl-v1" || row.Base().Revision != 1 {
				return Page{}, ErrUnavailable
			}
			p.Rows = append(p.Rows, row)
		}
	}
	if len(p.Rows) > q.Limit {
		p.Rows = p.Rows[:q.Limit]
		c.Key = p.Rows[len(p.Rows)-1].Key()
		p.Next = encode(c)
		p.Complete = false
	}
	return p, nil
}
func (r *CandidateReader) Latest(ctx context.Context, k model.Kind) ([]model.Row, error) {
	if !k.Valid() {
		return nil, ErrUnavailable
	}
	for i := len(r.ordered) - 1; i >= 0; i-- {
		d := r.days[r.ordered[i]]
		if !r.unchanged(d) {
			return nil, ErrUnavailable
		}
		if d.counts[k] == 0 {
			continue
		}
		var t int64
		if e := d.db.QueryRowContext(ctx, "SELECT max(t) FROM "+string(k)).Scan(&t); e != nil {
			return nil, e
		}
		p, e := r.History(ctx, Query{Kind: k, From: t, To: t + k.Interval(), Limit: 12})
		return p.Rows, e
	}
	return []model.Row{}, nil
}

// No durable ingestion journal exists for this candidate snapshot.
func (r *CandidateReader) Sync(context.Context, model.Kind, string) (Page, error) {
	return Page{}, ErrUnavailable
}
func (r *CandidateReader) Days(ctx context.Context, from, to string) ([]Day, error) {
	a, b, e := dayRange(from, to)
	if e != nil {
		return nil, e
	}
	out := []Day{}
	for t := a; !t.After(b); t = t.Add(24 * time.Hour) {
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		day := t.Format("2006-01-02")
		x := Day{Day: day, State: "missing", From: t.UnixMilli(), To: t.Add(24 * time.Hour).UnixMilli(), Counts: map[model.Kind]int{}, Gaps: []Gap{}}
		if d := r.days[day]; d != nil {
			if !r.unchanged(d) {
				return nil, ErrUnavailable
			}
			x.State = "candidate_only"
			x.Revision = 1
			for _, k := range []model.Kind{model.Spot, model.F10, model.F1} {
				x.Counts[k] = d.counts[k]
				if d.counts[k] < gridCapacity(k) && len(x.Gaps) == 0 {
					x.Gaps = append(x.Gaps, Gap{x.From, x.To, "candidate_has_grid_gaps_query_history"})
				}
			}
		} else {
			x.Gaps = append(x.Gaps, Gap{x.From, x.To, "local_day_unavailable"})
		}
		out = append(out, x)
	}
	return out, nil
}
func (r *CandidateReader) RangeVersion(ctx context.Context, ks []model.Kind, from, to int64) (string, error) {
	if len(ks) == 0 || len(ks) > 3 {
		return "", ErrUnavailable
	}
	seen := map[model.Kind]bool{}
	for _, k := range ks {
		if seen[k] || !validQuery(Query{Kind: k, From: from, To: to, Limit: 1}) {
			return "", ErrUnavailable
		}
		seen[k] = true
	}
	a, b, e := dayRange(model.Day(from), model.Day(to-1))
	if e != nil {
		return "", e
	}
	for t := a; !t.After(b); t = t.Add(24 * time.Hour) {
		if e = ctx.Err(); e != nil {
			return "", e
		}
		if d := r.days[t.Format("2006-01-02")]; d != nil && !r.unchanged(d) {
			return "", ErrUnavailable
		}
	}
	return fmt.Sprintf("%s:%s:%d:%d:%v", r.generation, r.manifestSHA, from, to, ks), nil
}

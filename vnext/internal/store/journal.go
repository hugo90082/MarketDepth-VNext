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
	"sync"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// JournalTarget must have a single writer and atomic same-day Put. Get must
// return only committed rows. Do not bypass Journal once it is enabled.
type JournalTarget interface {
	Writer
	Get(context.Context, model.Kind, model.Key) (model.Row, error)
}

// Journal is a separate local catalog, not a change to MD-VNEXT-1 daily schema.
// Intent is committed before the day DB; publication is committed after exact
// read-back. A crash between databases leaves an intent, never a false cursor.
// Active-day futures repairs preserve the original row in a durable audit.
type Journal struct {
	mu         sync.Mutex
	archiveMu  sync.Mutex
	db         *sql.DB
	target     JournalTarget
	generation string
}
type JournalKey struct {
	Kind model.Kind
	Key  model.Key
}

type journalBatchReader interface {
	GetMany(context.Context, []JournalKey) ([]model.Row, error)
}

func (j *Journal) getMany(ctx context.Context, keys []JournalKey) ([]model.Row, error) {
	if b, ok := j.target.(journalBatchReader); ok {
		return b.GetMany(ctx, keys)
	}
	rows := make([]model.Row, 0, len(keys))
	for _, k := range keys {
		r, e := j.target.Get(ctx, k.Kind, k.Key)
		if e != nil {
			return nil, e
		}
		rows = append(rows, r)
	}
	return rows, nil
}

type journalItem struct {
	Kind model.Kind      `json:"kind"`
	Row  json.RawMessage `json:"row"`
}

var ErrPendingWrite = errors.New("unreconciled catalog intent; writes and sync blocked")

func OpenJournal(ctx context.Context, db *sql.DB, target JournalTarget) (*Journal, error) {
	if db == nil || target == nil {
		return nil, errors.New("catalog DB and target required")
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	var mode string
	if e := db.QueryRowContext(ctx, "PRAGMA journal_mode=WAL").Scan(&mode); e != nil || mode != "wal" {
		return nil, fmt.Errorf("catalog WAL: %s %v", mode, e)
	}
	if _, e := db.ExecContext(ctx, "PRAGMA synchronous=FULL"); e != nil {
		return nil, e
	}
	tx, e := db.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	for _, q := range []string{
		`CREATE TABLE IF NOT EXISTS journal_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID`,
		`CREATE TABLE IF NOT EXISTS journal_intent(id INTEGER PRIMARY KEY CHECK(id=1),payload BLOB NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS journal_change(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,t INTEGER NOT NULL,venue TEXT NOT NULL,asset TEXT NOT NULL,revision INTEGER NOT NULL,hash TEXT NOT NULL,UNIQUE(kind,t,venue,asset,revision))`,
		`CREATE INDEX IF NOT EXISTS journal_kind_seq ON journal_change(kind,seq)`,
		`CREATE TABLE IF NOT EXISTS journal_archive_pending(id INTEGER PRIMARY KEY CHECK(id=1),payload BLOB NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS journal_active(day TEXT PRIMARY KEY,current_json BLOB NOT NULL,previous_json BLOB,verified_at INTEGER NOT NULL) WITHOUT ROWID`,
		`CREATE TABLE IF NOT EXISTS journal_archive(day TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),record_json BLOB NOT NULL,verified_at INTEGER NOT NULL,PRIMARY KEY(day,revision)) WITHOUT ROWID`,
		`CREATE TABLE IF NOT EXISTS journal_repair(kind TEXT NOT NULL,t INTEGER NOT NULL,venue TEXT NOT NULL,asset TEXT NOT NULL,new_revision INTEGER NOT NULL,old_row BLOB NOT NULL,new_hash TEXT NOT NULL,PRIMARY KEY(kind,t,venue,asset,new_revision)) WITHOUT ROWID`,
	} {
		if _, e = tx.ExecContext(ctx, q); e != nil {
			return nil, e
		}
	}
	var generation string
	e = tx.QueryRowContext(ctx, `SELECT value FROM journal_meta WHERE key='generation'`).Scan(&generation)
	if errors.Is(e, sql.ErrNoRows) {
		var b [16]byte
		if _, e = rand.Read(b[:]); e != nil {
			return nil, e
		}
		generation = hex.EncodeToString(b[:])
		if _, e = tx.ExecContext(ctx, `INSERT INTO journal_meta VALUES('generation',?),('version','1')`, generation); e != nil {
			return nil, e
		}
	} else if e != nil {
		return nil, e
	}
	var version string
	if e = tx.QueryRowContext(ctx, `SELECT value FROM journal_meta WHERE key='version'`).Scan(&version); e != nil || version != "1" || len(generation) != 32 {
		return nil, errors.New("unknown catalog version or generation")
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	var integrity string
	if e = db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&integrity); e != nil || integrity != "ok" {
		return nil, fmt.Errorf("catalog quick_check: %s %v", integrity, e)
	}
	return &Journal{db: db, target: target, generation: generation}, nil
}
func journalPayload(rows []model.Row) ([]byte, error) {
	if len(rows) == 0 || len(rows) > 1000 {
		return nil, errors.New("journal batch size")
	}
	items := make([]journalItem, 0, len(rows))
	seen := map[struct {
		Kind model.Kind
		Key  model.Key
	}]bool{}
	day := ""
	for _, r := range rows {
		if rowNil(r) || !r.Kind().Valid() {
			return nil, errors.New("invalid journal row")
		}
		if e := r.Validate(); e != nil {
			return nil, e
		}
		if e := validateLiveWrite(r, true); e != nil {
			return nil, e
		}
		d := model.Day(r.Key().T)
		if day == "" {
			day = d
		}
		if d != day {
			return nil, errors.New("cross-day journal batch")
		}
		k := struct {
			Kind model.Kind
			Key  model.Key
		}{r.Kind(), r.Key()}
		if seen[k] {
			return nil, errors.New("duplicate journal key")
		}
		seen[k] = true
		b, e := json.Marshal(r)
		if e != nil {
			return nil, e
		}
		items = append(items, journalItem{r.Kind(), b})
	}
	b, err := json.Marshal(items)
	if len(b) > 4*1024*1024 {
		return nil, errors.New("journal intent exceeds 4 MiB")
	}
	return b, err
}
func decodeJournalPayload(b []byte) ([]model.Row, error) {
	var items []journalItem
	if e := json.Unmarshal(b, &items); e != nil {
		return nil, e
	}
	rows := make([]model.Row, 0, len(items))
	for _, i := range items {
		r, e := model.Decode(i.Kind, i.Row)
		if e != nil {
			return nil, e
		}
		rows = append(rows, r)
	}
	if _, e := journalPayload(rows); e != nil {
		return nil, e
	}
	return rows, nil
}
func journalHash(r model.Row) (string, error) {
	b, e := json.Marshal(r)
	if e != nil {
		return "", e
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:]), nil
}
func (j *Journal) pending(ctx context.Context) ([]byte, error) {
	var b []byte
	e := j.db.QueryRowContext(ctx, `SELECT payload FROM journal_intent WHERE id=1`).Scan(&b)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	return b, e
}

// Put records durable intent, commits data, verifies and publishes. A failed
// or ambiguous data commit retains the intent; Recover must resolve it before
// later writes. Identical retry is safe, including after publication.
func (j *Journal) Put(ctx context.Context, rows []model.Row) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	if len(rows) == 0 {
		return nil
	}
	b, e := journalPayload(rows)
	if e != nil {
		return e
	}
	if p, e := j.pending(ctx); e != nil {
		return e
	} else if p != nil {
		return ErrPendingWrite
	}
	// Decode a private copy to avoid pointer mutation by caller after intent.
	owned, e := decodeJournalPayload(b)
	if e != nil {
		return e
	}
	// Reject conflict with already-published rows before staging an intent.
	allPublished := true
	type repairAudit struct {
		r    model.Row
		old  []byte
		hash string
	}
	var audits []repairAudit
	for _, r := range owned {
		var old string
		k := r.Key()
		e = j.db.QueryRowContext(ctx, `SELECT hash FROM journal_change WHERE kind=? AND t=? AND venue=? AND asset=? AND revision=?`, r.Kind(), k.T, k.Venue, k.Asset, r.Base().Revision).Scan(&old)
		if e == nil {
			h, e := journalHash(r)
			if e != nil {
				return e
			}
			if h != old {
				return errors.New("published revision conflict")
			}
			if e = j.verify(ctx, []model.Row{r}); e != nil {
				return e
			}
		} else if !errors.Is(e, sql.ErrNoRows) {
			return e
		} else {
			allPublished = false
			if r.Base().Revision > 1 {
				prior, e := j.target.Get(ctx, r.Kind(), k)
				if e != nil {
					return e
				}
				if e = validateRepair(prior, r); e != nil {
					return e
				}
				ph, e := journalHash(prior)
				if e != nil {
					return e
				}
				var published string
				e = j.db.QueryRowContext(ctx, `SELECT hash FROM journal_change WHERE kind=? AND t=? AND venue=? AND asset=? AND revision=?`, r.Kind(), k.T, k.Venue, k.Asset, prior.Base().Revision).Scan(&published)
				if e != nil || ph != published {
					return errors.New("repair prior version not verified in catalog")
				}
				oldJSON, e := json.Marshal(prior)
				if e != nil {
					return e
				}
				h, e := journalHash(r)
				if e != nil {
					return e
				}
				audits = append(audits, repairAudit{r, oldJSON, h})
			}
		}
	}
	if allPublished {
		return j.verify(ctx, owned)
	}
	if target, ok := j.target.(interface {
		preflight(context.Context, []model.Row) error
	}); ok {
		if e = target.preflight(ctx, owned); e != nil {
			return e
		}
	}
	tx, e := j.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for _, a := range audits {
		k := a.r.Key()
		if _, e = tx.ExecContext(ctx, `INSERT INTO journal_repair VALUES(?,?,?,?,?,?,?)`, a.r.Kind(), k.T, k.Venue, k.Asset, a.r.Base().Revision, a.old, a.hash); e != nil {
			return e
		}
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO journal_intent(id,payload) VALUES(1,?)`, b); e != nil {
		return e
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	if e = j.target.Put(ctx, owned); e != nil {
		return fmt.Errorf("%w: %v", ErrPendingWrite, e)
	}
	return j.publish(ctx, owned)
}

// Recover first checks committed rows, including an expired previous day. If
// not all match, retry the identical batch through the original writer policy.
// A conflict/expired absent row remains blocked for explicit reconciliation.
func (j *Journal) Recover(ctx context.Context) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	b, e := j.pending(ctx)
	if e != nil || b == nil {
		return e
	}
	rows, e := decodeJournalPayload(b)
	if e != nil {
		return e
	}
	if e = j.verify(ctx, rows); e != nil {
		if e = j.target.Put(ctx, rows); e != nil {
			return fmt.Errorf("%w: %v", ErrPendingWrite, e)
		}
	}
	return j.publish(ctx, rows)
}
func (j *Journal) verify(ctx context.Context, rows []model.Row) error {
	keys := make([]JournalKey, 0, len(rows))
	for _, r := range rows {
		keys = append(keys, JournalKey{r.Kind(), r.Key()})
	}
	gotRows, e := j.getMany(ctx, keys)
	if e != nil {
		return e
	}
	if len(gotRows) != len(rows) {
		return errors.New("journal readback count mismatch")
	}
	for i, r := range rows {
		got := gotRows[i]
		if rowNil(got) || got.Kind() != r.Kind() || got.Key() != r.Key() {
			return errors.New("journal readback key mismatch")
		}
		a, e := journalHash(r)
		if e != nil {
			return e
		}
		b, e := journalHash(got)
		if e != nil || a != b {
			return errors.New("journal readback mismatch")
		}
	}
	return nil
}
func (j *Journal) publish(ctx context.Context, rows []model.Row) error {
	if e := j.verify(ctx, rows); e != nil {
		return fmt.Errorf("%w: %v", ErrPendingWrite, e)
	}
	tx, e := j.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for _, r := range rows {
		k := r.Key()
		h, e := journalHash(r)
		if e != nil {
			return e
		}
		if r.Base().Revision > 1 {
			var priorRaw []byte
			var newHash string
			if e = tx.QueryRowContext(ctx, `SELECT old_row,new_hash FROM journal_repair WHERE kind=? AND t=? AND venue=? AND asset=? AND new_revision=?`, r.Kind(), k.T, k.Venue, k.Asset, r.Base().Revision).Scan(&priorRaw, &newHash); e != nil || newHash != h {
				return errors.New("missing or mismatched repair audit")
			}
			prior, e := model.Decode(r.Kind(), priorRaw)
			if e != nil {
				return e
			}
			if e = validateRepair(prior, r); e != nil {
				return e
			}
			ph, e := journalHash(prior)
			if e != nil {
				return e
			}
			var phPublished string
			if e = tx.QueryRowContext(ctx, `SELECT hash FROM journal_change WHERE kind=? AND t=? AND venue=? AND asset=? AND revision=?`, r.Kind(), k.T, k.Venue, k.Asset, prior.Base().Revision).Scan(&phPublished); e != nil || phPublished != ph {
				return errors.New("repair audit prior hash mismatch")
			}
		}
		var old string
		e = tx.QueryRowContext(ctx, `SELECT hash FROM journal_change WHERE kind=? AND t=? AND venue=? AND asset=? AND revision=?`, r.Kind(), k.T, k.Venue, k.Asset, r.Base().Revision).Scan(&old)
		if e == nil {
			if old != h {
				return errors.New("journal hash conflict")
			}
			continue
		}
		if !errors.Is(e, sql.ErrNoRows) {
			return e
		}
		if _, e = tx.ExecContext(ctx, `INSERT INTO journal_change(kind,t,venue,asset,revision,hash) VALUES(?,?,?,?,?,?)`, r.Kind(), k.T, k.Venue, k.Asset, r.Base().Revision, h); e != nil {
			return e
		}
	}
	if _, e = tx.ExecContext(ctx, `DELETE FROM journal_intent WHERE id=1`); e != nil {
		return e
	}
	return tx.Commit()
}

// Sync returns committed change pointers resolved to exact row revisions. If a
// referenced day is evicted/corrupted or changed without a compatible journal,
// return ErrResync rather than silently skipping. No pruning yet.
func (j *Journal) Sync(ctx context.Context, k model.Kind, s string) (Page, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	p := Page{Rows: []model.Row{}, Gaps: []Gap{}, Complete: true}
	if !k.Valid() {
		return p, errors.New("invalid kind")
	}
	if b, e := j.pending(ctx); e != nil {
		return p, e
	} else if b != nil {
		return p, ErrPendingWrite
	}
	c := cursor{Generation: j.generation, Kind: k, Mode: "durable-sync"}
	var seq int64
	if s != "" {
		v, e := decode(s)
		if e != nil || v.Generation != c.Generation || v.Kind != k || v.Mode != c.Mode || v.Seq < 0 {
			return p, ErrResync
		}
		seq = int64(v.Seq)
	}
	var max int64
	if e := j.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(seq),0) FROM journal_change`).Scan(&max); e != nil {
		return p, e
	}
	if seq > max {
		return p, ErrResync
	}
	rs, e := j.db.QueryContext(ctx, `SELECT c.seq,c.t,c.venue,c.asset,c.revision,c.hash FROM journal_change c WHERE c.kind=? AND c.seq>? AND NOT EXISTS (SELECT 1 FROM journal_change newer WHERE newer.kind=c.kind AND newer.t=c.t AND newer.venue=c.venue AND newer.asset=c.asset AND newer.revision>c.revision) ORDER BY c.seq LIMIT 2001`, k, seq)
	if e != nil {
		return p, e
	}
	type change struct {
		seq  int64
		key  model.Key
		rev  int64
		hash string
	}
	changes := make([]change, 0, 2001)
	for rs.Next() {
		var x change
		if e = rs.Scan(&x.seq, &x.key.T, &x.key.Venue, &x.key.Asset, &x.rev, &x.hash); e != nil {
			rs.Close()
			return p, e
		}
		changes = append(changes, x)
	}
	e = rs.Err()
	rs.Close()
	if e != nil {
		return p, e
	}
	if len(changes) > 2000 {
		changes = changes[:2000]
		p.Complete = false
	}
	keys := make([]JournalKey, 0, len(changes))
	for _, x := range changes {
		keys = append(keys, JournalKey{k, x.key})
	}
	rows, e := j.getMany(ctx, keys)
	if e != nil || len(rows) != len(changes) {
		return Page{}, ErrResync
	}
	for i, x := range changes {
		r := rows[i]
		if rowNil(r) || r.Kind() != k || r.Key() != x.key || r.Base().Revision != x.rev {
			return Page{}, ErrResync
		}
		h, e := journalHash(r)
		if e != nil || h != x.hash {
			return Page{}, ErrResync
		}
		p.Rows = append(p.Rows, r)
		seq = x.seq
	}
	if p.Complete {
		seq = max
	}
	c.Seq = int(seq)
	if int64(c.Seq) != seq {
		return Page{}, ErrResync
	}
	p.Next = encode(c)
	return p, nil
}

// Close must be called after draining the writer queue, before closing Manager.
func (j *Journal) Close() error { j.mu.Lock(); defer j.mu.Unlock(); return j.db.Close() }

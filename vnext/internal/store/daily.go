package store

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/contract"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// Daily is one writable Taiwanese calendar day. The caller owns the DB handle,
// selects its driver and path, and must not open a second writer for this file.
// This is a storage primitive, not a complete Reader or production service.
type Daily struct {
	db  *sql.DB
	day string
	mu  sync.Mutex
}

var columns = map[model.Kind][]string{
	model.Spot: strings.Fields("t available_at venue asset bid_price ask_price mid_price bid_0_100 ask_0_100 bid_100_200 ask_100_200 bid_200_300 ask_200_300 bid_300_500 ask_300_500 bid_500_750 ask_500_750 observed_bid_bps observed_ask_bps trusted_bid_bps trusted_ask_bps captured_at status source quality_json revision"),
	model.F10:  strings.Fields("t available_at asset open high low close buy_qty sell_qty buy_usdt sell_usdt agg_count first_agg_id last_agg_id first_trade_id last_trade_id status source quality_json revision"),
	model.F1:   strings.Fields("t available_at asset open high low close volume quote_volume taker_buy_qty taker_buy_usdt trade_count status source quality_json revision"),
}

func keyCols(k model.Kind) []string {
	if k == model.Spot {
		return []string{"t", "venue", "asset"}
	}
	return []string{"t", "asset"}
}
func keyArgs(k model.Kind, key model.Key) []any {
	if k == model.Spot {
		return []any{key.T, key.Venue, key.Asset}
	}
	return []any{key.T, key.Asset}
}
func whereKey(k model.Kind) string { return strings.Join(keyCols(k), "=? AND ") + "=?" }
func insertSQL(k model.Kind) string {
	c := columns[k]
	marks := make([]string, len(c))
	for i := range marks {
		marks[i] = "?"
	}
	return "INSERT INTO " + string(k) + " (" + strings.Join(c, ",") + ") VALUES (" + strings.Join(marks, ",") + ")"
}

// OpenDaily refuses an unknown existing DB; schema initialization is transactional.
// No RemoveAll, migrations, filesystem cleanup or implicit sealing.
func OpenDaily(ctx context.Context, db *sql.DB, day string) (*Daily, error) {
	if _, e := time.Parse("2006-01-02", day); e != nil {
		return nil, e
	}
	if db == nil {
		return nil, errors.New("nil database")
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if _, e := db.ExecContext(ctx, "PRAGMA busy_timeout=5000"); e != nil {
		return nil, e
	}
	var count, version int
	if e := db.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").Scan(&count); e != nil {
		return nil, e
	}
	if e := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); e != nil {
		return nil, e
	}
	if count == 0 && version == 0 {
		tx, e := db.BeginTx(ctx, nil)
		if e != nil {
			return nil, e
		}
		defer tx.Rollback()
		// Execute statements separately for database/sql driver portability. The embedded DDL has no semicolons in literals.
		var ddl []string
		for _, line := range strings.Split(contract.Schema, "\n") {
			if !strings.HasPrefix(strings.TrimSpace(line), "--") {
				ddl = append(ddl, line)
			}
		}
		for _, line := range strings.Split(strings.Join(ddl, "\n"), ";") {
			if strings.TrimSpace(line) == "" {
				continue
			}
			if _, e = tx.ExecContext(ctx, line); e != nil {
				return nil, fmt.Errorf("schema: %w", e)
			}
		}
		for k, v := range map[string]string{"contract_id": model.Contract, "day": day, "timezone": model.Timezone, "data_origin": "live", "archive_revision": "1", "created_at": fmt.Sprint(time.Now().UnixMilli())} {
			if _, e = tx.ExecContext(ctx, "INSERT INTO meta(key,value) VALUES(?,?)", k, v); e != nil {
				return nil, e
			}
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
	} else {
		if version != 1 {
			return nil, errors.New("unsupported SQLite schema version")
		}
		for k, want := range map[string]string{"contract_id": model.Contract, "day": day, "timezone": model.Timezone, "data_origin": "live"} {
			var got string
			if e := db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key=?", k).Scan(&got); e != nil || got != want {
				return nil, fmt.Errorf("database metadata mismatch: %s", k)
			}
		}
		var sealed string
		e := db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key='sealed_at'").Scan(&sealed)
		if e == nil {
			return nil, errors.New("sealed DB is read-only")
		}
		if !errors.Is(e, sql.ErrNoRows) {
			return nil, e
		}
	}
	// Validate all tables' actual columns, not only user_version.
	for k, expected := range columns {
		rs, e := db.QueryContext(ctx, "PRAGMA table_info("+string(k)+")")
		if e != nil {
			return nil, e
		}
		got := map[string]bool{}
		for rs.Next() {
			var cid, notnull, pk int
			var name, typ string
			var def any
			if e = rs.Scan(&cid, &name, &typ, &notnull, &def, &pk); e != nil {
				rs.Close()
				return nil, e
			}
			got[name] = true
		}
		e = rs.Err()
		rs.Close()
		if e != nil {
			return nil, e
		}
		if len(got) != len(expected) {
			return nil, fmt.Errorf("schema mismatch: %s", k)
		}
		for _, c := range expected {
			if !got[c] {
				return nil, fmt.Errorf("missing column %s.%s", k, c)
			}
		}
	}
	var mode string
	if e := db.QueryRowContext(ctx, "PRAGMA journal_mode=WAL").Scan(&mode); e != nil {
		return nil, e
	}
	if !strings.EqualFold(mode, "wal") {
		return nil, errors.New("WAL not enabled")
	}
	for _, q := range []string{"PRAGMA synchronous=FULL", "PRAGMA foreign_keys=ON", "PRAGMA wal_autocheckpoint=1000"} {
		if _, e := db.ExecContext(ctx, q); e != nil {
			return nil, e
		}
	}
	var integrity string
	if e := db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&integrity); e != nil || integrity != "ok" {
		return nil, fmt.Errorf("quick_check failed: %s %v", integrity, e)
	}
	return &Daily{db: db, day: day}, nil
}

// rowValues converts the typed JSON contract without coercing integer IDs to float64.
// Explicit fixed columns only; a nullable field stays SQL NULL, confirmed zero stays zero.
func rowValues(r model.Row) ([]any, error) {
	b, e := json.Marshal(r)
	if e != nil {
		return nil, e
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	var m map[string]any
	if e = dec.Decode(&m); e != nil {
		return nil, e
	}
	cols := columns[r.Kind()]
	if len(m) != len(cols) {
		return nil, errors.New("row/schema mismatch")
	}
	out := make([]any, 0, len(cols))
	for _, c := range cols {
		v, ok := m[c]
		if !ok {
			return nil, fmt.Errorf("missing %s", c)
		}
		switch n := v.(type) {
		case json.Number:
			if i, err := n.Int64(); err == nil {
				out = append(out, i)
			} else {
				f, err := n.Float64()
				if err != nil {
					return nil, err
				}
				out = append(out, f)
			}
		case nil, string:
			out = append(out, v)
		default:
			return nil, fmt.Errorf("unexpected type for %s", c)
		}
	}
	return out, nil
}

// Put accepts initial live rows only. Corrections need a durable intent/journal
// and explicit authorization policy; do not silently overwrite valid history.
// Retry of a byte-identical revision is a no-op; different contents are refused.
func (d *Daily) Put(ctx context.Context, rows []model.Row) error { return d.put(ctx, rows, false) }

func (d *Daily) put(ctx context.Context, rows []model.Row, allowRepair bool) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(rows) == 0 {
		return nil
	}
	if len(rows) > 1000 {
		return errors.New("batch exceeds 1000 rows")
	}
	type entry struct {
		row  model.Row
		args []any
	}
	pending := make([]entry, 0, len(rows))
	seen := map[struct {
		K   model.Kind
		Key model.Key
	}]bool{}
	for _, r := range rows {
		if rowNil(r) {
			return errors.New("nil row")
		}
		if !r.Kind().Valid() {
			return errors.New("invalid kind")
		}
		if e := r.Validate(); e != nil {
			return e
		}
		c := r.Base()
		if e := validateLiveWrite(r, allowRepair); e != nil {
			return e
		}
		if model.Day(c.T) != d.day {
			return errors.New("cross-day batch rejected")
		}
		k := struct {
			K   model.Kind
			Key model.Key
		}{r.Kind(), r.Key()}
		if seen[k] {
			return errors.New("duplicate batch key")
		}
		seen[k] = true
		a, e := rowValues(r)
		if e != nil {
			return e
		}
		pending = append(pending, entry{r, a})
	}
	tx, e := d.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for _, x := range pending {
		r := x.row
		k := r.Kind()
		old, e := readRow(ctx, tx, k, r.Key())
		if e == nil {
			a, _ := json.Marshal(old)
			b, _ := json.Marshal(r)
			if bytes.Equal(a, b) {
				continue
			}
			if !allowRepair {
				return errors.New("existing row differs; correction path not enabled")
			}
			if e = validateRepair(old, r); e != nil {
				return e
			}
			// All fixed columns, guarded by prior revision; transaction also records repair.
			assignments := make([]string, len(columns[k]))
			for i, c := range columns[k] {
				assignments[i] = c + "=?"
			}
			args := append(append([]any{}, x.args...), keyArgs(k, r.Key())...)
			args = append(args, old.Base().Revision)
			result, err := tx.ExecContext(ctx, "UPDATE "+string(k)+" SET "+strings.Join(assignments, ",")+" WHERE "+whereKey(k)+" AND revision=?", args...)
			if err != nil {
				return err
			}
			n, err := result.RowsAffected()
			if err != nil || n != 1 {
				return errors.New("repair compare-and-set failed")
			}
			_, e = tx.ExecContext(ctx, "INSERT INTO events(t,venue,asset,code,message,from_t,to_t,quality_json) VALUES(?,?,?,?,?,?,?,?)", *r.Base().AvailableAt, "binance", r.Key().Asset, "FUTURES_REPAIR", string(k), r.Key().T, r.Key().T+k.Interval(), r.Base().Quality)
			if e != nil {
				return e
			}
			continue
		}
		if !errors.Is(e, sql.ErrNoRows) {
			return e
		}
		if r.Base().Revision != 1 {
			return errors.New("repair requires existing row")
		}
		if _, e = tx.ExecContext(ctx, insertSQL(k), x.args...); e != nil {
			return e
		}
		if k == model.Spot {
			if e = recordSpotTransition(ctx, tx, r); e != nil {
				return e
			}
		}
	}
	return tx.Commit()
}

type queryRower interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readRow(ctx context.Context, q queryRower, k model.Kind, key model.Key) (model.Row, error) {
	if !k.Valid() {
		return nil, errors.New("invalid kind")
	}
	cols := columns[k]
	raw := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range raw {
		ptrs[i] = &raw[i]
	}
	if e := q.QueryRowContext(ctx, "SELECT "+strings.Join(cols, ",")+" FROM "+string(k)+" WHERE "+whereKey(k), keyArgs(k, key)...).Scan(ptrs...); e != nil {
		return nil, e
	}
	m := map[string]any{}
	for i, c := range cols {
		v := raw[i]
		if b, ok := v.([]byte); ok {
			v = string(b)
		}
		m[c] = v
	}
	b, e := json.Marshal(m)
	if e != nil {
		return nil, e
	}
	return model.Decode(k, b)
}
func (d *Daily) Get(ctx context.Context, k model.Kind, key model.Key) (model.Row, error) {
	return readRow(ctx, d.db, k, key)
}

// DumpDayRows emits bounded streaming NDJSON of current rows; not the public API envelope.
func (d *Daily) DumpDayRows(ctx context.Context, k model.Kind, w io.Writer) error {
	if !k.Valid() {
		return errors.New("invalid kind")
	}
	cols := columns[k]
	rs, e := d.db.QueryContext(ctx, "SELECT "+strings.Join(cols, ",")+" FROM "+string(k)+" ORDER BY "+strings.Join(keyCols(k), ","))
	if e != nil {
		return e
	}
	defer rs.Close()
	enc := json.NewEncoder(w)
	for rs.Next() {
		v := make([]any, len(cols))
		p := make([]any, len(cols))
		for i := range v {
			p[i] = &v[i]
		}
		if e = rs.Scan(p...); e != nil {
			return e
		}
		m := map[string]any{}
		for i, c := range cols {
			a := v[i]
			if b, ok := a.([]byte); ok {
				a = string(b)
			}
			m[c] = a
		}
		if e = enc.Encode(m); e != nil {
			return e
		}
	}
	return rs.Err()
}

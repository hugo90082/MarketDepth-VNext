package store

import (
	"context"
	"database/sql"
	"errors"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// Events are diagnostics, not a replacement for per-minute status/NULL rows.
// For a newly inserted spot row, record a status transition in the same commit.
// A same-row retry never reaches this function, so cannot duplicate events.
// Day boundaries intentionally start a new diagnostic sequence; an out-of-order
// insert reports the prior available row in this day, not a retroactive repair.
func recordSpotTransition(ctx context.Context, tx *sql.Tx, r model.Row) error {
	c, k := r.Base(), r.Key()
	var prev string
	e := tx.QueryRowContext(ctx, "SELECT status FROM spot_depth WHERE t<? AND venue=? AND asset=? ORDER BY t DESC LIMIT 1", k.T, k.Venue, k.Asset).Scan(&prev)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return e
	}
	if prev == c.Status || (prev == "" && c.Status == "ok") {
		return nil
	}
	code := "SPOT_STATUS_CHANGE"
	switch c.Status {
	case "missing":
		code = "SPOT_SOURCE_MISSING"
	case "partial":
		code = "SPOT_COVERAGE_PARTIAL"
	case "ok":
		code = "SPOT_RECOVERED"
	}
	message := prev + " -> " + c.Status
	_, e = tx.ExecContext(ctx, "INSERT INTO events(t,venue,asset,code,message,quality_json) VALUES(?,?,?,?,?,?)", k.T, k.Venue, k.Asset, code, message, c.Quality)
	return e
}

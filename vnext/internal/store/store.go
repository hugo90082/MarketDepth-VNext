// Package store separates the API from daily SQLite implementation.
package store

import (
	"context"
	"errors"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

var ErrResync = errors.New("cursor expired; re-fetch affected days")
var ErrUnavailable = errors.New("data unavailable")

type Query struct {
	Kind         model.Kind
	From, To     int64
	Asset, Venue string
	Limit        int
	Cursor       string
}
type Gap struct {
	From   int64  `json:"from"`
	To     int64  `json:"to"`
	Reason string `json:"reason"`
}
type Page struct {
	Rows     []model.Row
	Next     string
	Complete bool
	Gaps     []Gap
}
type Day struct {
	Day      string             `json:"day"`
	State    string             `json:"state"`
	Revision int64              `json:"revision"`
	From     int64              `json:"from"`
	To       int64              `json:"to"`
	Counts   map[model.Kind]int `json:"row_counts"`
	SHA256   *string            `json:"sha256"`
	ETag     *string            `json:"etag"`
	Gaps     []Gap              `json:"gaps"`
}
type Reader interface {
	History(context.Context, Query) (Page, error)
	Sync(context.Context, model.Kind, string) (Page, error)
	Latest(context.Context, model.Kind) ([]model.Row, error)
	Days(context.Context, string, string) ([]Day, error)
}

// Writer implementation must publish only after commit, enforce a single writer,
// preserve old revisions, and invalidate sync cursors on unreconciled recovery.
type Writer interface {
	Put(context.Context, []model.Row) error
}

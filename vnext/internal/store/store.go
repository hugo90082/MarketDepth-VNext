// Package store separates the API from daily SQLite implementation.
package store

import (
	"context"
	"errors"
	"io"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"reflect"
)

var ErrResync = errors.New("cursor expired; re-fetch affected days")
var ErrUnavailable = errors.New("data unavailable")
var ErrArchiveUnavailable = errors.New("archive unavailable")

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

func rowNil(r model.Row) bool {
	return r == nil || (reflect.ValueOf(r).Kind() == reflect.Ptr && reflect.ValueOf(r).IsNil())
}

// SealedDownload is a fully verified immutable gzip file. Close releases its
// bounded scratch allocation and read lease. Callers must always close Body.
type SealedDownload struct {
 Day string
 Revision, Size int64
 SHA256, ETag string
 Body io.ReadCloser
}
type SealedDownloader interface {
 OpenSealed(context.Context,string,int64)(SealedDownload,error)
}

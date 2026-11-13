//go:build linux && sqlite_integration

package store

import (
	"database/sql"
	_ "github.com/mattn/go-sqlite3"
	"net/url"
)

// SQLiteOpener selects the pinned driver. Connection-local pragmas are set in
// DSN so reconnects do not silently lose them. Read-only handles never create DBs.
func SQLiteOpener(path string, readOnly bool) (*sql.DB, error) {
	u := url.URL{Scheme: "file", Path: path}
	q := u.Query()
	q.Set("_busy_timeout", "5000")
	q.Set("_foreign_keys", "on")
	q.Set("_synchronous", "FULL")
	if readOnly {
		q.Set("mode", "ro")
		q.Set("_query_only", "1")
	} else {
		q.Set("mode", "rwc")
	}
	u.RawQuery = q.Encode()
	return sql.Open("sqlite3", u.String())
}

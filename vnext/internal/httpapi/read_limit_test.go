package httpapi

import (
	"bytes"
	"context"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type blockedReader struct {
	store.Reader
	entered chan struct{}
	release chan struct{}
}

func (r blockedReader) Latest(ctx context.Context, k model.Kind) ([]model.Row, error) {
	r.entered <- struct{}{}
	select {
	case <-r.release:
		return []model.Row{}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
func TestCatalogReadSlotsShared(t *testing.T) {
	a, e := newAuth("https://depth.example", bytes.Repeat([]byte{1}, 32), func([]byte) bool { return true })
	if e != nil {
		t.Fatal(e)
	}
	w := httptest.NewRecorder()
	if e = a.issue(w); e != nil {
		t.Fatal(e)
	}
	cookie := w.Result().Cookies()[0]
	r := blockedReader{store.Fixture(), make(chan struct{}, 2), make(chan struct{})}
	h := API{Reader: r, Live: true, Auth: a}.Handler()
	run := func(path string) int {
		q := httptest.NewRequest(http.MethodGet, path, nil)
		q.AddCookie(cookie)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, q)
		return w.Code
	}
	done := make(chan int, 2)
	defer close(r.release)
	for i := 0; i < 2; i++ {
		go func() { done <- run("/api/v2/latest?kind=futures_1m") }()
	}
	for i := 0; i < 2; i++ {
		select {
		case <-r.entered:
		case <-time.After(time.Second):
			t.Fatal("reader never entered")
		}
	}
	for _, path := range []string{"/api/v2/sync?kind=spot_depth", "/api/v2/history?kind=spot_depth&from=0&to=60000", "/api/v2/days?from=2026-11-13&to=2026-11-13"} {
		if got := run(path); got != 429 {
			t.Fatal(path, got)
		}
	}
	if got := run("/api/v2/health"); got != 200 {
		t.Fatal(got)
	}
}

package httpapi

import (
	"bufio"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
	"net/http/httptest"
	"testing"
)

func TestEndpoints(t *testing.T) {
	m := store.Fixture()
	h := API{Reader: m}.Handler()
	rows, _ := m.Latest(context.Background(), model.Spot)
	end := rows[0].Key().T + 60000
	span := fmt.Sprintf("from=%d&to=%d", end-120000, end)
	cases := []struct {
		method, path string
		status       int
	}{{"GET", "/api/v2/meta", 200}, {"GET", "/api/v2/health", 200}, {"GET", "/api/v2/latest", 200}, {"GET", "/api/v2/history?kind=spot_depth&limit=5&" + span, 200}, {"GET", "/api/v2/history?kind=futures_10s&venue=binance&" + span, 400}, {"GET", "/api/v2/history?kind=spot_depth&cursor=bad&" + span, 409}, {"GET", "/api/v2/sync?kind=spot_depth", 200}, {"GET", "/api/v2/days?from=2026-11-13&to=2026-11-13", 200}, {"POST", "/api/v2/auth/login", 501}, {"GET", "/api/v2/day/2026-11-13", 501}}
	for _, c := range cases {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(c.method, c.path, nil))
		if w.Code != c.status {
			t.Fatalf("%s: %d %s", c.path, w.Code, w.Body.String())
		}
		if w.Header().Get("X-MarketDepth-Mode") != "synthetic-mock" {
			t.Fatal("mock label missing")
		}
		if !json.Valid(w.Body.Bytes()) {
			t.Fatal("invalid JSON")
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/api/v2/export?"+span, nil))
	z, e := gzip.NewReader(w.Body)
	if e != nil {
		t.Fatal(e)
	}
	sc := bufio.NewScanner(z)
	var count int
	var last map[string]any
	for sc.Scan() {
		count++
		last = map[string]any{}
		if e := json.Unmarshal(sc.Bytes(), &last); e != nil {
			t.Fatal(e)
		}
	}
	if sc.Err() != nil || count != 67 || last["type"] != "manifest" || last["complete"] != true {
		t.Fatal(count, last, sc.Err())
	}
	if e = z.Close(); e != nil {
		t.Fatal(e)
	}
}

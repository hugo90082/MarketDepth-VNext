//go:build linux && sqlite_integration

package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

func TestAuthenticatedLocalSQLiteHistory(t *testing.T) {
	ctx := context.Background()
	m, e := store.NewManager(filepath.Join(t.TempDir(), "isolated"), store.SQLiteOpener)
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close()
	j, e := m.OpenCatalog(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer j.Close()
	if e = j.Recover(ctx); e != nil {
		t.Fatal(e)
	}
	ts := time.Now().Truncate(time.Minute).Add(-time.Minute).UnixMilli()
	row := model.Futures1Row{Common: model.Common{T: ts, Asset: "BTC", AvailableAt: model.Ptr(time.Now().UnixMilli()), Status: "missing", Source: model.Ptr(model.LiveSource), Quality: model.Ptr(`{"reason":"test_only"}`), Revision: 1}}
	if e = j.Put(ctx, []model.Row{row}); e != nil {
		t.Fatal(e)
	}
	a, e := newAuth("https://depth.example", bytes.Repeat([]byte{3}, 32), func(p []byte) bool { return string(p) == "test-only" })
	if e != nil {
		t.Fatal(e)
	}
	h := API{Reader: j, Live: true, Auth: a}.Handler()
	login := httptest.NewRequest("POST", "/api/v2/auth/login", strings.NewReader(`{"password":"test-only"}`))
	login.Header.Set("Origin", a.origin)
	login.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, login)
	if w.Code != 200 || len(w.Result().Cookies()) != 1 {
		t.Fatal(w.Code, w.Body.String())
	}
	cookie := w.Result().Cookies()[0]
	for _, path := range []string{fmt.Sprintf("/api/v2/history?kind=futures_1m&from=%d&to=%d&asset=BTC", ts, ts+60000), "/api/v2/latest?kind=futures_1m", "/api/v2/sync?kind=futures_1m"} {
		r := httptest.NewRequest("GET", path, nil)
		r.AddCookie(cookie)
		w = httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Fatal(path, w.Code, w.Body.String())
		}
		var out struct {
			Data []model.Futures1Row
			Meta map[string]any
		}
		if e = json.Unmarshal(w.Body.Bytes(), &out); e != nil || len(out.Data) != 1 || out.Data[0].T != ts || out.Data[0].Status != "missing" || out.Data[0].Open != nil || out.Meta["mock"] != false {
			t.Fatal(path, out, e)
		}
	}
}

package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

// A separate test-only wrapper exercises live HTTP guards without falsely
// exposing the fixture as a production source.
type fakeReader struct{ *store.Mock }

func TestLiveAuthCookieOriginAndRevocation(t *testing.T) {
	now := time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC)
	a, e := newAuth("https://depth.example", bytes.Repeat([]byte{7}, 32), func(p []byte) bool { return string(p) == "test-only-password" })
	if e != nil {
		t.Fatal(e)
	}
	a.now = func() time.Time { return now }
	h := API{Reader: fakeReader{store.Fixture()}, Live: true, Auth: a}.Handler()
	req := func(method, path, origin, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if method == "POST" {
			r.Header.Set("Content-Type", "application/json")
		}
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	for _, path := range []string{"/api/v2/meta", "/api/v2/latest", "/api/v2/health", "/api/v2/history", "/api/v2/sync", "/api/v2/days", "/api/v2/export", "/api/v2/day/2026-11-13"} {
		if w := req("GET", path, "", "", nil); w.Code != 401 {
			t.Fatal(path, w.Code)
		}
	}
	login := "/api/v2/auth/login"
	body := `{"password":"test-only-password"}`
	if w := req("POST", login, "https://evil.example", body, nil); w.Code != 403 {
		t.Fatal(w.Code)
	}
	if w := req("POST", login, "", body, nil); w.Code != 403 {
		t.Fatal(w.Code)
	}
	if w := req("POST", login, a.origin, `{"password":"bad"}`, nil); w.Code != 401 {
		t.Fatal(w.Code)
	}
	w := req("POST", login, a.origin, body, nil)
	if w.Code != 200 || len(w.Result().Cookies()) != 1 {
		t.Fatal(w.Code, w.Body.String())
	}
	cookie := w.Result().Cookies()[0]
	if cookie.Name != sessionCookie || !cookie.Secure || !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" || cookie.Domain != "" || cookie.MaxAge != 604800 {
		t.Fatal(cookie)
	}
	w = req("GET", "/api/v2/meta", "", "", cookie)
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("X-MarketDepth-Mode") != "live-local" {
		t.Fatal(w.Code, w.Header())
	}
	var payload struct{ Meta map[string]any }
	if e = json.Unmarshal(w.Body.Bytes(), &payload); e != nil || payload.Meta["mock"] != false {
		t.Fatal(payload, e)
	}
	if w = req("GET", "/api/v2/meta", "https://evil.example", "", cookie); w.Code != 403 {
		t.Fatal(w.Code)
	}
	bad := *cookie
	bad.Value += "x"
	if w = req("GET", "/api/v2/meta", "", "", &bad); w.Code != 401 {
		t.Fatal(w.Code)
	}
	if w = req("POST", "/api/v2/auth/logout", a.origin, "", cookie); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w = req("GET", "/api/v2/latest", "", "", cookie); w.Code != 401 {
		t.Fatal("logout did not revoke", w.Code)
	}
	w = req("POST", login, a.origin, body, nil)
	cookie = w.Result().Cookies()[0]
	now = now.Add(sessionTTL)
	if w = req("GET", "/api/v2/latest", "", "", cookie); w.Code != 401 {
		t.Fatal("expiry", w.Code)
	}
}
func TestAuthRateLimitAndFailClosed(t *testing.T) {
	a, _ := newAuth("https://depth.example", bytes.Repeat([]byte{7}, 32), func([]byte) bool { return false })
	h := API{Reader: fakeReader{store.Fixture()}, Live: true, Auth: a}.Handler()
	for i := 0; i < 6; i++ {
		r := httptest.NewRequest("POST", "/api/v2/auth/login", strings.NewReader(`{"password":"bad"}`))
		r.Header.Set("Origin", a.origin)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		want := 401
		if i == 5 {
			want = 429
		}
		if w.Code != want {
			t.Fatal(i, w.Code)
		}
	}
	for _, api := range []API{{Reader: fakeReader{store.Fixture()}}, {Reader: fakeReader{store.Fixture()}, Live: true}, {Reader: store.Fixture(), Live: true, Auth: a}} {
		w := httptest.NewRecorder()
		api.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/v2/meta", nil))
		if w.Code != 503 {
			t.Fatal("unsafe API mode", w.Code)
		}
	}
}

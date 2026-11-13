package drive

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestOAuthRefreshAndRevocation(t *testing.T) {
	calls := 0
	revoke := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		r.ParseForm()
		if r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("refresh_token") != "fake-refresh" {
			t.Error("bad refresh request")
		}
		if revoke {
			w.WriteHeader(400)
			fmt.Fprint(w, `{"error":"invalid_grant"}`)
			return
		}
		fmt.Fprintf(w, `{"access_token":"access-%d","expires_in":3600,"token_type":"Bearer","scope":%q}`, calls, Scope)
	}))
	defer server.Close()
	s, e := NewTokenSource(Credentials{"id", "fake-secret", "fake-refresh", Scope})
	if e != nil {
		t.Fatal(e)
	}
	s.endpoint = server.URL
	s.client = noRedirectClient(time.Second)
	now := time.Now()
	s.now = func() time.Time { return now }
	for i := 0; i < 2; i++ {
		v, e := s.AccessToken(context.Background())
		if e != nil || v != "access-1" {
			t.Fatal(v, e)
		}
	}
	if calls != 1 {
		t.Fatal(calls)
	}
	now = now.Add(time.Hour)
	revoke = true
	if _, e = s.AccessToken(context.Background()); !errors.Is(e, ErrReauthorize) {
		t.Fatal(e)
	}
}
func TestCredentialSafetyAndAuthURL(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "secret.oauth.json")
	v := Credentials{"id", "secret", "refresh", Scope}
	if e := WriteCredentials(p, v); e != nil {
		t.Fatal(e)
	}
	if e := WriteCredentials(p, v); e == nil {
		t.Fatal("overwrite")
	}
	got, e := LoadCredentials(p)
	if e != nil || got != v {
		t.Fatal(e)
	}
	os.Chmod(p, 0644)
	if _, e = LoadCredentials(p); e == nil {
		t.Fatal("permissions")
	}
	u, e := url.Parse(AuthorizationURL(DesktopConfig{"id", "secret"}, "http://127.0.0.1:1234/callback", "state", "challenge"))
	if e != nil || u.Query().Get("scope") != Scope || u.Query().Get("access_type") != "offline" || u.Query().Get("code_challenge_method") != "S256" || strings.Contains(u.String(), "secret") {
		t.Fatal("unsafe authorization URL")
	}
}

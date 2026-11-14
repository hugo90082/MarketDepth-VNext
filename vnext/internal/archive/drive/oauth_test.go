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
	var observations []TokenEvent
 s, e := NewObservedTokenSource(Credentials{"id", "fake-secret", "fake-refresh", Scope},func(event TokenEvent){observations=append(observations,event)})
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
	if calls != 1 || len(observations)!=1 || observations[0]!=(TokenEvent{Grant:1,ExpiresInSeconds:3600}) {
		t.Fatal(calls,observations)
	}
 now=now.Add(time.Hour)
 if v,e:=s.AccessToken(context.Background());e!=nil||v!="access-2"{t.Fatal(v,e)}
 if calls!=2||len(observations)!=2||observations[1]!=(TokenEvent{Grant:2,ExpiresInSeconds:3600}){t.Fatal(calls,observations)}
	now = now.Add(time.Hour)
	revoke = true
	if _, e = s.AccessToken(context.Background()); !errors.Is(e, ErrReauthorize) {
		t.Fatal(e)
	}
 if len(observations)!=2||calls!=3{t.Fatal("failed grant emitted success",calls,observations)}
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

// Package drive implements the narrowly scoped Google Drive archive transport.
package drive

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

const Scope = "https://www.googleapis.com/auth/drive.file"
const tokenEndpoint = "https://oauth2.googleapis.com/token"
const authEndpoint = "https://accounts.google.com/o/oauth2/v2/auth"

// Credentials is the secret output of the one-time desktop authorization.
// Never log, marshal to HTTP responses, or store this in the market-data tree.
type Credentials struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

func validCredentials(c Credentials) bool {
	return c.ClientID != "" && c.ClientSecret != "" && c.RefreshToken != "" && c.Scope == Scope && len(c.ClientID)+len(c.ClientSecret)+len(c.RefreshToken) < 32<<10
}
func LoadCredentials(path string) (Credentials, error) {
	var c Credentials
	st, e := os.Lstat(path)
	if e != nil || !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 || st.Size() > 64<<10 {
		return c, errors.New("private OAuth credential file required (0600)")
	}
	f, e := os.Open(path)
	if e != nil {
		return c, errors.New("OAuth credential file unavailable")
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, 64<<10+1))
	if e != nil || len(b) > 64<<10 || json.Unmarshal(b, &c) != nil || !validCredentials(c) {
		return Credentials{}, errors.New("invalid OAuth credential file")
	}
	return c, nil
}

type TokenProvider interface {
	AccessToken(context.Context) (string, error)
}

var ErrReauthorize = errors.New("Google OAuth requires user reauthorization")

type TokenSource struct {
	mu       sync.Mutex
	cred     Credentials
	client   *http.Client
	endpoint string
	access   string
	expires  time.Time
	now      func() time.Time
}

func noRedirectClient(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
func NewTokenSource(c Credentials) (*TokenSource, error) {
	if !validCredentials(c) {
		return nil, errors.New("invalid OAuth credentials")
	}
	return &TokenSource{cred: c, client: noRedirectClient(20 * time.Second), endpoint: tokenEndpoint, now: time.Now}, nil
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	Scope        string `json:"scope"`
	TokenType    string `json:"token_type"`
	Error        string `json:"error"`
}

func exchange(ctx context.Context, client *http.Client, endpoint string, form url.Values) (tokenResponse, error) {
	var t tokenResponse
	req, e := http.NewRequestWithContext(ctx, "POST", endpoint, strings.NewReader(form.Encode()))
	if e != nil {
		return t, errors.New("OAuth request invalid")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, e := client.Do(req)
	if e != nil {
		return t, errors.New("OAuth token request failed")
	}
	defer res.Body.Close()
	b, e := io.ReadAll(io.LimitReader(res.Body, 64<<10+1))
	if e != nil || len(b) > 64<<10 || json.Unmarshal(b, &t) != nil {
		return tokenResponse{}, errors.New("invalid OAuth token response")
	}
	if t.Error == "invalid_grant" {
		return tokenResponse{}, ErrReauthorize
	}
	if res.StatusCode != 200 || t.AccessToken == "" || !strings.EqualFold(t.TokenType, "Bearer") || t.ExpiresIn < 120 || t.ExpiresIn > 86400 || (t.Scope != "" && t.Scope != Scope) {
		return tokenResponse{}, errors.New("OAuth token rejected or unexpected scope")
	}
	return t, nil
}
func (s *TokenSource) AccessToken(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e := ctx.Err(); e != nil {
		return "", e
	}
	now := s.now()
	if s.access != "" && now.Add(time.Minute).Before(s.expires) {
		return s.access, nil
	}
	form := url.Values{"client_id": {s.cred.ClientID}, "client_secret": {s.cred.ClientSecret}, "refresh_token": {s.cred.RefreshToken}, "grant_type": {"refresh_token"}}
	t, e := exchange(ctx, s.client, s.endpoint, form)
	if e != nil {
		return "", e
	}
	if t.RefreshToken != "" && t.RefreshToken != s.cred.RefreshToken {
		return "", errors.New("unexpected refresh token rotation; reauthorize securely")
	}
	s.access = t.AccessToken
	s.expires = now.Add(time.Duration(t.ExpiresIn) * time.Second)
	return s.access, nil
}

// DesktopConfig reads Google's installed-app JSON without trusting endpoints in the file.
type DesktopConfig struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

func ReadDesktopConfig(r io.Reader) (DesktopConfig, error) {
	var v struct {
		Installed DesktopConfig `json:"installed"`
	}
	b, e := io.ReadAll(io.LimitReader(r, 64<<10+1))
	if e != nil || len(b) > 64<<10 || json.Unmarshal(b, &v) != nil || v.Installed.ClientID == "" || v.Installed.ClientSecret == "" {
		return DesktopConfig{}, errors.New("Google Desktop app JSON required")
	}
	return v.Installed, nil
}
func AuthorizationURL(c DesktopConfig, redirect, state, challenge string) string {
	return authEndpoint + "?" + url.Values{"client_id": {c.ClientID}, "redirect_uri": {redirect}, "response_type": {"code"}, "scope": {Scope}, "access_type": {"offline"}, "prompt": {"consent"}, "state": {state}, "code_challenge": {challenge}, "code_challenge_method": {"S256"}}.Encode()
}
func ExchangeCode(ctx context.Context, c DesktopConfig, redirect, code, verifier string) (Credentials, error) {
	t, e := exchange(ctx, noRedirectClient(20*time.Second), tokenEndpoint, url.Values{"client_id": {c.ClientID}, "client_secret": {c.ClientSecret}, "code": {code}, "code_verifier": {verifier}, "redirect_uri": {redirect}, "grant_type": {"authorization_code"}})
	if e != nil {
		return Credentials{}, e
	}
	v := Credentials{c.ClientID, c.ClientSecret, t.RefreshToken, t.Scope}
	if !validCredentials(v) {
		return Credentials{}, errors.New("offline drive.file grant not confirmed")
	}
	return v, nil
}

// WriteCredentials refuses overwrite. Caller chooses a private directory;
// on Windows the user must also protect that directory with OS ACLs.
func WriteCredentials(path string, c Credentials) error {
	if !validCredentials(c) {
		return errors.New("invalid credentials")
	}
	b, e := json.Marshal(c)
	if e != nil {
		return e
	}
	f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return errors.New("cannot create new private credential file")
	}
	ok := false
	defer func() {
		f.Close()
		if !ok {
			os.Remove(path)
		}
	}()
	if _, e = io.Copy(f, bytes.NewReader(b)); e != nil {
		return errors.New("credential write failed")
	}
	if e = f.Sync(); e != nil {
		return errors.New("credential sync failed")
	}
	if e = f.Close(); e != nil {
		return errors.New("credential close failed")
	}
	ok = true
	return nil
}

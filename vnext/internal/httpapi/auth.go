package httpapi

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const sessionCookie = "__Host-md_session"
const sessionTTL = 7 * 24 * time.Hour
const maxSessions = 64
const maxLoginIPs = 4096

type attempt struct {
	since time.Time
	n     int
}
type authSession struct {
	expires  time.Time
	requests attempt
}

// Auth sessions are signed, bounded and server-side revocable. A process
// restart deliberately logs users out. Password verification is injected only
// internally; production constructor is bcrypt-backed.
type Auth struct {
	mu       sync.Mutex
	now      func() time.Time
	origin   string
	key      []byte
	verify   func([]byte) bool
	sessions map[string]authSession
	attempts map[string]attempt
	global   attempt
	slots    chan struct{}
}

func newAuth(origin string, key []byte, verify func([]byte) bool) (*Auth, error) {
	u, e := url.Parse(origin)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || len(key) < 32 || verify == nil {
		return nil, errors.New("exact HTTPS origin, independent session key (>=32 bytes), and verifier required")
	}
	return &Auth{now: time.Now, origin: origin, key: append([]byte(nil), key...), verify: verify, sessions: map[string]authSession{}, attempts: map[string]attempt{}, slots: make(chan struct{}, 1)}, nil
}
func (a *Auth) sign(id string) string {
	h := hmac.New(sha256.New, a.key)
	h.Write([]byte(id))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}
func (a *Auth) token(r *http.Request) (string, bool) {
	c, e := r.Cookie(sessionCookie)
	if e != nil || len(c.Value) > 100 {
		return "", false
	}
	id, sig, ok := strings.Cut(c.Value, ".")
	if !ok || len(id) != 43 || !hmac.Equal([]byte(sig), []byte(a.sign(id))) {
		return "", false
	}
	return id, true
}
func (a *Auth) originOK(r *http.Request, required bool) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return !required
	}
	return o == a.origin
}
func ipKey(r *http.Request) string {
	host, _, e := net.SplitHostPort(r.RemoteAddr)
	if e != nil {
		return "unknown"
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return "unknown"
	}
	return ip.String()
}
func bump(x attempt, now time.Time, window time.Duration, limit int) (attempt, bool) {
	if x.since.IsZero() || now.Sub(x.since) >= window || now.Before(x.since) {
		x = attempt{since: now}
	}
	if x.n >= limit {
		return x, false
	}
	x.n++
	return x, true
}
func (a *Auth) loginAllowed(r *http.Request) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	for k, v := range a.attempts {
		if now.Sub(v.since) >= time.Minute {
			delete(a.attempts, k)
		}
	}
	k := ipKey(r)
	x, ok := a.attempts[k]
	if !ok && len(a.attempts) >= maxLoginIPs {
		return false
	}
	var allowed bool
	x, allowed = bump(x, now, time.Minute, 5)
	a.attempts[k] = x
	if !allowed {
		return false
	}
	a.global, allowed = bump(a.global, now, time.Minute, 20)
	return allowed
}
func (a *Auth) issue(w http.ResponseWriter) error {
	var b [32]byte
	if _, e := rand.Read(b[:]); e != nil {
		return e
	}
	id := base64.RawURLEncoding.EncodeToString(b[:])
	now := a.now()
	a.mu.Lock()
	defer a.mu.Unlock()
	for k, s := range a.sessions {
		if !s.expires.After(now) {
			delete(a.sessions, k)
		}
	}
	if len(a.sessions) >= maxSessions {
		return errors.New("session capacity")
	}
	a.sessions[id] = authSession{expires: now.Add(sessionTTL)}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: id + "." + a.sign(id), Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode, Expires: now.Add(sessionTTL), MaxAge: int(sessionTTL.Seconds())})
	return nil
}
func (a *Auth) authorized(r *http.Request) (bool, bool) {
	id, ok := a.token(r)
	if !ok {
		return false, false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	s, ok := a.sessions[id]
	now := a.now()
	if !ok || !s.expires.After(now) {
		delete(a.sessions, id)
		return false, false
	}
	var allowed bool
	s.requests, allowed = bump(s.requests, now, time.Minute, 120)
	a.sessions[id] = s
	return true, allowed
}
func limited(w http.ResponseWriter, seconds string) {
	w.Header().Set("Retry-After", seconds)
	fail(w, 429, "RATE_LIMITED", "retry later")
}
func (a *Auth) Login(w http.ResponseWriter, r *http.Request) {
	if !a.originOK(r, true) {
		fail(w, 403, "BAD_ORIGIN", "same origin required")
		return
	}
	if !a.loginAllowed(r) {
		limited(w, "60")
		return
	}
	if ct := r.Header.Get("Content-Type"); ct != "application/json" && !strings.HasPrefix(ct, "application/json;") {
		fail(w, 400, "BAD_REQUEST", "JSON required")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var in struct {
		Password string `json:"password"`
	}
	if e := dec.Decode(&in); e != nil || len(in.Password) == 0 || len(in.Password) > 72 {
		fail(w, 400, "BAD_REQUEST", "invalid password input")
		return
	}
	var extra any
	if e := dec.Decode(&extra); e != io.EOF {
		fail(w, 400, "BAD_REQUEST", "invalid JSON")
		return
	}
	select {
	case a.slots <- struct{}{}:
		defer func() { <-a.slots }()
	default:
		limited(w, "2")
		return
	}
	if !a.verify([]byte(in.Password)) {
		fail(w, 401, "UNAUTHORIZED", "invalid password")
		return
	}
	if e := a.issue(w); e != nil {
		fail(w, 503, "AUTH_UNAVAILABLE", "session unavailable")
		return
	}
	send(w, 200, map[string]any{"ok": true, "data": map[string]any{"authenticated": true, "expires_in": int(sessionTTL.Seconds())}})
}
func (a *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	if !a.originOK(r, true) {
		fail(w, 403, "BAD_ORIGIN", "same origin required")
		return
	}
	if id, ok := a.token(r); ok {
		a.mu.Lock()
		delete(a.sessions, id)
		a.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1, Expires: time.Unix(1, 0)})
	send(w, 200, map[string]any{"ok": true, "data": map[string]any{"authenticated": false}})
}
func (a *Auth) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.originOK(r, false) {
			fail(w, 403, "BAD_ORIGIN", "same origin required")
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/api/v2/auth/login" {
			a.Login(w, r)
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/api/v2/auth/logout" {
			a.Logout(w, r)
			return
		}
		ok, allowed := a.authorized(r)
		if !ok {
			fail(w, 401, "UNAUTHORIZED", "login required")
			return
		}
		if !allowed {
			limited(w, "60")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			fail(w, 405, "METHOD_NOT_ALLOWED", "read-only API")
			return
		}
		next.ServeHTTP(w, r)
	})
}

package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var allowedProxyHosts = map[string]bool{
	"data-api.binance.vision":   true,
	"api.binance.com":           true,
	"fapi.binance.com":          true,
	"www.okx.com":               true,
	"api.bybit.com":             true,
	"api.exchange.coinbase.com": true,
	"api.coinbase.com":          true,
	"api-pub.bitfinex.com":      true,
	"api.bitfinex.com":          true,
	"api.kraken.com":            true,
	"futures.kraken.com":        true,
}

type proxyCacheEntry struct {
	status      int
	contentType string
	body        []byte
	expires     time.Time
}

type proxyMonitor struct {
	client   *http.Client
	mu       sync.Mutex
	cache    map[string]proxyCacheEntry
	inflight map[string]chan struct{}
	wsMu     sync.Mutex
	wsTotal  int
}

func newProxyMonitor() *proxyMonitor {
	return &proxyMonitor{
		client:   &http.Client{Timeout: 15 * time.Second},
		cache:    map[string]proxyCacheEntry{},
		inflight: map[string]chan struct{}{},
	}
}

func proxyTTL(u *url.URL) time.Duration {
	p := u.Path
	if strings.Contains(p, "exchangeInfo") || strings.Contains(p, "instruments") || strings.HasSuffix(p, "/products") || strings.Contains(p, "AssetPairs") || strings.Contains(p, "pub:list:pair") {
		return 5 * time.Minute
	}
	return 2 * time.Second
}

func (m *proxyMonitor) ServeExchangeProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		fail(w, 405, "METHOD_NOT_ALLOWED", "GET required")
		return
	}
	raw := r.URL.Query().Get("url")
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "https" || u.User != nil || !allowedProxyHosts[strings.ToLower(u.Hostname())] {
		fail(w, 400, "BAD_PROXY_URL", "disallowed upstream URL")
		return
	}
	key := u.String()
	now := time.Now()
	m.mu.Lock()
	if c, ok := m.cache[key]; ok && c.expires.After(now) {
		m.mu.Unlock()
		if c.contentType != "" {
			w.Header().Set("Content-Type", c.contentType)
		} else {
			w.Header().Set("Content-Type", "application/json")
		}
		w.WriteHeader(c.status)
		_, _ = w.Write(c.body)
		return
	}
	if wait, ok := m.inflight[key]; ok {
		m.mu.Unlock()
		select {
		case <-wait:
		case <-r.Context().Done():
			fail(w, 504, "UPSTREAM_TIMEOUT", "request canceled")
			return
		}
		m.mu.Lock()
		if c, ok := m.cache[key]; ok {
			m.mu.Unlock()
			if c.contentType != "" {
				w.Header().Set("Content-Type", c.contentType)
			} else {
				w.Header().Set("Content-Type", "application/json")
			}
			w.WriteHeader(c.status)
			_, _ = w.Write(c.body)
			return
		}
	}
	wait := make(chan struct{})
	m.inflight[key] = wait
	if len(m.cache) > 256 {
		for k, v := range m.cache {
			if !v.expires.After(now) {
				delete(m.cache, k)
			}
		}
	}
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		delete(m.inflight, key)
		close(wait)
		m.mu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, key, nil)
	if e != nil {
		fail(w, 400, "BAD_PROXY_URL", "invalid request")
		return
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "DepthWatch/4.0")
	resp, e := m.client.Do(req)
	if e != nil {
		fail(w, 502, "UPSTREAM_UNAVAILABLE", "upstream request failed")
		return
	}
	defer resp.Body.Close()
	body, e := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024+1))
	if e != nil || len(body) > 8*1024*1024 {
		fail(w, 502, "UPSTREAM_TOO_LARGE", "upstream response too large")
		return
	}
	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/json"
	}
	ttl := proxyTTL(u)
	if resp.StatusCode >= 400 {
		ttl = 2 * time.Second
	}
	m.mu.Lock()
	m.cache[key] = proxyCacheEntry{
		status:      resp.StatusCode,
		contentType: ct,
		body:        body,
		expires:     time.Now().Add(ttl),
	}
	m.mu.Unlock()
	if ra := resp.Header.Get("Retry-After"); ra != "" {
		w.Header().Set("Retry-After", ra)
	}
	w.Header().Set("Content-Type", ct)
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}

var coinbaseProductPattern = regexp.MustCompile(`^[A-Z0-9]{2,15}-USD$`)

type coinbaseRelayCmd struct {
	Type       string   `json:"type"`
	ProductIDs []string `json:"product_ids"`
	Channels   []string `json:"channels"`
}

func parseCoinbaseRelayCmd(raw []byte) (coinbaseRelayCmd, error) {
	var out coinbaseRelayCmd
	if len(raw) > 16384 {
		return out, errors.New("command too large")
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if e := dec.Decode(&out); e != nil {
		return out, e
	}
	if out.Type != "subscribe" && out.Type != "unsubscribe" {
		return out, errors.New("invalid command type")
	}
	if len(out.ProductIDs) == 0 || len(out.ProductIDs) > 50 {
		return out, errors.New("invalid product_ids")
	}
	for _, p := range out.ProductIDs {
		if !coinbaseProductPattern.MatchString(p) {
			return out, errors.New("invalid product_id")
		}
	}
	if len(out.Channels) == 0 || len(out.Channels) > 2 {
		return out, errors.New("invalid channels")
	}
	for _, c := range out.Channels {
		if c != "level2_batch" && c != "heartbeat" {
			return out, errors.New("invalid channel")
		}
	}
	return out, nil
}

func (m *proxyMonitor) ServeCoinbaseStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet || r.URL.RawQuery != "" {
		fail(w, 400, "BAD_RELAY_REQUEST", "invalid request")
		return
	}
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		fail(w, 426, "WEBSOCKET_REQUIRED", "websocket upgrade required")
		return
	}
	m.wsMu.Lock()
	if m.wsTotal >= 16 {
		m.wsMu.Unlock()
		fail(w, 429, "RELAY_BUSY", "too many active streams")
		return
	}
	m.wsTotal++
	m.wsMu.Unlock()
	defer func() {
		m.wsMu.Lock()
		m.wsTotal--
		m.wsMu.Unlock()
	}()

	dialer := websocket.Dialer{HandshakeTimeout: 8 * time.Second}
	up, _, e := dialer.DialContext(r.Context(), "wss://ws-feed.exchange.coinbase.com", nil)
	if e != nil {
		fail(w, 502, "UPSTREAM_UNAVAILABLE", "coinbase upstream unavailable")
		return
	}
	defer up.Close()
	up.SetReadLimit(16 * 1024 * 1024)

	upgrader := websocket.Upgrader{
		HandshakeTimeout: 8 * time.Second,
		CheckOrigin:      func(*http.Request) bool { return true },
	}
	down, e := upgrader.Upgrade(w, r, nil)
	if e != nil {
		return
	}
	defer down.Close()
	down.SetReadLimit(16384)

	done := make(chan struct{})
	var once sync.Once
	finish := func() { once.Do(func() { close(done); _ = down.Close(); _ = up.Close() }) }

	go func() {
		defer finish()
		subscribed := map[string]bool{}
		for {
			_ = down.SetReadDeadline(time.Now().Add(60 * time.Second))
			mt, msg, e := down.ReadMessage()
			if e != nil || mt != websocket.TextMessage {
				return
			}
			cmd, e := parseCoinbaseRelayCmd(msg)
			if e != nil {
				return
			}
			for _, p := range cmd.ProductIDs {
				if cmd.Type == "subscribe" {
					subscribed[p] = true
				} else {
					delete(subscribed, p)
				}
			}
			if len(subscribed) > 50 {
				return
			}
			b, e := json.Marshal(cmd)
			if e != nil {
				return
			}
			_ = up.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if e := up.WriteMessage(websocket.TextMessage, b); e != nil {
				return
			}
		}
	}()

	for {
		_ = up.SetReadDeadline(time.Now().Add(60 * time.Second))
		mt, msg, e := up.ReadMessage()
		if e != nil {
			finish()
			return
		}
		if mt != websocket.TextMessage {
			continue
		}
		_ = down.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if e := down.WriteMessage(websocket.TextMessage, msg); e != nil {
			finish()
			return
		}
	}
}

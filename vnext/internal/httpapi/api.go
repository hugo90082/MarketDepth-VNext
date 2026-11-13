// Package httpapi provides fixture and authenticated local data API handlers.
package httpapi

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type API struct {
	Reader store.Reader
	Live   bool
	Auth   *Auth
	Health func() map[string]any
}

func send(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, code, msg string) {
	send(w, status, map[string]any{"ok": false, "error": map[string]string{"code": code, "message": msg}})
}
func errReply(w http.ResponseWriter, e error) {
	if errors.Is(e, store.ErrResync) {
		fail(w, 409, "RESYNC_REQUIRED", e.Error())
		return
	}
	fail(w, 503, "DATA_UNAVAILABLE", "data unavailable; retry or reduce the range")
}
func (a API) ok(w http.ResponseWriter, data any, meta map[string]any) {
	if meta == nil {
		meta = map[string]any{}
	}
	meta["contract_id"] = model.Contract
	meta["timezone"] = model.Timezone
	meta["mock"] = !a.Live
	send(w, 200, map[string]any{"ok": true, "data": data, "meta": meta})
}
func (a API) page(w http.ResponseWriter, p store.Page, k model.Kind, from, to int64) {
	var next any
	if p.Next != "" {
		next = p.Next
	}
	a.ok(w, p.Rows, map[string]any{"kind": k, "from": from, "to": to, "next_cursor": next, "complete": p.Complete, "gaps": p.Gaps})
}
func kinds(s string) ([]model.Kind, bool) {
	if s == "" {
		return []model.Kind{model.Spot, model.F10, model.F1}, true
	}
	out := []model.Kind{}
	seen := map[model.Kind]bool{}
	for _, x := range strings.Split(s, ",") {
		k := model.Kind(x)
		if !k.Valid() || seen[k] {
			return nil, false
		}
		seen[k] = true
		out = append(out, k)
	}
	return out, true
}
func span(r *http.Request) (int64, int64, bool) {
	q := r.URL.Query()
	f, e := strconv.ParseInt(q.Get("from"), 10, 64)
	t, e2 := strconv.ParseInt(q.Get("to"), 10, 64)
	return f, t, e == nil && e2 == nil && f >= 0 && t > f && t-f <= 31*86400000 && t <= 253402300799999
}
func (a API) Handler() http.Handler {
	if a.Reader == nil || (a.Live && a.Auth == nil) {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			fail(w, 503, "UNAVAILABLE", "API configuration incomplete")
		})
	}
	// Keep fixture and live identities distinct; no accidental anonymous live mode.
	if _, mock := a.Reader.(*store.Mock); a.Live == mock {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fail(w, 503, "UNAVAILABLE", "reader mode mismatch") })
	}
	readSlots := make(chan struct{}, 2)
	exportSlots := make(chan struct{}, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v2/meta", func(w http.ResponseWriter, r *http.Request) {
		a.ok(w, map[string]any{"contract_id": model.Contract, "timezone": model.Timezone, "assets": []string{"BTC", "ETH", "SOL"}, "venues": []string{"binance", "coinbase", "kraken", "bitfinex"}, "zones_bps": [][2]int{{0, 100}, {100, 200}, {200, 300}, {300, 500}, {500, 750}}, "cadence_ms": map[model.Kind]int64{model.Spot: 60000, model.F10: 10000, model.F1: 60000}, "null_semantics": "unknown=null; confirmed empty=0", "all4_min_venues": 2, "synthetic": !a.Live}, nil)
	})
	mux.HandleFunc("GET /api/v2/health", func(w http.ResponseWriter, r *http.Request) {
		if a.Live {
			h := map[string]any{"mode": "live_local", "collector": "unverified", "archive": "not_connected", "production_ready": false}
			if a.Health != nil {
				h = a.Health()
			}
			a.ok(w, h, nil)
			return
		}
		a.ok(w, map[string]any{"mode": "mock", "collector": "not_running", "archive": "not_connected", "production_ready": false}, nil)
	})
	mux.HandleFunc("GET /api/v2/latest", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		ks, b := kinds(r.URL.Query().Get("kind"))
		if !b {
			fail(w, 400, "BAD_QUERY", "invalid kind")
			return
		}
		if len(ks) == 1 {
			rows, e := a.Reader.Latest(ctx, ks[0])
			if e != nil {
				errReply(w, e)
				return
			}
			a.ok(w, rows, map[string]any{"kind": ks[0]})
			return
		}
		data := map[model.Kind][]model.Row{}
		for _, k := range ks {
			v, e := a.Reader.Latest(ctx, k)
			if e != nil {
				errReply(w, e)
				return
			}
			data[k] = v
		}
		a.ok(w, data, nil)
	})
	mux.HandleFunc("GET /api/v2/history", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		k := model.Kind(q.Get("kind"))
		f, t, b := span(r)
		l := 500
		if q.Get("limit") != "" {
			var e error
			l, e = strconv.Atoi(q.Get("limit"))
			if e != nil {
				l = 0
			}
		}
		asset, venue := q.Get("asset"), q.Get("venue")
		if !b || !k.Valid() || l < 1 || l > 2000 || (asset != "" && !model.AssetOK(asset)) || (venue != "" && (k != model.Spot || !model.VenueOK(venue))) {
			fail(w, 400, "BAD_QUERY", "invalid range, kind, limit or filter")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		p, e := a.Reader.History(ctx, store.Query{Kind: k, From: f, To: t, Asset: asset, Venue: venue, Limit: l, Cursor: q.Get("cursor")})
		if e != nil {
			errReply(w, e)
			return
		}
		a.page(w, p, k, f, t)
	})
	mux.HandleFunc("GET /api/v2/sync", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		k := model.Kind(q.Get("kind"))
		if !k.Valid() {
			fail(w, 400, "BAD_QUERY", "invalid kind")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		p, e := a.Reader.Sync(ctx, k, q.Get("cursor"))
		if e != nil {
			errReply(w, e)
			return
		}
		a.page(w, p, k, 0, 0)
	})
	mux.HandleFunc("GET /api/v2/days", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		f, t := q.Get("from"), q.Get("to")
		a1, e := time.Parse("2006-01-02", f)
		a2, e2 := time.Parse("2006-01-02", t)
		if e != nil || e2 != nil || a2.Before(a1) || a2.Sub(a1) > 366*24*time.Hour {
			fail(w, 400, "BAD_QUERY", "invalid day range")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		ds, e := a.Reader.Days(ctx, f, t)
		if e != nil {
			errReply(w, e)
			return
		}
		a.ok(w, ds, nil)
	})
	mux.HandleFunc("GET /api/v2/export", func(w http.ResponseWriter, r *http.Request) {
		select {
		case exportSlots <- struct{}{}:
			defer func() { <-exportSlots }()
		default:
			limited(w, "5")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
		defer cancel()
		a.export(w, r.WithContext(ctx))
	})
	mux.HandleFunc("GET /api/v2/day/{day}", func(w http.ResponseWriter, r *http.Request) {
		if a.Live {
			fail(w, 503, "ARCHIVE_UNAVAILABLE", "remote archive not connected")
			return
		}
		fail(w, 501, "MOCK_NOT_IMPLEMENTED", "sealed SQLite download is Phase 4")
	})
	for _, p := range []string{"/api/v2/auth/login", "/api/v2/auth/logout"} {
		mux.HandleFunc("POST "+p, func(w http.ResponseWriter, r *http.Request) {
			fail(w, 501, "MOCK_NOT_IMPLEMENTED", "production authentication is Phase 3")
		})
	}
	// Bound all catalog-locking read routes together, not just history. A burst
	// of authenticated sync/latest/days requests must not spawn unlimited waiters.
	var next http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/history", "/api/v2/latest", "/api/v2/sync", "/api/v2/days":
			select {
			case readSlots <- struct{}{}:
				defer func() { <-readSlots }()
			default:
				limited(w, "2")
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
	if a.Live {
		next = a.Auth.wrap(next)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
		mode := "synthetic-mock"
		if a.Live {
			mode = "live-local"
		}
		w.Header().Set("X-MarketDepth-Mode", mode)
		next.ServeHTTP(w, r)
	})
}
func (a API) export(w http.ResponseWriter, r *http.Request) {
	f, t, b := span(r)
	ks, kok := kinds(r.URL.Query().Get("kinds"))
	format := r.URL.Query().Get("format")
	if !b || !kok || (format != "" && format != "jsonl.gz") {
		fail(w, 400, "BAD_QUERY", "invalid range, kinds or format")
		return
	}
	// Per-kind page cursors alone cannot detect a correction to a kind
	// already streamed while the next kind is being read. Require a shared
	// optimistic range barrier in live mode.
	type versioned interface {
		RangeVersion(context.Context, []model.Kind, int64, int64) (string, error)
	}
	var vr versioned
	var version string
	if a.Live {
		var ok bool
		vr, ok = a.Reader.(versioned)
		if !ok {
			fail(w, 503, "DATA_UNAVAILABLE", "export consistency unavailable")
			return
		}
		var e error
		version, e = vr.RangeVersion(r.Context(), ks, f, t)
		if e != nil {
			errReply(w, e)
			return
		}
	}
	w.Header().Set("Content-Type", "application/gzip")
	name := "marketdepth-fixture.jsonl.gz"
	if a.Live {
		name = "marketdepth-history.jsonl.gz"
	}
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	gz := gzip.NewWriter(w)
	defer gz.Close()
	enc := json.NewEncoder(gz)
	counts := map[model.Kind]int{}
	gaps := map[model.Kind][]store.Gap{}
	for _, k := range ks {
		c := ""
		for {
			p, e := a.Reader.History(r.Context(), store.Query{Kind: k, From: f, To: t, Limit: 500, Cursor: c})
			if e != nil {
				return
			}
			if c == "" {
				gaps[k] = p.Gaps
			}
			for _, v := range p.Rows {
				if enc.Encode(map[string]any{"kind": k, "row": v}) != nil {
					return
				}
				counts[k]++
			}
			if p.Next == "" {
				break
			}
			c = p.Next
		}
	}
	if vr != nil {
		end, e := vr.RangeVersion(r.Context(), ks, f, t)
		if e != nil || end != version {
			return
		}
	}
	_ = enc.Encode(map[string]any{"type": "manifest", "complete": true, "mock": !a.Live, "contract_id": model.Contract, "row_counts": counts, "gaps": gaps})
}

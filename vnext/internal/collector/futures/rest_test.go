package futures

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRESTKlineRecoveryAndClosedCheck(t *testing.T) {
	now := time.UnixMilli(t0 + 61000)
	calls := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		switch r.URL.Path {
		case "/fapi/v1/time":
			fmt.Fprintf(w, `{"serverTime":%d}`, now.UnixMilli())
		case "/fapi/v1/klines":
			if r.URL.Query().Get("symbol") != "ETHUSDT" || r.URL.Query().Get("startTime") != fmt.Sprint(t0) || r.URL.Query().Get("endTime") != fmt.Sprint(t0+59999) {
				t.Error(r.URL)
			}
			fmt.Fprintf(w, `[[%d,"100","110","99","101","1",%d,"100",7,"0.5","50","0"]]`, t0, t0+59999)
		default:
			t.Error(r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer s.Close()
	c := NewRESTClient()
	c.base = s.URL
	c.now = func() time.Time { return now }
	r, e := c.Recover1m(context.Background(), "ETH", t0, 1)
	if e != nil || r.Status != "recovered" || r.Revision != 2 || *r.AvailableAt != now.UnixMilli() || *r.TradeCount != 7 {
		t.Fatal(r, e)
	}
	now = time.UnixMilli(t0 + 59000)
	if _, e = c.Recover1m(context.Background(), "ETH", t0, 1); e == nil || calls != 3 {
		t.Fatal("open minute fetched", e, calls)
	}
}
func TestRESTAggregatePaginationAndFailClosed(t *testing.T) {
	now := time.UnixMilli(t0 + 15000)
	gap := false
	requests := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/fapi/v1/time" {
			fmt.Fprintf(w, `{"serverTime":%d}`, now.UnixMilli())
			return
		}
		requests++
		q := r.URL.Query()
		if q.Get("startTime") != "" && q.Get("fromId") != "" {
			t.Error("mixed pagination")
		}
		id := q.Get("fromId")
		switch id {
		case "":
			fmt.Fprintf(w, `[{"a":100,"f":1,"l":1,"T":%d,"p":"100","q":"1","m":false}]`, t0-1)
		case "101":
			fmt.Fprintf(w, `[{"a":101,"f":2,"l":3,"T":%d,"p":"101","q":"2","m":true}]`, t0+1)
		case "102":
			n := 102
			if gap {
				n++
			}
			fmt.Fprintf(w, `[{"a":%d,"f":4,"l":4,"T":%d,"p":"200","q":"9","m":false}]`, n, t0+10000)
		default:
			t.Error(id)
			w.WriteHeader(400)
		}
	}))
	defer s.Close()
	c := NewRESTClient()
	c.base = s.URL
	c.now = func() time.Time { return now }
	r, e := c.Recover10(context.Background(), "BTC", t0, 1, nil)
	if e != nil || r.Revision != 2 || r.Status != "recovered" || *r.Close != 101 || *r.SellQty != 2 || requests != 3 {
		t.Fatal(r, e, requests)
	}
	var proof map[string]any
	if e = json.Unmarshal([]byte(*r.Quality), &proof); e != nil || proof["repair_complete"] != true {
		t.Fatal(proof, e)
	}
	gap = true
	if _, e = c.Recover10(context.Background(), "BTC", t0, 1, nil); e == nil {
		t.Fatal("missing page accepted")
	}
}
func TestRESTWeightAndCooldown(t *testing.T) {
	now := time.UnixMilli(t0)
	calls := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Retry-After", "120")
		w.WriteHeader(429)
	}))
	defer s.Close()
	c := NewRESTClient()
	c.base = s.URL
	c.now = func() time.Time { return now }
	_, _ = c.serverTime(context.Background())
	_, _ = c.serverTime(context.Background())
	if calls != 1 {
		t.Fatal(calls)
	}
	now = now.Add(121 * time.Second)
	_, _ = c.serverTime(context.Background())
	if calls != 2 {
		t.Fatal(calls)
	}
}

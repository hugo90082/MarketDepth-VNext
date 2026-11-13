package spot

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func testREST(t *testing.T, expected, body string, status int) *RESTSource {
	t.Helper()
	return &RESTSource{client: &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != expected || r.Method != "GET" {
			t.Fatalf("request %s %s", r.Method, r.URL)
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	})}, now: func() time.Time { return time.UnixMilli(60000) }}
}
func TestRESTFrozenEndpointsAndParsing(t *testing.T) {
	ctx := context.Background()
	body := `{"bids":[["9999","2"],["9250","1"]],"asks":[["10001","1"],["10750","1"]]}`
	for _, x := range []struct{ venue, asset, url string }{{"binance", "SOL", "https://api.binance.com/api/v3/depth?symbol=SOLUSDT&limit=5000"}, {"coinbase", "BTC", "https://api.exchange.coinbase.com/products/BTC-USD/book?level=2"}} {
		s := testREST(t, x.url, body, 200)
		r, e := s.Exact(ctx, x.venue, x.asset)
		if e != nil || r.CapturedAt != 60000 || *r.Depth.Zones[0].Bid != 19998 || *r.Depth.ObservedBid != 750 {
			t.Fatal(r, e)
		}
	}
	s := testREST(t, "https://api-pub.bitfinex.com/v2/book/tSOLUSD/P2?len=250", `[[9999,2,2],[9250,1,1],[10001,1,-1],[10750,1,-1]]`, 200)
	r, e := s.Bitfinex(ctx, "SOL", "P2")
	if e != nil || *r.Depth.Zones[0].Ask != 10001 {
		t.Fatal(r, e)
	}
	s = testREST(t, "https://api.kraken.com/0/public/Depth?pair=XBTUSD&count=500", `{"error":[],"result":{"XXBTZUSD":`+body+`}}`, 200)
	r, e = s.KrakenFallback(ctx, "BTC")
	if e != nil || r.Method != "kraken_rest500" {
		t.Fatal(r, e)
	}
	s = testREST(t, "https://api.kraken.com/0/public/GroupedBook?pair=ETHUSD&depth=1000&grouping=1000", `{"error":[],"result":{"pair":"ETHUSD","grouping":1000,"bids":[{"price":"9999","qty":"2"},{"price":"9250","qty":"1"}],"asks":[{"price":"10001","qty":"1"},{"price":"10750","qty":"1"}]}}`, 200)
	r, e = s.KrakenGrouped(ctx, "ETH")
	if e != nil || r.Method != "kraken_grouped1000" {
		t.Fatal(r, e)
	}
	if _, e = s.Exact(ctx, "binance", "BTC"); e == nil {
		t.Fatal("BTC REST bypass accepted")
	}
}
func TestRESTFailuresNotSilentlyAccepted(t *testing.T) {
	ctx := context.Background()
	u := "https://api.binance.com/api/v3/depth?symbol=SOLUSDT&limit=5000"
	for _, x := range []struct {
		body   string
		status int
	}{{`{}`, 429}, {`{"bids":[["99","bad"]],"asks":[["101","1"]]}`, 200}, {`{"bids":[["99","1"]],"asks":[["101","1"]]} {}`, 200}, {`{"bids":[["99","1"]],"asks":[]}`, 200}} {
		s := testREST(t, u, x.body, x.status)
		if _, e := s.Exact(ctx, "binance", "SOL"); e == nil {
			t.Fatal("accepted invalid response", x)
		}
	}
}

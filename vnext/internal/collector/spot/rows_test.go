package spot

import (
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"testing"
)

func testBook(t *testing.T, deep bool, at int64, method string) *CapturedBook {
	t.Helper()
	edge := 9900.0
	ask := 10100.0
	if deep {
		edge = 9250
		ask = 10750
	}
	d, e := Normalize([]Level{{9999, 2}, {edge, 1}}, []Level{{10001, 2}, {ask, 1}})
	if e != nil {
		t.Fatal(e)
	}
	return &CapturedBook{d, at, method}
}
func TestMergedRowsQuality(t *testing.T) {
	ex := testBook(t, false, 59500, "kraken_ws1000")
	g := testBook(t, true, 61000, "kraken_grouped1000")
	r, e := KrakenRow(60000, 61500, "BTC", ex, g, nil)
	if e != nil || r.Status != "ok" || *r.TrustedBid != 100 || *r.ObservedBid != 100 || r.Bid500750 == nil || *r.Bid0100 != 19998 {
		t.Fatal(r, e)
	}
	r, e = KrakenRow(60000, 61500, "BTC", nil, g, nil)
	if e != nil || r.MidPrice != nil || r.TrustedBid != nil || r.Bid500750 == nil {
		t.Fatal(r, e)
	}
	late := *g
	late.CapturedAt = 61501
	r, e = KrakenRow(60000, 62000, "BTC", ex, &late, nil)
	if e != nil || r.Bid500750 != nil {
		t.Fatal(r, e)
	}
	r, e = BitfinexRow(60000, 62000, "SOL", ex, &late)
	if e != nil || r.Status != "missing" || r.Bid0100 != nil {
		t.Fatal(r, e)
	}
	r, e = BitfinexRow(60000, 61500, "SOL", ex, g)
	if e != nil || r.Status != "ok" || r.MidPrice != nil || r.TrustedBid != nil {
		t.Fatal(r, e)
	}
}
func TestBinanceRowExactT(t *testing.T) {
	d := testBook(t, true, 59999, "test").Depth
	c := BinanceCut{T: 60000, LastDataAt: 59999, Last: 10, Depth: d, TrustedBid: model.Ptr(10.0), TrustedAsk: model.Ptr(20.0)}
	r, e := BinanceCutRow(60000, 61500, "BTC", c)
	if e != nil || *r.CapturedAt != 60000 || *r.TrustedBid != 10 || *r.ObservedBid != 750 {
		t.Fatal(r, e)
	}
	c.LastDataAt = 60001
	r, e = BinanceCutRow(60000, 61500, "BTC", c)
	if e != nil || r.Status != "missing" {
		t.Fatal(r, e)
	}
}

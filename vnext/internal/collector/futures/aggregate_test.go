package futures

import (
	"errors"
	"testing"
)

const t0 int64 = 1794499200000

func tr(id, off int64, p, q float64, m bool) Trade {
	return Trade{Asset: "BTC", ID: id, First: id * 2, Last: id*2 + 1, T: t0 + off, Received: t0 + off + 100, Price: p, Qty: q, BuyerMaker: m}
}
func TestAggregateCausalDedupAndSides(t *testing.T) {
	// out-of-order arrival, equal trade time tie-break, duplicate and post-bar bracket
	xs := []Trade{tr(14, 10000, 999, 9, false), tr(12, 5000, 110, 2, true), tr(11, 0, 100, 1, false), tr(10, -1, 90, 1, false), tr(13, 5000, 105, 3, false), tr(12, 5000, 110, 2, true)}
	r, e := BuildBar("BTC", t0, t0+12000, xs, true)
	if e != nil || r.Status != "ok" || *r.Open != 100 || *r.Close != 105 || *r.High != 110 || *r.Low != 100 || *r.BuyQty != 4 || *r.SellQty != 2 || *r.BuyUSDT != 415 || *r.SellUSDT != 220 || *r.AggCount != 3 || *r.FirstAggID != 11 || *r.LastAggID != 13 {
		t.Fatal(r, e)
	}
	r, e = BuildBar("BTC", t0, t0+10000, xs, true)
	if e != nil || r.Status != "partial" || *r.AggCount != 3 {
		t.Fatal("future bracket used", r, e)
	}
	r, e = BuildBar("BTC", t0, t0+12000, []Trade{xs[0], xs[2], xs[3]}, true)
	if e != nil || r.Status != "partial" {
		t.Fatal("gap accepted", r, e)
	}
}
func TestEmptyVsMissing(t *testing.T) {
	a, b := tr(100, -1, 10, 1, false), tr(101, 10000, 20, 1, false)
	r, e := BuildBar("BTC", t0, t0+12000, []Trade{a, b}, true)
	if e != nil || r.Status != "empty" || r.Open != nil || *r.BuyQty != 0 || *r.AggCount != 0 {
		t.Fatal(r, e)
	}
	r, e = BuildBar("BTC", t0, t0+12000, []Trade{a, b}, false)
	if e != nil || r.Status != "missing" || r.AggCount != nil || r.BuyQty != nil {
		t.Fatal(r, e)
	}
	b.ID++
	r, e = BuildBar("BTC", t0, t0+12000, []Trade{a, b}, true)
	if e != nil || r.Status != "missing" {
		t.Fatal(r, e)
	}
}
func TestTimeOrderAndConflictingID(t *testing.T) {
	a, b, c := tr(1, -1, 10, 1, false), tr(2, 6000, 11, 1, false), tr(3, 5000, 12, 1, false)
	d := tr(4, 10000, 13, 1, false)
	r, e := BuildBar("BTC", t0, t0+12000, []Trade{a, b, c, d}, true)
	if e != nil || r.Status != "partial" || *r.Open != 12 || *r.Close != 11 {
		t.Fatal(r, e)
	}
	c.ID = b.ID
	if _, e = BuildBar("BTC", t0, t0+12000, []Trade{b, c}, true); e == nil {
		t.Fatal("conflict accepted")
	}
}
func TestWSParsing(t *testing.T) {
	x, e := ParseWSAgg([]byte(`{"e":"aggTrade","s":"BTCUSDT","a":9007199254740993,"p":"100.5","q":"0.2","f":5,"l":6,"T":1794499200000,"m":true}`), t0+1)
	if e != nil || x.ID != 9007199254740993 || !x.BuyerMaker {
		t.Fatal(x, e)
	}
	if _, e = ParseWSAgg([]byte(`{"e":"aggTrade","s":"BTCUSD","a":1,"p":"100","q":"1","f":2,"l":3,"T":1794499200000,"m":false}`), t0+1); e == nil {
		t.Fatal("coin-M accepted")
	}
}
func TestOfficialClosedKline(t *testing.T) {
	raw := `{"e":"kline","s":"BTCUSDT","k":{"t":1794499200000,"T":1794499259999,"s":"BTCUSDT","i":"1m","x":true,"o":"100","h":"120","l":"99","c":"101","v":"10","q":"1100","V":"4","Q":"450","n":23}}`
	r, e := ParseWSKline([]byte(raw), t0+60000)
	if e != nil || *r.Volume != 10 || *r.TakerBuyUSDT != 450 || *r.TradeCount != 23 {
		t.Fatal(r, e)
	}
	if _, e = ParseWSKline([]byte(raw), t0+59999); e == nil {
		t.Fatal("unclosed by local clock")
	}
	raw2 := []byte(`{"e":"kline","s":"BTCUSDT","k":{"t":1794499200000,"T":1794499259999,"s":"BTCUSDT","i":"1m","x":false,"n":0}}`)
	if _, e = ParseWSKline(raw2, t0+60000); !errors.Is(e, ErrOpenKline) {
		t.Fatal(e)
	}
}

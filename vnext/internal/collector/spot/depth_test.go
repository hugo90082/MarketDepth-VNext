package spot

import (
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"math"
	"testing"
)

func TestZonesHalfOpenAndZero(t *testing.T) {
	d, e := Normalize([]Level{{9999, 2}, {9900, 3}, {9800, 4}, {9700, 5}, {9500, 6}, {9250, 7}}, []Level{{10001, 1}, {10750, 1}})
	if e != nil {
		t.Fatal(e)
	}
	if *d.Mid != 10000 || *d.ObservedBid != 750 || *d.ObservedAsk != 750 {
		t.Fatal(d)
	}
	want := []float64{19998, 29700, 39200, 48500, 57000}
	for i, p := range d.Zones {
		if p.Bid == nil || *p.Bid != want[i] {
			t.Fatal(i, p)
		}
		if p.Ask == nil {
			t.Fatal("unknown ask", i)
		}
		a := 0.0
		if i == 0 {
			a = 10001
		}
		if *p.Ask != a {
			t.Fatal(i, *p.Ask)
		}
	}
}
func TestIndependentCoverage(t *testing.T) {
	d, e := Normalize([]Level{{9999, 1}, {9250, 1}}, []Level{{10001, 1}, {10100, 1}})
	if e != nil {
		t.Fatal(e)
	}
	if d.Zones[0].Ask == nil || d.Zones[1].Ask != nil || d.Zones[4].Bid == nil {
		t.Fatal(d)
	}
	if *d.Zones[4].Bid != 0 {
		t.Fatal("boundary 750 counted")
	}
}
func TestRejectInvalid(t *testing.T) {
	for _, b := range [][]Level{{{10002, 1}}, {{9999, 1}, {9999, 2}}, {{9999, -1}}, {{9999, math.NaN()}}, {{9999, 0}}} {
		if _, e := Normalize(b, []Level{{10001, 1}}); e == nil {
			t.Fatal(b)
		}
	}
}
func TestMergeAndWindow(t *testing.T) {
	var exact, group [5]Pair
	exact[0].Bid = model.Ptr(0.0)
	group[0] = Pair{model.Ptr(99.0), model.Ptr(5.0)}
	group[1].Bid = model.Ptr(10.0)
	x := PreferExact(exact, group)
	if *x[0].Bid != 0 || *x[0].Ask != 5 {
		t.Fatal(x)
	}
	x = BitfinexZones(exact, group)
	if x[0].Ask != nil || *x[1].Bid != 10 {
		t.Fatal(x)
	}
	if !WithinWindow(60000, 58500) || !WithinWindow(60000, 61500) || WithinWindow(60000, 61501) {
		t.Fatal("window")
	}
	if Symbol("bitfinex", "SOL") != "tSOLUSD" || Symbol("kraken", "BTC") != "XBTUSD" || Symbol("okx", "BTC") != "" {
		t.Fatal("mapping")
	}
}

func TestExactRow(t *testing.T) {
	b := []Level{{9999, 1}, {9250, 1}}
	a := []Level{{10001, 1}, {10100, 1}}
	r, e := ExactSnapshotRow(60000, 59500, 61000, "coinbase", "BTC", b, a)
	if e != nil || r.Status != "partial" || r.Ask100200 != nil || r.Bid500750 == nil || *r.Bid500750 != 0 || *r.CapturedAt != 59500 || *r.AvailableAt != 61000 {
		t.Fatal(r, e)
	}
	r, e = ExactSnapshotRow(60000, 61501, 62000, "binance", "SOL", b, a)
	if e != nil || r.Status != "missing" || r.Bid0100 != nil || r.MidPrice != nil {
		t.Fatal(r, e)
	}
	if _, e = ExactSnapshotRow(60000, 60000, 61000, "binance", "BTC", b, a); e == nil {
		t.Fatal("persistent book wrongly accepted as REST")
	}
}

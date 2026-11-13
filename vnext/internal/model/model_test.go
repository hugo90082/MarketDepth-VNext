package model

import (
	"encoding/json"
	"math"
	"testing"
)

func TestValidate(t *testing.T) {
	base := Common{T: 60000, Asset: "BTC", Source: Ptr(LiveSource), AvailableAt: Ptr(int64(70000)), Status: "partial", Revision: 1}
	s := SpotRow{Common: base, Venue: "binance", Bid0100: Ptr(0.0)}
	if e := s.Validate(); e != nil {
		t.Fatal(e)
	}
	s.Bid0100 = Ptr(-1.0)
	if s.Validate() == nil {
		t.Fatal("negative accepted")
	}
	s.Bid0100 = Ptr(math.Inf(1))
	if s.Validate() == nil {
		t.Fatal("infinity accepted")
	}
	s.Bid0100 = nil
	s.T = 60001
	if s.Validate() == nil {
		t.Fatal("off grid")
	}
	r := Futures10Row{Common: base}
	r.AvailableAt = Ptr(int64(69999))
	if r.Validate() == nil {
		t.Fatal("early bar")
	}
	r.AvailableAt = Ptr(int64(70000))
	r.Status = "empty"
	if r.Validate() == nil {
		t.Fatal("unknown as zero")
	}
	r.BuyQty = Ptr(0.0)
	r.SellQty = Ptr(0.0)
	r.BuyUSDT = Ptr(0.0)
	r.SellUSDT = Ptr(0.0)
	r.AggCount = Ptr(int64(0))
	if e := r.Validate(); e != nil {
		t.Fatal(e)
	}
	r.Open = Ptr(1.0)
	if r.Validate() == nil {
		t.Fatal("empty bar OHLC")
	}
}
func TestDay(t *testing.T) {
	if Day(0) != "1970-01-01" || Day(16*3600*1000-1) != "1970-01-01" || Day(16*3600*1000) != "1970-01-02" {
		t.Fatal("day boundary")
	}
}
func TestNullZero(t *testing.T) {
	s := SpotRow{Common: Common{T: 60000, Asset: "BTC", Status: "legacy_unknown", Revision: 1}, Venue: "kraken", Bid0100: Ptr(0.0)}
	b, _ := json.Marshal(s)
	var m map[string]any
	json.Unmarshal(b, &m)
	if m["bid_0_100"] != float64(0) || m["ask_0_100"] != nil {
		t.Fatal(string(b))
	}
	if _, e := Decode(Spot, b); e != nil {
		t.Fatal(e)
	}
}

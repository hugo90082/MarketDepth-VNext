package spot

import "testing"

func snap() BinanceSnapshot {
	return BinanceSnapshot{Last: 100, Bids: []Level{{9999, 1}, {9900, 1}}, Asks: []Level{{10001, 1}, {10100, 1}}}
}
func TestBinanceBridgeAndCut(t *testing.T) {
	s := snap()
	if _, _, e := Bridge(s, nil); e == nil {
		t.Fatal("empty bridge")
	}
	if _, _, e := Bridge(s, []BinanceDelta{{First: 103, Last: 104}}); e == nil {
		t.Fatal("gap accepted")
	}
	b, _ := NewBinanceBook(60000)
	if e := b.Install(50000, s, []BinanceDelta{{First: 100, Last: 101, Bids: []Level{{9250, 1}}, Asks: []Level{{10750, 1}}}}, false); e != nil {
		t.Fatal(e)
	}
	if e := b.Delta(60000, BinanceDelta{First: 102, Last: 102, Bids: []Level{{9999, 2}}}); e != nil {
		t.Fatal(e)
	}
	if e := b.Delta(60001, BinanceDelta{First: 103, Last: 103, Bids: []Level{{9999, 99}}}); e != nil {
		t.Fatal(e)
	}
	c, e := b.Cut(60000, 61000)
	if e != nil || c.Reason != "" || c.Last != 102 || *c.Depth.Zones[0].Bid != 19998 || *c.TrustedBid != 100 || *c.Depth.ObservedBid != 750 {
		t.Fatal(c, e)
	}
	if e := b.Delta(115000, BinanceDelta{First: 105, Last: 105}); e == nil {
		t.Fatal("gap accepted")
	}
	c, e = b.Cut(120000, 121000)
	if e != nil || c.Reason != "sequence_gap" || c.Depth.Mid != nil {
		t.Fatal(c, e)
	}
}
func TestBinanceRefreshZeroAndTrustAtCut(t *testing.T) {
	b, _ := NewBinanceBook(60000)
	s := snap()
	if e := b.Install(50000, s, []BinanceDelta{{First: 101, Last: 101, Bids: []Level{{9500, 2}, {9250, 1}}, Asks: []Level{{10750, 1}}}}, false); e != nil {
		t.Fatal(e)
	}
	fresh := BinanceSnapshot{Last: 101, Bids: []Level{{9999, 1}, {9800, 1}}, Asks: []Level{{10001, 1}, {10200, 1}}}
	if e := b.Install(60001, fresh, []BinanceDelta{{First: 102, Last: 102, Bids: []Level{{9500, 0}}}}, true); e != nil {
		t.Fatal(e)
	}
	c, e := b.Cut(60000, 61000)
	if e != nil || *c.TrustedBid != 100 || *c.Depth.Zones[4].Bid != 19000 {
		t.Fatal(c, e)
	}
	if e = b.Delta(119000, BinanceDelta{First: 103, Last: 103}); e != nil {
		t.Fatal(e)
	}
	c, e = b.Cut(120000, 121000)
	if e != nil || *c.TrustedBid != 200 || *c.Depth.ObservedBid != 750 || *c.Depth.Zones[4].Bid != 0 {
		t.Fatal(c, e)
	}
}
func TestBinanceFreshnessAndMapParity(t *testing.T) {
	b, _ := NewBinanceBook(60000)
	s := snap()
	if e := b.Install(1000, s, []BinanceDelta{{First: 101, Last: 101}}, false); e != nil {
		t.Fatal(e)
	}
	c, e := b.Cut(60000, 61000)
	if e != nil || c.Reason != "stale_depth" {
		t.Fatal(c, e)
	}
	d, e := mapDepth(map[float64]float64{9999: 2, 9250: 1}, map[float64]float64{10001: 3, 10750: 1})
	d2, e2 := Normalize([]Level{{9999, 2}, {9250, 1}}, []Level{{10001, 3}, {10750, 1}})
	if e != nil || e2 != nil || *d.Zones[0].Bid != *d2.Zones[0].Bid || *d.Zones[0].Ask != *d2.Zones[0].Ask || *d.ObservedBid != *d2.ObservedBid {
		t.Fatal(d, d2, e, e2)
	}
}

func TestBinanceCertifiedIntervalSurvivesContinuousRefresh(t *testing.T){
 b,_:=NewBinanceBook(60000)
 deep:=BinanceSnapshot{Last:100,Bids:[]Level{{9999,1},{9250,1}},Asks:[]Level{{10001,1},{10750,1}}}
 if e:=b.Install(50000,deep,[]BinanceDelta{{First:101,Last:101}},false);e!=nil{t.Fatal(e)}
 shallow:=snap();shallow.Last=101
 if e:=b.Install(55000,shallow,[]BinanceDelta{{First:102,Last:102}},true);e!=nil{t.Fatal(e)}
 if e:=b.Delta(59000,BinanceDelta{First:103,Last:103});e!=nil{t.Fatal(e)}
 c,e:=b.Cut(60000,61000)
 if e!=nil||c.Reason!=""||*c.TrustedBid!=750||*c.TrustedAsk!=750{t.Fatal(c,e)}
 // A new snapshot cannot prove that unseen updates outside its own edges
 // were applied. Reject the refresh if its bridge skips the old cursor.
 shallow.Last=110
 if e=b.Install(62000,shallow,[]BinanceDelta{{First:111,Last:111}},true);e==nil{t.Fatal("accepted gap in retained outside interval")}
 if e=b.Install(63000,shallow,[]BinanceDelta{{First:111,Last:111}},false);e!=nil{t.Fatal(e)}
 if e=b.Delta(119000,BinanceDelta{First:112,Last:112,Bids:[]Level{{9250,1}},Asks:[]Level{{10750,1}}});e!=nil{t.Fatal(e)}
 c,e=b.Cut(120000,121000)
 if e!=nil||c.Reason!=""||*c.TrustedBid!=100||*c.Depth.ObservedBid!=750{t.Fatal(c,e)}
}
func TestBinanceRejectBestOutsideCertifiedInterval(t *testing.T){
 b,_:=NewBinanceBook(60000)
 if e:=b.Install(50000,snap(),[]BinanceDelta{{First:101,Last:101,Bids:[]Level{{9250,1}}}},false);e!=nil{t.Fatal(e)}
 if e:=b.Delta(59000,BinanceDelta{First:102,Last:102,Bids:[]Level{{9999,0},{9900,0}}});e!=nil{t.Fatal(e)}
 c,e:=b.Cut(60000,61000)
 if e!=nil||c.Reason==""||c.Depth.Mid!=nil{t.Fatal("unproven BBO",c,e)}
}

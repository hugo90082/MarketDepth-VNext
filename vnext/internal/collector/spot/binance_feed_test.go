package spot

import (
	"errors"
	"testing"
	"time"
)

func TestBinanceSessionBridgeAndRefresh(t *testing.T) {
	f, e := NewBinanceFeed("BTC", 60000)
	if e != nil {
		t.Fatal(e)
	}
	now := int64(50000)
	f.now = func() time.Time { return time.UnixMilli(now) }
	s := f.newSession()
	if e = s.tryInstall(snap()); !errors.Is(e, ErrBridgePending) {
		t.Fatal(e)
	}
	if e = s.onDelta(BinanceDelta{First: 101, Last: 101, Bids: []Level{{9250, 1}}, Asks: []Level{{10750, 1}}}); e != nil {
		t.Fatal(e)
	}
	if e = s.tryInstall(snap()); e != nil {
		t.Fatal(e)
	}
	if e = s.beginRefresh(); e != nil {
		t.Fatal(e)
	}
	now = 60000
	if e = s.onDelta(BinanceDelta{First: 102, Last: 102, Bids: []Level{{9999, 2}}}); e != nil {
		t.Fatal(e)
	}
	now = 60001
	fresh := snap()
	fresh.Last = 101
	if e = s.tryInstall(fresh); e != nil {
		t.Fatal(e)
	}
	now = 61000
	c, e := f.Cut(60000)
	if e != nil || *c.Depth.Zones[0].Bid != 19998 || c.Last != 102 {
		t.Fatal(c, e)
	}
	if f.StreamURL() != "wss://stream.binance.com:9443/ws/btcusdt@depth" {
		t.Fatal(f.StreamURL())
	}
	s.fail("disconnect")
	now = 121000
	c, e = f.Cut(120000)
	if e != nil || c.Reason != "disconnect" {
		t.Fatal(c, e)
	}
}
func TestBinanceSessionBufferBound(t *testing.T) {
	f, _ := NewBinanceFeed("ETH", 60000)
	f.now = func() time.Time { return time.UnixMilli(50000) }
	s := f.newSession()
	for i := 0; i < maxBridgeMessages; i++ {
		if e := s.onDelta(BinanceDelta{First: 1, Last: 1}); e != nil {
			t.Fatal(e)
		}
	}
	if e := s.onDelta(BinanceDelta{First: 1, Last: 1}); e == nil || !s.failed || len(s.buf) != 0 {
		t.Fatal("buffer limit failed")
	}
}

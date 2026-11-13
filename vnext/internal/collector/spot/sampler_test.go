package spot

import (
	"context"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"strings"
	"testing"
)

func TestSamplerTwelveRowsAndMissingSemantics(t *testing.T) {
	in := newInputs()
	in.books[partKey("coinbase", "BTC", "exact")] = testBook(t, true, 59999, "exact_rest_snapshot")
	in.failures[partKey("kraken", "BTC", "ws")] = "deadline"
	rows, e := in.buildRows(60000, 61500)
	if e != nil || len(rows) != 12 {
		t.Fatal(len(rows), e)
	}
	seen := map[model.Key]bool{}
	for _, r := range rows {
		if seen[r.Key()] {
			t.Fatal("duplicate")
		}
		seen[r.Key()] = true
		sp := r.(model.SpotRow)
		if sp.Venue == "coinbase" && sp.Asset == "BTC" {
			if sp.Status != "ok" || sp.Bid0100 == nil {
				t.Fatal(sp)
			}
		} else if sp.Status != "missing" || sp.Bid0100 != nil || sp.Ask0100 != nil {
			t.Fatal(sp)
		}
		if sp.Venue == "kraken" && sp.Asset == "BTC" && !strings.Contains(*sp.Quality, "deadline") {
			t.Fatal(sp)
		}
	}
	rows, e = missingGrid(60000, 63000, "scheduler_miss")
	if e != nil || len(rows) != 12 {
		t.Fatal(len(rows), e)
	}
	for _, r := range rows {
		if r.Base().Status != "missing" {
			t.Fatal(r)
		}
	}
}

func TestSamplerMissedWindowDoesNotFetch(t *testing.T) {
	s := &Sampler{} // no providers: calling any network path would panic
	rows, e := s.SampleAt(context.Background(), 60000)
	if e != nil || len(rows) != 12 {
		t.Fatal(e, len(rows))
	}
	for _, r := range rows {
		if r.Base().Status != "missing" || !strings.Contains(*r.Base().Quality, "scheduler_miss") {
			t.Fatal(r)
		}
	}
}

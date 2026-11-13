package spot

import (
	"encoding/json"
	"errors"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// ExactSnapshotRow is for complete native REST L2 snapshots (Binance SOL,
// Coinbase). Other adapters have distinct trust/merge rules and must not call it.
// Captured is the actual receipt timestamp, available is after processing.
func ExactSnapshotRow(t, captured, available int64, venue, asset string, bids, asks []Level) (model.SpotRow, error) {
	if !((venue == "binance" && asset == "SOL") || venue == "coinbase") || Symbol(venue, asset) == "" {
		return model.SpotRow{}, errors.New("unsupported exact REST adapter")
	}
	if captured > available || available < t {
		return model.SpotRow{}, errors.New("invalid availability")
	}
	if !WithinWindow(t, captured) {
		return missingRow(t, available, &captured, venue, asset, "outside_capture_window")
	}
	d, e := Normalize(bids, asks)
	if e != nil {
		return missingRow(t, available, &captured, venue, asset, "invalid_book")
	}
	src := model.LiveSource
	status := "ok"
	for _, p := range d.Zones {
		if p.Bid == nil || p.Ask == nil {
			status = "partial"
		}
	}
	q, _ := json.Marshal(map[string]any{"method": "exact_rest_snapshot", "symbol": Symbol(venue, asset), "capture_offset_ms": captured - t, "coverage_basis": "native_snapshot_edges"})
	r := model.SpotRow{Common: model.Common{T: t, AvailableAt: &available, Asset: asset, Status: status, Source: &src, Quality: model.Ptr(string(q)), Revision: 1}, Venue: venue, BidPrice: d.Bid, AskPrice: d.Ask, MidPrice: d.Mid, ObservedBid: d.ObservedBid, ObservedAsk: d.ObservedAsk, TrustedBid: d.ObservedBid, TrustedAsk: d.ObservedAsk, CapturedAt: &captured,
		Bid0100: d.Zones[0].Bid, Ask0100: d.Zones[0].Ask, Bid100200: d.Zones[1].Bid, Ask100200: d.Zones[1].Ask, Bid200300: d.Zones[2].Bid, Ask200300: d.Zones[2].Ask, Bid300500: d.Zones[3].Bid, Ask300500: d.Zones[3].Ask, Bid500750: d.Zones[4].Bid, Ask500750: d.Zones[4].Ask}
	return r, r.Validate()
}
func missingRow(t, available int64, captured *int64, venue, asset, reason string) (model.SpotRow, error) {
	src := model.LiveSource
	q, _ := json.Marshal(map[string]any{"reason": reason, "symbol": Symbol(venue, asset)})
	r := model.SpotRow{Common: model.Common{T: t, AvailableAt: &available, Asset: asset, Status: "missing", Source: &src, Quality: model.Ptr(string(q)), Revision: 1}, Venue: venue, CapturedAt: captured}
	return r, r.Validate()
}

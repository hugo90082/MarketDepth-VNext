package spot

import (
	"encoding/json"
	"errors"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// depthRow materializes a normalized, provenance-bearing result. NULL and
// confirmed zero are preserved independently. Grouped/rounded sources never
// masquerade as exact BBO or trusted native levels.
func depthRow(t, available int64, venue, asset string, captured *int64, d Depth, tb, ta *float64, q map[string]any) (model.SpotRow, error) {
	if available < t || (captured != nil && *captured > available) {
		return model.SpotRow{}, errors.New("invalid availability")
	}
	src := model.LiveSource
	status := "ok"
	known := 0
	for _, p := range d.Zones {
		if p.Bid != nil {
			known++
		}
		if p.Ask != nil {
			known++
		}
	}
	if known < 10 {
		status = "partial"
	}
	if known == 0 && d.Mid == nil {
		status = "missing"
	}
	quality, e := json.Marshal(q)
	if e != nil {
		return model.SpotRow{}, e
	}
	r := model.SpotRow{Common: model.Common{T: t, AvailableAt: &available, Asset: asset, Status: status, Source: &src, Quality: model.Ptr(string(quality)), Revision: 1}, Venue: venue, BidPrice: d.Bid, AskPrice: d.Ask, MidPrice: d.Mid, ObservedBid: d.ObservedBid, ObservedAsk: d.ObservedAsk, TrustedBid: tb, TrustedAsk: ta, CapturedAt: captured, Bid0100: d.Zones[0].Bid, Ask0100: d.Zones[0].Ask, Bid100200: d.Zones[1].Bid, Ask100200: d.Zones[1].Ask, Bid200300: d.Zones[2].Bid, Ask200300: d.Zones[2].Ask, Bid300500: d.Zones[3].Bid, Ask300500: d.Zones[3].Ask, Bid500750: d.Zones[4].Bid, Ask500750: d.Zones[4].Ask}
	return r, r.Validate()
}
func validCapture(t, available int64, b *CapturedBook) bool {
	return b != nil && WithinWindow(t, b.CapturedAt) && b.CapturedAt <= available && b.Depth.Mid != nil
}
func captureQuality(b *CapturedBook, t int64) any {
	if b == nil {
		return nil
	}
	return map[string]any{"method": b.Method, "captured_at": b.CapturedAt, "capture_offset_ms": b.CapturedAt - t, "mid": b.Depth.Mid, "observed_bid_bps": b.Depth.ObservedBid, "observed_ask_bps": b.Depth.ObservedAsk}
}
func later(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
func ExactCapturedRow(t, available int64, venue, asset string, b *CapturedBook) (model.SpotRow, error) {
	if !((venue == "binance" && asset == "SOL") || venue == "coinbase") || Symbol(venue, asset) == "" {
		return model.SpotRow{}, errors.New("wrong exact adapter")
	}
	if !validCapture(t, available, b) {
		return missingRow(t, available, nil, venue, asset, "snapshot_missing_or_outside_window")
	}
	return depthRow(t, available, venue, asset, &b.CapturedAt, b.Depth, b.Depth.ObservedBid, b.Depth.ObservedAsk, map[string]any{"method": b.Method, "symbol": Symbol(venue, asset), "capture_offset_ms": b.CapturedAt - t, "coverage_basis": "native_snapshot_edges"})
}
func BinanceCutRow(t, available int64, asset string, c BinanceCut) (model.SpotRow, error) {
	if asset != "BTC" && asset != "ETH" {
		return model.SpotRow{}, errors.New("wrong Binance asset")
	}
	if c.T != t || c.Reason != "" || c.Depth.Mid == nil || c.LastDataAt > t || t-c.LastDataAt > BinanceMaxAgeMS {
		return missingRow(t, available, nil, "binance", asset, "local_book:"+c.Reason)
	}
	return depthRow(t, available, "binance", asset, &t, c.Depth, c.TrustedBid, c.TrustedAsk, map[string]any{"method": "binance_rest5000_diff1000ms_exact_t", "symbol": Symbol("binance", asset), "last_depth_admitted_at": c.LastDataAt, "last_update_id": c.Last, "depth_age_ms": t - c.LastDataAt, "coverage_basis": "observed_local_book; trusted_contiguous_snapshot_union", "snapshot_bid_edge":c.SnapshotBidEdge,"snapshot_ask_edge":c.SnapshotAskEdge,"certified_bid_edge":c.CertifiedBidEdge,"certified_ask_edge":c.CertifiedAskEdge,"snapshot_last_update_id":c.SnapshotLast,"continuous_refresh_count":c.RefreshCount})
}

// Kraken retains the legacy exact-first and grouped-only-on-unknown rules.
// If both primary and grouped fail, use the exact REST500 fallback. Grouped
// values use their own mid; its BBO and trusted coverage are not native facts.
func KrakenRow(t, available int64, asset string, exact, grouped, fallback *CapturedBook) (model.SpotRow, error) {
	if !model.AssetOK(asset) {
		return model.SpotRow{}, errors.New("invalid asset")
	}
	ex, g, fb := validCapture(t, available, exact), validCapture(t, available, grouped) && (asset == "BTC" || asset == "ETH"), validCapture(t, available, fallback)
	q := map[string]any{"method": "kraken_exact_first", "symbol": Symbol("kraken", asset), "exact": captureQuality(exact, t), "grouped": captureQuality(grouped, t), "fallback": captureQuality(fallback, t)}
	var d Depth
	var tb, ta *float64
	var capAt int64
	var src [5][2]string
	switch {
	case ex:
		d = exact.Depth
		tb, ta = d.ObservedBid, d.ObservedAsk
		capAt = exact.CapturedAt
		for i, p := range d.Zones {
			if p.Bid != nil {
				src[i][0] = exact.Method
			}
			if p.Ask != nil {
				src[i][1] = exact.Method
			}
		}
		if g {
			for i, p := range grouped.Depth.Zones {
				if d.Zones[i].Bid == nil && p.Bid != nil {
					d.Zones[i].Bid = p.Bid
					src[i][0] = grouped.Method
				}
				if d.Zones[i].Ask == nil && p.Ask != nil {
					d.Zones[i].Ask = p.Ask
					src[i][1] = grouped.Method
				}
			}
			capAt = later(capAt, grouped.CapturedAt)
		}
	case g:
		d = grouped.Depth
		d.Bid, d.Ask, d.Mid = nil, nil, nil
		capAt = grouped.CapturedAt
		for i, p := range d.Zones {
			if p.Bid != nil {
				src[i][0] = grouped.Method
			}
			if p.Ask != nil {
				src[i][1] = grouped.Method
			}
		}
	case fb:
		d = fallback.Depth
		tb, ta = d.ObservedBid, d.ObservedAsk
		capAt = fallback.CapturedAt
		for i, p := range d.Zones {
			if p.Bid != nil {
				src[i][0] = fallback.Method
			}
			if p.Ask != nil {
				src[i][1] = fallback.Method
			}
		}
	default:
		return missingRow(t, available, nil, "kraken", asset, "snapshot_missing_or_outside_window")
	}
	q["zone_side_methods"] = src
	q["observed_basis"] = "primary_native_or_grouped_only; per-source coverage in quality_json"
	return depthRow(t, available, "kraken", asset, &capAt, d, tb, ta, q)
}

// Keep legacy fixed precision. Both books must be valid in the target window;
// otherwise reject the row, rather than allow a late book or switch precision.
func BitfinexRow(t, available int64, asset string, p1, p2 *CapturedBook) (model.SpotRow, error) {
	if !model.AssetOK(asset) {
		return model.SpotRow{}, errors.New("invalid asset")
	}
	if !validCapture(t, available, p1) || !validCapture(t, available, p2) {
		return missingRow(t, available, nil, "bitfinex", asset, "p1_or_p2_missing_or_outside_window")
	}
	d := p2.Depth
	d.Zones = BitfinexZones(p1.Depth.Zones, p2.Depth.Zones)
	d.Bid, d.Ask, d.Mid = nil, nil, nil
	capAt := later(p1.CapturedAt, p2.CapturedAt)
	return depthRow(t, available, "bitfinex", asset, &capAt, d, nil, nil, map[string]any{"method": "bitfinex_fixed_p1_p2", "symbol": Symbol("bitfinex", asset), "p1": captureQuality(p1, t), "p2": captureQuality(p2, t), "zone_methods": [5]string{"P1", "P2", "P2", "P2", "P2"}, "observed_basis": "P2; P1 independently recorded"})
}

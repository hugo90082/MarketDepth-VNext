// Package spot contains offline spot-depth normalization. No network calls yet.
package spot

import (
	"errors"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"math"
)

const WindowMS int64 = 1500

var bounds = [6]float64{0, 100, 200, 300, 500, 750}
var symbols = map[string]map[string]string{
	"binance":  {"BTC": "BTCUSDT", "ETH": "ETHUSDT", "SOL": "SOLUSDT"},
	"coinbase": {"BTC": "BTC-USD", "ETH": "ETH-USD", "SOL": "SOL-USD"},
	"kraken":   {"BTC": "XBTUSD", "ETH": "ETHUSD", "SOL": "SOLUSD"},
	"bitfinex": {"BTC": "tBTCUSD", "ETH": "tETHUSD", "SOL": "tSOLUSD"},
}

func Symbol(venue, asset string) string { return symbols[venue][asset] }

type Level struct{ Price, Qty float64 }
type Pair struct{ Bid, Ask *float64 }
type Depth struct {
	Bid, Ask, Mid            *float64
	ObservedBid, ObservedAsk *float64
	Zones                    [5]Pair
}

func finite(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) }

// Normalize exact levels as in legacy zonesFromLevels: [low,high), independent side coverage.
// Grouped book adapter must supply its own provenance; do not infer trusted coverage here.
func Normalize(bids, asks []Level) (Depth, error) {
	var d Depth
	bestBid, minBid, bestAsk, maxAsk := 0.0, math.Inf(1), math.Inf(1), 0.0
	for _, side := range [][]Level{bids, asks} {
		seen := map[float64]bool{}
		for _, l := range side {
			if !finite(l.Price) || !finite(l.Qty) || l.Price <= 0 || l.Qty < 0 {
				return d, errors.New("invalid level")
			}
			if l.Qty > 0 {
				if seen[l.Price] {
					return d, errors.New("duplicate price level")
				}
				seen[l.Price] = true
			}
		}
	}
	for _, l := range bids {
		if l.Qty == 0 {
			continue
		}
		bestBid = math.Max(bestBid, l.Price)
		minBid = math.Min(minBid, l.Price)
	}
	for _, l := range asks {
		if l.Qty == 0 {
			continue
		}
		bestAsk = math.Min(bestAsk, l.Price)
		maxAsk = math.Max(maxAsk, l.Price)
	}
	if bestBid <= 0 || !finite(bestAsk) || bestBid >= bestAsk {
		return d, errors.New("missing or crossed book")
	}
	mid := (bestBid + bestAsk) / 2
	if !finite(mid) {
		return d, errors.New("invalid mid")
	}
	d.Bid = model.Ptr(bestBid)
	d.Ask = model.Ptr(bestAsk)
	d.Mid = model.Ptr(mid)
	bc := (mid - minBid) / mid * 10000
	ac := (maxAsk - mid) / mid * 10000
	d.ObservedBid = model.Ptr(bc)
	d.ObservedAsk = model.Ptr(ac)
	var bs, as [5]float64
	for i, side := range [][]Level{bids, asks} {
		for _, l := range side {
			if l.Qty == 0 {
				continue
			}
			dist := (mid - l.Price) / mid * 10000
			if i == 1 {
				dist = (l.Price - mid) / mid * 10000
			}
			for j := 0; j < 5; j++ {
				if dist >= bounds[j] && dist < bounds[j+1] {
					if i == 0 {
						bs[j] += l.Price * l.Qty
						if !finite(bs[j]) {
							return Depth{}, errors.New("notional overflow")
						}
					} else {
						as[j] += l.Price * l.Qty
						if !finite(as[j]) {
							return Depth{}, errors.New("notional overflow")
						}
					}
					break
				}
			}
		}
	}
	for j := 0; j < 5; j++ {
		if bc+1e-9 >= bounds[j+1] {
			d.Zones[j].Bid = model.Ptr(bs[j])
		}
		if ac+1e-9 >= bounds[j+1] {
			d.Zones[j].Ask = model.Ptr(as[j])
		}
	}
	return d, nil
}
func WithinWindow(t, captured int64) bool { return captured >= t-WindowMS && captured <= t+WindowMS }

// PreferExact only fills unknown sides; a known zero must never be replaced.
func PreferExact(exact, grouped [5]Pair) [5]Pair {
	for i := range exact {
		if exact[i].Bid == nil {
			exact[i].Bid = grouped[i].Bid
		}
		if exact[i].Ask == nil {
			exact[i].Ask = grouped[i].Ask
		}
	}
	return exact
}

// Bitfinex policy: fixed P1 near zone, fixed P2 deeper zones; no cross-fill.
func BitfinexZones(p1, p2 [5]Pair) [5]Pair { p2[0] = p1[0]; return p2 }

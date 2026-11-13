// Package futures implements USDⓈ-M public market data only. No trading or credentials.
package futures

import (
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strconv"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

const Interval10 int64 = 10000
const MaxWindowTrades = 30000

// Trade is one aggTrade, not one underlying execution. Receipt time is local
// admission time; price and quantity are USDT and base units respectively.
type Trade struct {
	Asset                        string
	ID, First, Last, T, Received int64
	Price, Qty                   float64
	BuyerMaker                   bool
}

func finitePositive(x float64) bool { return x > 0 && !math.IsNaN(x) && !math.IsInf(x, 0) }
func (x Trade) valid() bool {
	return model.AssetOK(x.Asset) && x.ID >= 0 && x.First >= 0 && x.Last >= x.First && x.T > 0 && x.Received >= x.T && finitePositive(x.Price) && finitePositive(x.Qty) && finitePositive(x.Price*x.Qty)
}
func (x Trade) same(y Trade) bool { x.Received = 0; y.Received = 0; return x == y }
func assetForSymbol(s string) (string, error) {
	switch s {
	case "BTCUSDT":
		return "BTC", nil
	case "ETHUSDT":
		return "ETH", nil
	case "SOLUSDT":
		return "SOL", nil
	}
	return "", errors.New("unexpected USD-M symbol")
}

type tradeWire struct {
	Event  string `json:"e"`
	Symbol string `json:"s"`
	ID     *int64 `json:"a"`
	First  *int64 `json:"f"`
	Last   *int64 `json:"l"`
	Time   *int64 `json:"T"`
	Price  string `json:"p"`
	Qty    string `json:"q"`
	Maker  *bool  `json:"m"`
}

func decodeTrade(w tradeWire, asset string, recv int64) (Trade, error) {
	if w.ID == nil || w.First == nil || w.Last == nil || w.Time == nil || w.Maker == nil {
		return Trade{}, errors.New("incomplete aggregate trade")
	}
	p, e := strconv.ParseFloat(w.Price, 64)
	if e != nil {
		return Trade{}, e
	}
	q, e := strconv.ParseFloat(w.Qty, 64)
	if e != nil {
		return Trade{}, e
	}
	x := Trade{asset, *w.ID, *w.First, *w.Last, *w.Time, recv, p, q, *w.Maker}
	if !x.valid() {
		return Trade{}, errors.New("invalid aggregate trade or clock skew")
	}
	return x, nil
}
func ParseWSAgg(raw []byte, recv int64) (Trade, error) {
	var w tradeWire
	if e := json.Unmarshal(raw, &w); e != nil {
		return Trade{}, e
	}
	if w.Event != "aggTrade" {
		return Trade{}, errors.New("not aggTrade")
	}
	a, e := assetForSymbol(w.Symbol)
	if e != nil {
		return Trade{}, e
	}
	return decodeTrade(w, a, recv)
}

// BuildBar aggregates only causally admitted trades in [t,t+10s). A conservative
// completeness heuristic requires contiguous agg IDs bracketing both boundaries,
// and nondecreasing trade time across that span. A gap means unconfirmed, not
// a proven missing execution. Actual trade IDs need not be contiguous (ADL etc).
// The post-end bracket proves coverage, never contributes to the bar's values.
// Caller must not set sourceHealthy if input is truncated or known corrupt.
func BuildBar(asset string, t, available int64, trades []Trade, sourceHealthy bool) (model.Futures10Row, error) {
	r := model.Futures10Row{Common: model.Common{T: t, Asset: asset, AvailableAt: model.Ptr(available), Source: model.Ptr(model.LiveSource), Status: "missing", Revision: 1}}
	if !model.AssetOK(asset) || t < 0 || t%Interval10 != 0 || available < t+Interval10 || len(trades) > MaxWindowTrades {
		return r, errors.New("invalid bar window or unbounded trades")
	}
	byID := make(map[int64]Trade, len(trades))
	for _, x := range trades {
		if x.Asset != asset || !x.valid() {
			return r, errors.New("invalid trade in asset window")
		}
		if x.Received > available {
			continue
		}
		if p, ok := byID[x.ID]; ok {
			if !p.same(x) {
				return r, errors.New("conflicting duplicate agg ID")
			}
			if p.Received <= x.Received {
				continue
			}
		}
		byID[x.ID] = x
	}
	ordered := make([]Trade, 0, len(byID))
	for _, x := range byID {
		ordered = append(ordered, x)
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].ID < ordered[j].ID })
	prev, next := -1, -1
	monotonic := true
	in := make([]Trade, 0)
	for i, x := range ordered {
		if i > 0 && x.T < ordered[i-1].T {
			monotonic = false
		}
		if x.T < t {
			prev = i
		}
		if x.T >= t+Interval10 && next < 0 {
			next = i
		}
		if x.T >= t && x.T < t+Interval10 {
			in = append(in, x)
		}
	}
	complete := sourceHealthy && monotonic && prev >= 0 && next > prev
	if complete {
		for i := prev + 1; i <= next; i++ {
			if ordered[i].ID-ordered[i-1].ID != 1 {
				complete = false
				break
			}
		}
	}
	reason := "bracket_contiguous"
	if !complete {
		reason = "coverage_unconfirmed"
	}
	if !sourceHealthy {
		reason = "source_unhealthy_or_truncated"
	}
	quality := map[string]any{"method": "aggtrade_10s", "coverage": reason, "complete": complete, "observed_agg_count": len(in)}
	if prev >= 0 {
		quality["before_agg_id"] = ordered[prev].ID
	}
	if next >= 0 {
		quality["after_agg_id"] = ordered[next].ID
	}
	if len(in) > 0 {
		sort.Slice(in, func(i, j int) bool {
			if in[i].T != in[j].T {
				return in[i].T < in[j].T
			}
			return in[i].ID < in[j].ID
		})
		o, h, l, c := in[0].Price, in[0].Price, in[0].Price, in[len(in)-1].Price
		bq, sq, bn, sn := 0.0, 0.0, 0.0, 0.0
		fa, la, ft, lt := in[0].ID, in[0].ID, in[0].First, in[0].Last
		for _, x := range in {
			h = math.Max(h, x.Price)
			l = math.Min(l, x.Price)
			if x.BuyerMaker {
				sq += x.Qty
				sn += x.Price * x.Qty
			} else {
				bq += x.Qty
				bn += x.Price * x.Qty
			}
			if x.ID < fa {
				fa = x.ID
			}
			if x.ID > la {
				la = x.ID
			}
			if x.First < ft {
				ft = x.First
			}
			if x.Last > lt {
				lt = x.Last
			}
		}
		r.OHLC = model.OHLC{Open: &o, High: &h, Low: &l, Close: &c}
		r.BuyQty = &bq
		r.SellQty = &sq
		r.BuyUSDT = &bn
		r.SellUSDT = &sn
		r.AggCount = model.Ptr(int64(len(in)))
		r.FirstAggID = &fa
		r.LastAggID = &la
		r.FirstTradeID = &ft
		r.LastTradeID = &lt
		r.Status = "partial"
		if complete {
			r.Status = "ok"
		}
	} else if complete {
		r.Status = "empty"
		r.BuyQty = model.Ptr(0.0)
		r.SellQty = model.Ptr(0.0)
		r.BuyUSDT = model.Ptr(0.0)
		r.SellUSDT = model.Ptr(0.0)
		r.AggCount = model.Ptr(int64(0))
	}
	b, e := json.Marshal(quality)
	if e != nil {
		return r, e
	}
	r.Quality = model.Ptr(string(b))
	return r, r.Validate()
}

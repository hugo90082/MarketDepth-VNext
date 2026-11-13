// Package model defines MD-VNEXT-1 rows. Nullable fields are pointers so zero is never missing.
package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"
)

const Contract = "MD-VNEXT-1"
const Timezone = "Asia/Taipei"
const LiveSource = "vm_vnext"

type Kind string

const (
	Spot Kind = "spot_depth"
	F10  Kind = "futures_10s"
	F1   Kind = "futures_1m"
)

func (k Kind) Valid() bool { return k == Spot || k == F10 || k == F1 }
func (k Kind) Interval() int64 {
	if k == F10 {
		return 10000
	}
	return 60000
}
func AssetOK(s string) bool { return s == "BTC" || s == "ETH" || s == "SOL" }
func VenueOK(s string) bool {
	return s == "binance" || s == "coinbase" || s == "kraken" || s == "bitfinex"
}
func Day(t int64) string {
	return time.UnixMilli(t).In(time.FixedZone("UTC+8", 8*3600)).Format("2006-01-02")
}
func Ptr[T any](v T) *T { return &v }

type Common struct {
	T           int64   `json:"t"`
	AvailableAt *int64  `json:"available_at"`
	Asset       string  `json:"asset"`
	Status      string  `json:"status"`
	Source      *string `json:"source"`
	Quality     *string `json:"quality_json"`
	Revision    int64   `json:"revision"`
}
type SpotRow struct {
	Common
	Venue       string   `json:"venue"`
	BidPrice    *float64 `json:"bid_price"`
	AskPrice    *float64 `json:"ask_price"`
	MidPrice    *float64 `json:"mid_price"`
	Bid0100     *float64 `json:"bid_0_100"`
	Ask0100     *float64 `json:"ask_0_100"`
	Bid100200   *float64 `json:"bid_100_200"`
	Ask100200   *float64 `json:"ask_100_200"`
	Bid200300   *float64 `json:"bid_200_300"`
	Ask200300   *float64 `json:"ask_200_300"`
	Bid300500   *float64 `json:"bid_300_500"`
	Ask300500   *float64 `json:"ask_300_500"`
	Bid500750   *float64 `json:"bid_500_750"`
	Ask500750   *float64 `json:"ask_500_750"`
	ObservedBid *float64 `json:"observed_bid_bps"`
	ObservedAsk *float64 `json:"observed_ask_bps"`
	TrustedBid  *float64 `json:"trusted_bid_bps"`
	TrustedAsk  *float64 `json:"trusted_ask_bps"`
	CapturedAt  *int64   `json:"captured_at"`
}
type OHLC struct {
	Open  *float64 `json:"open"`
	High  *float64 `json:"high"`
	Low   *float64 `json:"low"`
	Close *float64 `json:"close"`
}
type Futures10Row struct {
	Common
	OHLC
	BuyQty       *float64 `json:"buy_qty"`
	SellQty      *float64 `json:"sell_qty"`
	BuyUSDT      *float64 `json:"buy_usdt"`
	SellUSDT     *float64 `json:"sell_usdt"`
	AggCount     *int64   `json:"agg_count"`
	FirstAggID   *int64   `json:"first_agg_id"`
	LastAggID    *int64   `json:"last_agg_id"`
	FirstTradeID *int64   `json:"first_trade_id"`
	LastTradeID  *int64   `json:"last_trade_id"`
}
type Futures1Row struct {
	Common
	OHLC
	Volume       *float64 `json:"volume"`
	QuoteVolume  *float64 `json:"quote_volume"`
	TakerBuyQty  *float64 `json:"taker_buy_qty"`
	TakerBuyUSDT *float64 `json:"taker_buy_usdt"`
	TradeCount   *int64   `json:"trade_count"`
}
type Key struct {
	T     int64  `json:"t"`
	Venue string `json:"venue,omitempty"`
	Asset string `json:"asset"`
}

func (a Key) Less(b Key) bool {
	if a.T != b.T {
		return a.T < b.T
	}
	if a.Venue != b.Venue {
		return a.Venue < b.Venue
	}
	return a.Asset < b.Asset
}

type Row interface {
	Base() Common
	Key() Key
	Kind() Kind
	Validate() error
}

func (r SpotRow) Base() Common      { return r.Common }
func (r SpotRow) Key() Key          { return Key{r.T, r.Venue, r.Asset} }
func (r SpotRow) Kind() Kind        { return Spot }
func (r Futures10Row) Base() Common { return r.Common }
func (r Futures10Row) Key() Key     { return Key{r.T, "", r.Asset} }
func (r Futures10Row) Kind() Kind   { return F10 }
func (r Futures1Row) Base() Common  { return r.Common }
func (r Futures1Row) Key() Key      { return Key{r.T, "", r.Asset} }
func (r Futures1Row) Kind() Kind    { return F1 }
func common(c Common, k Kind) error {
	if c.T < 0 || c.T%k.Interval() != 0 || !AssetOK(c.Asset) || c.Revision < 1 {
		return errors.New("invalid time grid, asset or revision")
	}
	switch c.Status {
	case "ok", "partial", "missing", "late", "recovered", "legacy_unknown":
	case "empty":
		if k != F10 {
			return errors.New("empty only valid for futures_10s")
		}
	default:
		return errors.New("unknown status")
	}
	if c.Quality != nil && !json.Valid([]byte(*c.Quality)) {
		return errors.New("invalid quality_json")
	}
	if c.Source != nil && *c.Source == LiveSource {
		min := c.T
		if k != Spot {
			min += k.Interval()
		}
		if c.Status == "legacy_unknown" || c.AvailableAt == nil || *c.AvailableAt < min {
			return errors.New("live row has invalid availability")
		}
	}
	return nil
}
func nonneg(v ...*float64) error {
	for _, x := range v {
		if x != nil && (*x < 0 || math.IsNaN(*x) || math.IsInf(*x, 0)) {
			return errors.New("negative or nonfinite numeric value")
		}
	}
	return nil
}
func positive(v ...*float64) error {
	if e := nonneg(v...); e != nil {
		return e
	}
	for _, x := range v {
		if x != nil && *x == 0 {
			return errors.New("nonpositive price")
		}
	}
	return nil
}
func ints(v ...*int64) error {
	for _, x := range v {
		if x != nil && *x < 0 {
			return errors.New("negative integer")
		}
	}
	return nil
}
func all(v ...*float64) bool {
	for _, x := range v {
		if x == nil {
			return false
		}
	}
	return true
}
func none(v ...*float64) bool {
	for _, x := range v {
		if x != nil {
			return false
		}
	}
	return true
}
func (r SpotRow) Validate() error {
	if e := common(r.Common, Spot); e != nil {
		return e
	}
	if !VenueOK(r.Venue) {
		return errors.New("unknown venue")
	}
	if e := positive(r.BidPrice, r.AskPrice, r.MidPrice); e != nil {
		return e
	}
	if r.BidPrice != nil && r.AskPrice != nil && *r.BidPrice >= *r.AskPrice {
		return errors.New("crossed BBO")
	}
	if r.CapturedAt != nil && r.AvailableAt != nil && *r.CapturedAt > *r.AvailableAt {
		return errors.New("capture after availability")
	}
	return nonneg(r.Bid0100, r.Ask0100, r.Bid100200, r.Ask100200, r.Bid200300, r.Ask200300, r.Bid300500, r.Ask300500, r.Bid500750, r.Ask500750, r.ObservedBid, r.ObservedAsk, r.TrustedBid, r.TrustedAsk)
}
func (o OHLC) validate() error {
	if e := positive(o.Open, o.High, o.Low, o.Close); e != nil {
		return e
	}
	if o.High != nil && o.Low != nil && *o.High < *o.Low {
		return errors.New("high below low")
	}
	for _, p := range []*float64{o.Open, o.Close} {
		if p != nil && ((o.High != nil && *p > *o.High) || (o.Low != nil && *p < *o.Low)) {
			return errors.New("price outside high/low")
		}
	}
	return nil
}
func (r Futures10Row) Validate() error {
	if e := common(r.Common, F10); e != nil {
		return e
	}
	if e := r.OHLC.validate(); e != nil {
		return e
	}
	if e := nonneg(r.BuyQty, r.SellQty, r.BuyUSDT, r.SellUSDT); e != nil {
		return e
	}
	if e := ints(r.AggCount, r.FirstAggID, r.LastAggID, r.FirstTradeID, r.LastTradeID); e != nil {
		return e
	}
	for _, p := range [][2]*int64{{r.FirstAggID, r.LastAggID}, {r.FirstTradeID, r.LastTradeID}} {
		if p[0] != nil && p[1] != nil && *p[0] > *p[1] {
			return errors.New("reversed ID range")
		}
	}
	if r.Status == "empty" {
		if !none(r.Open, r.High, r.Low, r.Close) || !all(r.BuyQty, r.SellQty, r.BuyUSDT, r.SellUSDT) || *r.BuyQty != 0 || *r.SellQty != 0 || *r.BuyUSDT != 0 || *r.SellUSDT != 0 || r.AggCount == nil || *r.AggCount != 0 || r.FirstAggID != nil || r.LastAggID != nil || r.FirstTradeID != nil || r.LastTradeID != nil {
			return errors.New("invalid empty bar")
		}
	}
	if r.Source != nil && *r.Source == LiveSource && r.Status == "ok" {
		if !all(r.Open, r.High, r.Low, r.Close, r.BuyQty, r.SellQty, r.BuyUSDT, r.SellUSDT) || r.AggCount == nil || *r.AggCount <= 0 {
			return errors.New("incomplete ok bar")
		}
	}
	return nil
}
func (r Futures1Row) Validate() error {
	if e := common(r.Common, F1); e != nil {
		return e
	}
	if e := r.OHLC.validate(); e != nil {
		return e
	}
	if e := nonneg(r.Volume, r.QuoteVolume, r.TakerBuyQty, r.TakerBuyUSDT); e != nil {
		return e
	}
	if e := ints(r.TradeCount); e != nil {
		return e
	}
	if r.Volume != nil && r.TakerBuyQty != nil && *r.TakerBuyQty > *r.Volume {
		return errors.New("buy qty exceeds total")
	}
	if r.QuoteVolume != nil && r.TakerBuyUSDT != nil && *r.TakerBuyUSDT > *r.QuoteVolume {
		return errors.New("buy notional exceeds total")
	}
	if r.Source != nil && *r.Source == LiveSource && r.Status == "ok" && (!all(r.Open, r.High, r.Low, r.Close, r.Volume, r.QuoteVolume, r.TakerBuyQty, r.TakerBuyUSDT) || r.TradeCount == nil) {
		return errors.New("incomplete ok kline")
	}
	return nil
}
func Decode(k Kind, b []byte) (Row, error) {
	var r Row
	switch k {
	case Spot:
		r = &SpotRow{}
	case F10:
		r = &Futures10Row{}
	case F1:
		r = &Futures1Row{}
	default:
		return nil, fmt.Errorf("invalid kind %q", k)
	}
	if e := json.Unmarshal(b, r); e != nil {
		return nil, e
	}
	return r, r.Validate()
}

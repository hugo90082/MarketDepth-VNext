package futures

import (
	"encoding/json"
	"errors"
	"strconv"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/collector/binancewire"
)

var ErrOpenKline = errors.New("unclosed kline is not persisted")

type klineWire struct {
	Event  string `json:"e"`
	Symbol string `json:"s"`
	K      struct {
		Start    *int64 `json:"t"`
		End      *int64 `json:"T"`
		Symbol   string `json:"s"`
		Interval string `json:"i"`
		Closed   *bool  `json:"x"`
		Open     string `json:"o"`
		High     string `json:"h"`
		Low      string `json:"l"`
		Close    string `json:"c"`
		Volume   string `json:"v"`
		Quote    string `json:"q"`
		BuyQty   string `json:"V"`
		BuyQuote string `json:"Q"`
		Count    *int64 `json:"n"`
	} `json:"k"`
}

func makeKline(asset string, start, end, received, count int64, values []string, method string) (model.Futures1Row, error) {
	r := model.Futures1Row{Common: model.Common{T: start, AvailableAt: model.Ptr(received), Asset: asset, Status: "ok", Source: model.Ptr(model.LiveSource), Revision: 1}, TradeCount: model.Ptr(count)}
	if start < 0 || start%60000 != 0 || end != start+59999 || received <= end || len(values) != 8 {
		return r, errors.New("invalid closed minute or availability")
	}
	nums := make([]float64, 8)
	for i, s := range values {
		v, e := strconv.ParseFloat(s, 64)
		if e != nil {
			return r, e
		}
		nums[i] = v
	}
	r.OHLC = model.OHLC{Open: &nums[0], High: &nums[1], Low: &nums[2], Close: &nums[3]}
	r.Volume = &nums[4]
	r.QuoteVolume = &nums[5]
	r.TakerBuyQty = &nums[6]
	r.TakerBuyUSDT = &nums[7]
	q, _ := json.Marshal(map[string]any{"method": method, "closed": true, "close_time": end})
	r.Quality = model.Ptr(string(q))
	return r, r.Validate()
}
func ParseWSKline(raw []byte, recv int64) (model.Futures1Row, error) {
	r, _, _, e := ParseWSKlineWithPrice(raw, recv)
	return r, e
}

// ParseWSKlineWithPrice parses a 1m kline WS payload and always returns the
// latest asset and close price even while the 1m bar is still open.
func ParseWSKlineWithPrice(raw []byte, recv int64) (model.Futures1Row, string, float64, error) {
	var w klineWire
	var nested json.RawMessage
	if e := binancewire.Object(raw, map[string]any{"e": &w.Event, "s": &w.Symbol, "k": &nested}, nil); e != nil {
		return model.Futures1Row{}, "", 0, e
	}
	if e := binancewire.Object(nested, map[string]any{"t": &w.K.Start, "T": &w.K.End, "s": &w.K.Symbol, "i": &w.K.Interval, "x": &w.K.Closed, "n": &w.K.Count}, map[string]any{"o": &w.K.Open, "h": &w.K.High, "l": &w.K.Low, "c": &w.K.Close, "v": &w.K.Volume, "q": &w.K.Quote, "V": &w.K.BuyQty, "Q": &w.K.BuyQuote}); e != nil {
		return model.Futures1Row{}, "", 0, e
	}
	k := w.K
	if w.Event != "kline" || w.Symbol != k.Symbol || k.Interval != "1m" || k.Start == nil || k.End == nil || k.Closed == nil || k.Count == nil {
		return model.Futures1Row{}, "", 0, errors.New("wrong or incomplete 1m kline")
	}
	a, e := assetForSymbol(w.Symbol)
	if e != nil {
		return model.Futures1Row{}, "", 0, e
	}
	closePx, e := strconv.ParseFloat(k.Close, 64)
	if e != nil || closePx <= 0 {
		return model.Futures1Row{}, a, 0, errors.New("invalid kline close price")
	}
	if !*k.Closed {
		return model.Futures1Row{}, a, closePx, ErrOpenKline
	}
	r, e := makeKline(a, *k.Start, *k.End, recv, *k.Count, []string{k.Open, k.High, k.Low, k.Close, k.Volume, k.Quote, k.BuyQty, k.BuyQuote}, "official_ws_1m")
	return r, a, closePx, e
}

package spot

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// RESTSource fetches only the frozen public spot endpoints. It does not retry
// outside the sampling window or substitute a current snapshot for a missed one.
// CapturedAt is local receipt after JSON decode (legacy convention).
type RESTSource struct {
	client *http.Client
	now    func() time.Time
}
type CapturedBook struct {
	Depth      Depth
	CapturedAt int64
	Method     string
}

const maxSnapshotBytes int64 = 32 << 20

func NewRESTSource() *RESTSource {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.MaxIdleConns = 16
	tr.MaxIdleConnsPerHost = 4
	tr.MaxConnsPerHost = 4
	tr.ResponseHeaderTimeout = 3 * time.Second
	return &RESTSource{client: &http.Client{Transport: tr, Timeout: 4 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, now: time.Now}
}
func (s *RESTSource) get(ctx context.Context, endpoint string, out any) (int64, error) {
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if e != nil {
		return 0, e
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "marketdepth-vnext/1")
	res, e := s.client.Do(req)
	if e != nil {
		return 0, e
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("http_status=%d", res.StatusCode)
	}
	lr := &io.LimitedReader{R: res.Body, N: maxSnapshotBytes + 1}
	dec := json.NewDecoder(lr)
	if e = dec.Decode(out); e != nil {
		return 0, e
	}
	var trailing any
	if e = dec.Decode(&trailing); !errors.Is(e, io.EOF) {
		return 0, errors.New("unexpected trailing JSON")
	}
	if lr.N == 0 {
		return 0, errors.New("snapshot exceeds size limit")
	}
	return s.now().UnixMilli(), nil
}
func parseLevels(rows [][]json.RawMessage) ([]Level, error) {
	out := make([]Level, 0, len(rows))
	for _, r := range rows {
		if len(r) < 2 {
			return nil, errors.New("short level")
		}
		p, e := strconv.ParseFloat(strings.Trim(string(r[0]), `"`), 64)
		if e != nil {
			return nil, e
		}
		q, e := strconv.ParseFloat(strings.Trim(string(r[1]), `"`), 64)
		if e != nil {
			return nil, e
		}
		if !finite(p) || !finite(q) || p <= 0 || q <= 0 {
			return nil, errors.New("invalid snapshot level")
		}
		out = append(out, Level{p, q})
	}
	return out, nil
}

type rawBook struct {
	Bids [][]json.RawMessage `json:"bids"`
	Asks [][]json.RawMessage `json:"asks"`
}

func parseRawBook(raw rawBook) (Depth, error) {
	b, e := parseLevels(raw.Bids)
	if e != nil {
		return Depth{}, e
	}
	a, e := parseLevels(raw.Asks)
	if e != nil {
		return Depth{}, e
	}
	return Normalize(b, a)
}

// Exact handles only SOL REST5000 and Coinbase full L2; BTC/ETH Binance must
// use persistent sequence-checked WS local books, never this REST fallback.
func (s *RESTSource) Exact(ctx context.Context, venue, asset string) (CapturedBook, error) {
	symbol := Symbol(venue, asset)
	if symbol == "" {
		return CapturedBook{}, errors.New("unknown pair")
	}
	var endpoint string
	switch {
	case venue == "binance" && asset == "SOL":
		endpoint = "https://api.binance.com/api/v3/depth?symbol=" + url.QueryEscape(symbol) + "&limit=5000"
	case venue == "coinbase":
		endpoint = "https://api.exchange.coinbase.com/products/" + url.PathEscape(symbol) + "/book?level=2"
	default:
		return CapturedBook{}, errors.New("unsupported exact REST pair")
	}
	var raw rawBook
	t, e := s.get(ctx, endpoint, &raw)
	if e != nil {
		return CapturedBook{}, e
	}
	d, e := parseRawBook(raw)
	return CapturedBook{d, t, "exact_rest_snapshot"}, e
}

// Bitfinex requests fixed P1/P2 independently. The caller merges sides only
// after checking each capture time; it must retain per-source provenance.
func (s *RESTSource) Bitfinex(ctx context.Context, asset, precision string) (CapturedBook, error) {
	symbol := Symbol("bitfinex", asset)
	if symbol == "" || (precision != "P1" && precision != "P2") {
		return CapturedBook{}, errors.New("unsupported Bitfinex pair or precision")
	}
	endpoint := "https://api-pub.bitfinex.com/v2/book/" + url.PathEscape(symbol) + "/" + precision + "?len=250"
	var raw [][]float64
	t, e := s.get(ctx, endpoint, &raw)
	if e != nil {
		return CapturedBook{}, e
	}
	b, a := []Level{}, []Level{}
	for _, r := range raw {
		if len(r) != 3 || !finite(r[0]) || !finite(r[1]) || !finite(r[2]) || r[0] <= 0 || r[1] <= 0 || r[2] == 0 {
			return CapturedBook{}, errors.New("invalid Bitfinex level")
		}
		if r[2] > 0 {
			b = append(b, Level{r[0], r[2]})
		} else {
			a = append(a, Level{r[0], -r[2]})
		}
	}
	d, e := Normalize(b, a)
	return CapturedBook{d, t, "bitfinex_" + precision}, e
}
func krakenPairOK(asset, pair string) bool {
	switch asset {
	case "BTC":
		return pair == "XXBTZUSD" || pair == "XBTUSD" || pair == "BTCUSD" || pair == "BTC/USD"
	case "ETH":
		return pair == "XETHZUSD" || pair == "ETHUSD" || pair == "ETH/USD"
	case "SOL":
		return pair == "SOLUSD" || pair == "SOL/USD"
	}
	return false
}

// KrakenFallback is an exact REST500 fallback only; the coordinator decides
// whether the primary WS snapshot failed within the same target window.
func (s *RESTSource) KrakenFallback(ctx context.Context, asset string) (CapturedBook, error) {
	symbol := Symbol("kraken", asset)
	if symbol == "" {
		return CapturedBook{}, errors.New("unknown Kraken pair")
	}
	var raw struct {
		Error  []string           `json:"error"`
		Result map[string]rawBook `json:"result"`
	}
	t, e := s.get(ctx, "https://api.kraken.com/0/public/Depth?pair="+url.QueryEscape(symbol)+"&count=500", &raw)
	if e != nil {
		return CapturedBook{}, e
	}
	if len(raw.Error) != 0 || len(raw.Result) != 1 {
		return CapturedBook{}, errors.New("Kraken response error or unexpected pair count")
	}
	for pair, b := range raw.Result {
		if !krakenPairOK(asset, pair) {
			return CapturedBook{}, errors.New("unexpected Kraken pair")
		}
		d, e := parseRawBook(b)
		return CapturedBook{d, t, "kraken_rest500"}, e
	}
	return CapturedBook{}, errors.New("empty Kraken response")
}

// KrakenGrouped preserves the legacy BTC/ETH grouped endpoint. The approximate
// grouped levels must never be promoted to exact/trusted coverage.
func (s *RESTSource) KrakenGrouped(ctx context.Context, asset string) (CapturedBook, error) {
	if asset != "BTC" && asset != "ETH" {
		return CapturedBook{}, errors.New("grouped only BTC/ETH")
	}
	symbol := Symbol("kraken", asset)
	type level struct {
		Price string `json:"price"`
		Qty   string `json:"qty"`
	}
	var raw struct {
		Error  []string `json:"error"`
		Result struct {
			Pair     string  `json:"pair"`
			Grouping int     `json:"grouping"`
			Bids     []level `json:"bids"`
			Asks     []level `json:"asks"`
		} `json:"result"`
	}
	t, e := s.get(ctx, "https://api.kraken.com/0/public/GroupedBook?pair="+url.QueryEscape(symbol)+"&depth=1000&grouping=1000", &raw)
	if e != nil {
		return CapturedBook{}, e
	}
	if len(raw.Error) != 0 || !krakenPairOK(asset, raw.Result.Pair) || raw.Result.Grouping != 1000 {
		return CapturedBook{}, errors.New("Kraken grouped response mismatch")
	}
	convert := func(rows []level) ([]Level, error) {
		out := make([]Level, 0, len(rows))
		for _, r := range rows {
			p, e := strconv.ParseFloat(r.Price, 64)
			if e != nil {
				return nil, e
			}
			q, e := strconv.ParseFloat(r.Qty, 64)
			if e != nil {
				return nil, e
			}
			if !finite(p) || !finite(q) || p <= 0 || q <= 0 {
				return nil, errors.New("invalid grouped level")
			}
			out = append(out, Level{p, q})
		}
		return out, nil
	}
	b, e := convert(raw.Result.Bids)
	if e != nil {
		return CapturedBook{}, e
	}
	a, e := convert(raw.Result.Asks)
	if e != nil {
		return CapturedBook{}, e
	}
	d, e := Normalize(b, a)
	return CapturedBook{d, t, "kraken_grouped1000"}, e
}

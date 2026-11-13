package futures

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
	"sync"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

const restBase = "https://fapi.binance.com"
const maxRepairPages = 6

// RESTClient is used only for bounded recovery, never as a substitute for live
// aggTrade. The local request-weight budget is deliberately conservative and
// must be coordinated with other clients on the VM before deployment.
type RESTClient struct {
	client       *http.Client
	base         string
	now          func() time.Time
	mu           sync.Mutex
	minute       int64
	used         int
	blockedUntil int64
}

func NewRESTClient() *RESTClient {
	return &RESTClient{client: &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, base: restBase, now: time.Now}
}
func (c *RESTClient) admit(weight int) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now().UnixMilli()
	if now < c.blockedUntil {
		return errors.New("REST recovery cooldown")
	}
	m := now / 60000
	if m != c.minute {
		c.minute = m
		c.used = 0
	}
	if c.used+weight > 240 {
		return errors.New("local futures REST weight budget exhausted")
	}
	c.used += weight
	return nil
}
func (c *RESTClient) get(ctx context.Context, path string, q url.Values, weight int, out any) error {
	if e := c.admit(weight); e != nil {
		return e
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path+"?"+q.Encode(), nil)
	if e != nil {
		return e
	}
	res, e := c.client.Do(req)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		if res.StatusCode == 429 || res.StatusCode == 418 {
			c.mu.Lock()
			delay := int64(60000)
			if n, e := strconv.ParseInt(res.Header.Get("Retry-After"), 10, 64); e == nil && n > 0 && n <= 86400 && n*1000 > delay {
				delay = n * 1000
			}
			c.blockedUntil = c.now().UnixMilli() + delay
			c.mu.Unlock()
		}
		return fmt.Errorf("futures REST HTTP %d", res.StatusCode)
	}
	// Shared IP budget can be lower than the local budget. Avoid further calls
	// when the provider reports high weight (the actual account limit is verified at deployment).
	if n, e := strconv.Atoi(res.Header.Get("X-MBX-USED-WEIGHT-1M")); e == nil && n >= 1800 {
		c.mu.Lock()
		c.blockedUntil = c.now().UnixMilli() + 60000
		c.mu.Unlock()
	}
	const maxBytes = 4 << 20
	b, e := io.ReadAll(io.LimitReader(res.Body, maxBytes+1))
	if e != nil {
		return e
	}
	if len(b) > maxBytes {
		return errors.New("futures REST body limit")
	}
	if e = json.Unmarshal(b, out); e != nil {
		return e
	}
	return nil
}
func (c *RESTClient) serverTime(ctx context.Context) (int64, error) {
	var r struct {
		Time int64 `json:"serverTime"`
	}
	e := c.get(ctx, "/fapi/v1/time", url.Values{}, 1, &r)
	if e != nil {
		return 0, e
	}
	if r.Time <= 0 {
		return 0, errors.New("missing server time")
	}
	return r.Time, nil
}
func recoveryQuality(method string, at int64, extra map[string]any) *string {
	if extra == nil {
		extra = map[string]any{}
	}
	extra["repair_method"] = method
	extra["repair_complete"] = true
	extra["retrieved_at"] = at
	b, _ := json.Marshal(extra)
	return model.Ptr(string(b))
}

// Recover1m fetches exactly the target official closed kline. oldRevision=0
// means a previously absent row; otherwise the caller supplies the current
// missing/partial revision and the journal enforces the compare-and-set.
func (c *RESTClient) Recover1m(ctx context.Context, asset string, t, oldRevision int64) (model.Futures1Row, error) {
	var zero model.Futures1Row
	if !model.AssetOK(asset) || t < 0 || t%60000 != 0 || oldRevision < 0 || oldRevision == 1<<63-1 {
		return zero, errors.New("invalid recovery target")
	}
	st, e := c.serverTime(ctx)
	if e != nil {
		return zero, e
	}
	if st < t+60000 {
		return zero, ErrOpenKline
	}
	var rows [][]json.RawMessage
	q := url.Values{"symbol": {asset + "USDT"}, "interval": {"1m"}, "startTime": {strconv.FormatInt(t, 10)}, "endTime": {strconv.FormatInt(t+59999, 10)}, "limit": {"1"}}
	if e = c.get(ctx, "/fapi/v1/klines", q, 1, &rows); e != nil {
		return zero, e
	}
	if len(rows) != 1 || len(rows[0]) != 12 {
		return zero, errors.New("expected exactly one official kline")
	}
	x := rows[0]
	var start, end, count int64
	for _, p := range []struct {
		i    int
		dest *int64
	}{{0, &start}, {6, &end}, {8, &count}} {
		if e = json.Unmarshal(x[p.i], p.dest); e != nil {
			return zero, e
		}
		if string(x[p.i]) == "null" {
			return zero, errors.New("null kline integer")
		}
	}
	if start != t {
		return zero, errors.New("wrong kline start")
	}
	values := make([]string, 0, 8)
	for _, i := range []int{1, 2, 3, 4, 5, 7, 9, 10} {
		var v string
		if e = json.Unmarshal(x[i], &v); e != nil {
			return zero, e
		}
		values = append(values, v)
	}
	at := c.now().UnixMilli()
	r, e := makeKline(asset, start, end, at, count, values, "official_rest_1m")
	if e != nil {
		return zero, e
	}
	r.Status = "recovered"
	r.Revision = oldRevision + 1
	r.Quality = recoveryQuality("official_rest_1m", at, map[string]any{"server_time": st, "close_time": end})
	return r, r.Validate()
}
func (c *RESTClient) tradePage(ctx context.Context, asset string, q url.Values) ([]Trade, error) {
	q.Set("symbol", asset+"USDT")
	q.Set("limit", "1000")
	var raw []tradeWire
	if e := c.get(ctx, "/fapi/v1/aggTrades", q, 20, &raw); e != nil {
		return nil, e
	}
	if len(raw) == 0 || len(raw) > 1000 {
		return nil, errors.New("empty or oversized aggTrade page; coverage unconfirmed")
	}
	at := c.now().UnixMilli()
	out := make([]Trade, 0, len(raw))
	for _, r := range raw {
		x, e := decodeTrade(r, asset, at)
		if e != nil {
			return nil, e
		}
		if r.Symbol != "" && r.Symbol != asset+"USDT" {
			return nil, errors.New("wrong trade symbol")
		}
		out = append(out, x)
	}
	for i := 1; i < len(out); i++ {
		if out[i].ID <= out[i-1].ID {
			return nil, errors.New("nonascending aggregate REST IDs")
		}
	}
	return out, nil
}

// Recover10 uses a known preceding trade ID (from diagnostics or a bounded
// time query) then pages by inclusive fromId. No startTime/fromId combination.
// It only returns a recovered row when the same conservative coverage proof
// succeeds; the caller must keep missing/partial on any error.
func (c *RESTClient) Recover10(ctx context.Context, asset string, t, oldRevision int64, precedingID *int64) (model.Futures10Row, error) {
	var zero model.Futures10Row
	if !model.AssetOK(asset) || t < 10000 || t%10000 != 0 || oldRevision < 0 || oldRevision == 1<<63-1 {
		return zero, errors.New("invalid recovery target")
	}
	st, e := c.serverTime(ctx)
	if e != nil {
		return zero, e
	}
	if st < t+10000 || st-t > 86400000 {
		return zero, errors.New("outside closed 24h recovery range")
	}
	var xs []Trade
	var from int64
	pages := 0
	if precedingID != nil {
		if *precedingID < 0 {
			return zero, errors.New("invalid predecessor ID")
		}
		from = *precedingID
	} else {
		p, e := c.tradePage(ctx, asset, url.Values{"startTime": {strconv.FormatInt(t-10000, 10)}, "endTime": {strconv.FormatInt(t-1, 10)}})
		if e != nil {
			return zero, e
		}
		pages++
		last := p[len(p)-1]
		if last.T >= t {
			return zero, errors.New("time query outside predecessor range")
		}
		xs = append(xs, last)
		if last.ID == 1<<63-1 {
			return zero, errors.New("aggregate ID overflow")
		}
		from = last.ID + 1
	}
	for ; pages < maxRepairPages; pages++ {
		p, e := c.tradePage(ctx, asset, url.Values{"fromId": {strconv.FormatInt(from, 10)}})
		if e != nil {
			return zero, e
		}
		if p[0].ID != from {
			return zero, errors.New("REST page missing requested aggregate ID")
		}
		xs = append(xs, p...)
		last := p[len(p)-1]
		if last.T >= t+10000 {
			break
		}
		if last.ID == 1<<63-1 {
			return zero, errors.New("aggregate ID overflow")
		}
		from = last.ID + 1
	}
	at := c.now().UnixMilli()
	r, e := BuildBar(asset, t, at, xs, true)
	if e != nil {
		return zero, e
	}
	if r.Status != "ok" && r.Status != "empty" {
		return zero, errors.New("REST aggregation incomplete; no correction")
	}
	r.Status = "recovered"
	r.Revision = oldRevision + 1
	var meta map[string]any
	// Re-decode with UseNumber to preserve int64 in diagnostics.
	dec := json.NewDecoder(strings.NewReader(*r.Quality))
	dec.UseNumber()
	if e = dec.Decode(&meta); e != nil {
		return zero, e
	}
	r.Quality = recoveryQuality("official_rest_aggtrade", at, meta)
	return r, r.Validate()
}

//go:build linux && live_ws && sqlite_integration && secure_auth

package main

import (
	"bufio"
	"compress/gzip"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/runtimeapp"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
	"golang.org/x/crypto/bcrypt"
)

var seedVenues = []string{"binance", "coinbase", "kraken", "bitfinex"}
var seedAssets = []string{"BTC", "ETH", "SOL"}

type seedDepthRecord struct {
	Type     string                `json:"type"`
	T        int64                 `json:"t"`
	A        *int64                `json:"a"`
	D        [][][][]*float64      `json:"d"`
	Source   string                `json:"source"`
	Captured [][]*bool             `json:"captured"`
	Issues   []string              `json:"issues"`
	Quality  *seedDepthQualityMeta `json:"quality"`
}

type seedDepthQualityMeta struct {
	Version string              `json:"version"`
	Books   [][]json.RawMessage `json:"books"`
}

type seedBookMeta struct {
	BidBps         *float64 `json:"bidBps"`
	AskBps         *float64 `json:"askBps"`
	ObservedBidBps *float64 `json:"observedBidBps"`
	ObservedAskBps *float64 `json:"observedAskBps"`
	CapturedAt     *int64   `json:"capturedAt"`
}

type seedCandleRecord struct {
	Type       string   `json:"type"`
	Asset      string   `json:"asset"`
	Interval   int64    `json:"interval"`
	T          int64    `json:"t"`
	O          *float64 `json:"o"`
	H          *float64 `json:"h"`
	L          *float64 `json:"l"`
	C          *float64 `json:"c"`
	V          *float64 `json:"v"`
	Closed     *bool    `json:"closed"`
	Complete   *bool    `json:"complete"`
	ObservedAt *int64   `json:"observedAt"`
	Source     *string  `json:"source"`
}

func clampAvailSpot(t int64, a *int64, capAt *int64) (*int64, *int64) {
	avail := t + 1000
	if a != nil && *a >= t && *a <= t+60000 {
		avail = *a
	}
	var c *int64
	if capAt != nil && *capAt >= 0 {
		cv := *capAt
		if cv > avail {
			if cv <= t+60000 {
				avail = cv
			} else {
				cv = avail
			}
		}
		c = &cv
	}
	return &avail, c
}

func mapDepthRecordToSpotRows(d seedDepthRecord, origin string) ([]model.Row, error) {
	if d.T <= 0 || d.T%60000 != 0 || len(d.D) != 4 {
		return nil, nil
	}
	out := make([]model.Row, 0, 12)
	for vi, venue := range seedVenues {
		if len(d.D[vi]) != 3 {
			return nil, errors.New("invalid depth asset dimension")
		}
		for ai, asset := range seedAssets {
			z := d.D[vi][ai]
			if len(z) != 5 {
				return nil, errors.New("invalid depth zone dimension")
			}
			for _, pair := range z {
				if len(pair) != 2 {
					return nil, errors.New("invalid depth pair dimension")
				}
			}
			var bookRaw json.RawMessage = json.RawMessage("null")
			var bm seedBookMeta
			if d.Quality != nil && vi < len(d.Quality.Books) && ai < len(d.Quality.Books[vi]) {
				bookRaw = d.Quality.Books[vi][ai]
				_ = json.Unmarshal(bookRaw, &bm)
			}
			avail, capAt := clampAvailSpot(d.T, d.A, bm.CapturedAt)
			zones := []*float64{z[0][0], z[0][1], z[1][0], z[1][1], z[2][0], z[2][1], z[3][0], z[3][1], z[4][0], z[4][1]}
			nonNil := 0
			for _, v := range zones {
				if v != nil {
					nonNil++
				}
			}
			status := "partial"
			if nonNil == 10 {
				status = "ok"
			} else if nonNil == 0 {
				status = "missing"
			}
			qb, _ := json.Marshal(map[string]any{
				"legacy_origin": origin,
				"legacy_source": d.Source,
				"legacy_book":   bookRaw,
			})
			qs := string(qb)
			var obsBid, obsAsk, trBid, trAsk *float64
			if bm.ObservedBidBps != nil && *bm.ObservedBidBps >= 0 {
				obsBid = bm.ObservedBidBps
			} else if bm.BidBps != nil && *bm.BidBps >= 0 {
				obsBid = bm.BidBps
			}
			if bm.ObservedAskBps != nil && *bm.ObservedAskBps >= 0 {
				obsAsk = bm.ObservedAskBps
			} else if bm.AskBps != nil && *bm.AskBps >= 0 {
				obsAsk = bm.AskBps
			}
			if bm.BidBps != nil && *bm.BidBps >= 0 {
				trBid = bm.BidBps
			}
			if bm.AskBps != nil && *bm.AskBps >= 0 {
				trAsk = bm.AskBps
			}
			r := model.SpotRow{
				Common: model.Common{
					T:           d.T,
					AvailableAt: avail,
					Asset:       asset,
					Status:      status,
					Source:      model.Ptr(model.LiveSource),
					Quality:     &qs,
					Revision:    1,
				},
				Venue:       venue,
				Bid0100:     z[0][0],
				Ask0100:     z[0][1],
				Bid100200:   z[1][0],
				Ask100200:   z[1][1],
				Bid200300:   z[2][0],
				Ask200300:   z[2][1],
				Bid300500:   z[3][0],
				Ask300500:   z[3][1],
				Bid500750:   z[4][0],
				Ask500750:   z[4][1],
				ObservedBid: obsBid,
				ObservedAsk: obsAsk,
				TrustedBid:  trBid,
				TrustedAsk:  trAsk,
				CapturedAt:  capAt,
			}
			if e := r.Validate(); e != nil {
				return nil, e
			}
			out = append(out, r)
		}
	}
	return out, nil
}

func loadVNextSQLiteRows(ctx context.Context, path string, byDay map[string][]model.Row) error {
	openPath := path
	if strings.HasSuffix(path, ".gz") {
		f, e := os.Open(path)
		if e != nil {
			return e
		}
		defer f.Close()
		gz, e := gzip.NewReader(f)
		if e != nil {
			return e
		}
		defer gz.Close()
		tmp, e := os.CreateTemp("", "seed-vnext-*.sqlite")
		if e != nil {
			return e
		}
		openPath = tmp.Name()
		defer os.Remove(openPath)
		if _, e = io.Copy(tmp, gz); e != nil {
			tmp.Close()
			return e
		}
		tmp.Close()
	}
	db, e := store.SQLiteOpener(openPath, true)
	if e != nil {
		return e
	}
	defer db.Close()
	for _, k := range []model.Kind{model.Spot, model.F10, model.F1} {
		var cols []string
		switch k {
		case model.Spot:
			cols = strings.Fields("t available_at venue asset bid_price ask_price mid_price bid_0_100 ask_0_100 bid_100_200 ask_100_200 bid_200_300 ask_200_300 bid_300_500 ask_300_500 bid_500_750 ask_500_750 observed_bid_bps observed_ask_bps trusted_bid_bps trusted_ask_bps captured_at status source quality_json revision")
		case model.F10:
			cols = strings.Fields("t available_at asset open high low close buy_qty sell_qty buy_usdt sell_usdt agg_count first_agg_id last_agg_id first_trade_id last_trade_id status source quality_json revision")
		case model.F1:
			cols = strings.Fields("t available_at asset open high low close volume quote_volume taker_buy_qty taker_buy_usdt trade_count status source quality_json revision")
		}
		rs, e := db.QueryContext(ctx, "SELECT "+strings.Join(cols, ",")+" FROM "+string(k))
		if e != nil {
			if errors.Is(e, sql.ErrNoRows) {
				continue
			}
			return e
		}
		for rs.Next() {
			raw := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range raw {
				ptrs[i] = &raw[i]
			}
			if e := rs.Scan(ptrs...); e != nil {
				rs.Close()
				return e
			}
			m := map[string]any{}
			for i, c := range cols {
				v := raw[i]
				if b, ok := v.([]byte); ok {
					v = string(b)
				}
				m[c] = v
			}
			m["revision"] = int64(1)
			m["source"] = model.LiveSource
			b, e := json.Marshal(m)
			if e != nil {
				rs.Close()
				return e
			}
			row, e := model.Decode(k, b)
			if e != nil {
				continue
			}
			day := model.Day(row.Key().T)
			byDay[day] = append(byDay[day], row)
		}
		rs.Close()
	}
	return nil
}

func loadBinanceF1mDays(ctx context.Context, daysCSV string, byDay map[string][]model.Row) error {
	loc := time.FixedZone("UTC+8", 8*3600)
	client := &http.Client{Timeout: 20 * time.Second}
	nowCutoff := time.Now().Truncate(time.Minute).UnixMilli()
	for _, day := range strings.Split(daysCSV, ",") {
		day = strings.TrimSpace(day)
		if day == "" {
			continue
		}
		a, e := time.ParseInLocation("2006-01-02", day, loc)
		if e != nil {
			return e
		}
		from := a.UnixMilli()
		to := a.Add(24 * time.Hour).UnixMilli()
		if to > nowCutoff {
			to = nowCutoff
		}
		if to <= from {
			continue
		}
		for _, asset := range seedAssets {
			u := fmt.Sprintf("https://fapi.binance.com/fapi/v1/klines?symbol=%sUSDT&interval=1m&startTime=%d&endTime=%d&limit=1500", asset, from, to-1)
			req, e := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
			if e != nil {
				return e
			}
			resp, e := client.Do(req)
			if e != nil {
				return e
			}
			var raw [][]json.RawMessage
			decErr := json.NewDecoder(resp.Body).Decode(&raw)
			resp.Body.Close()
			if resp.StatusCode != 200 || decErr != nil {
				return fmt.Errorf("binance fapi klines %s %s: status=%d err=%v", day, asset, resp.StatusCode, decErr)
			}
			for _, item := range raw {
				if len(item) < 11 {
					continue
				}
				var openTime int64
				if e := json.Unmarshal(item[0], &openTime); e != nil || openTime < from || openTime >= to || openTime%60000 != 0 {
					continue
				}
				parseF := func(raw json.RawMessage) (*float64, error) {
					var s string
					if e := json.Unmarshal(raw, &s); e != nil {
						return nil, e
					}
					v, e := strconv.ParseFloat(s, 64)
					if e != nil {
						return nil, e
					}
					return &v, nil
				}
				o, e1 := parseF(item[1])
				h, e2 := parseF(item[2])
				l, e3 := parseF(item[3])
				c, e4 := parseF(item[4])
				vol, e5 := parseF(item[5])
				qvol, e6 := parseF(item[7])
				tbq, e7 := parseF(item[9])
				tbu, e8 := parseF(item[10])
				var trades int64
				e9 := json.Unmarshal(item[8], &trades)
				if errors.Join(e1, e2, e3, e4, e5, e6, e7, e8, e9) != nil {
					continue
				}
				// Ensure rounding doesn't violate TakerBuy <= Total
				if *tbq > *vol {
					*tbq = *vol
				}
				if *tbu > *qvol {
					*tbu = *qvol
				}
				qs := `{"origin":"binance_fapi_klines_1m"}`
				row := model.Futures1Row{
					Common: model.Common{
						T:           openTime,
						AvailableAt: model.Ptr(openTime + 60000),
						Asset:       asset,
						Status:      "ok",
						Source:      model.Ptr(model.LiveSource),
						Quality:     &qs,
						Revision:    1,
					},
					OHLC:         model.OHLC{Open: o, High: h, Low: l, Close: c},
					Volume:       vol,
					QuoteVolume:  qvol,
					TakerBuyQty:  tbq,
					TakerBuyUSDT: tbu,
					TradeCount:   &trades,
				}
				if e := row.Validate(); e == nil {
					byDay[day] = append(byDay[day], row)
				}
			}
		}
	}
	return nil
}

func loadV66JSONL(path string, byDay map[string][]model.Row) error {
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	gz, e := gzip.NewReader(f)
	if e != nil {
		return e
	}
	defer gz.Close()
	r := bufio.NewReaderSize(gz, 256<<10)
	for {
		raw, e := r.ReadBytes('\n')
		if e == io.EOF && len(raw) == 0 {
			break
		}
		if e != nil && e != io.EOF {
			return e
		}
		var typ struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(raw, &typ) != nil {
			continue
		}
		switch typ.Type {
		case "depth":
			var d seedDepthRecord
			if json.Unmarshal(raw, &d) != nil {
				continue
			}
			rows, e := mapDepthRecordToSpotRows(d, "v66-browser-jsonl-v1")
			if e != nil || len(rows) == 0 {
				continue
			}
			day := model.Day(d.T)
			byDay[day] = append(byDay[day], rows...)
		case "candle":
			var c seedCandleRecord
			if json.Unmarshal(raw, &c) != nil || c.Interval != 60000 || c.T <= 0 || c.T%60000 != 0 {
				continue
			}
			qb, _ := json.Marshal(map[string]any{
				"legacy_origin": "v66-browser-jsonl-v1",
				"legacy_source": c.Source,
			})
			qs := string(qb)
			row := model.Futures1Row{
				Common: model.Common{
					T:           c.T,
					AvailableAt: model.Ptr(c.T + 60000),
					Asset:       c.Asset,
					Status:      "recovered",
					Source:      model.Ptr(model.LiveSource),
					Quality:     &qs,
					Revision:    1,
				},
				OHLC:   model.OHLC{Open: c.O, High: c.H, Low: c.L, Close: c.C},
				Volume: c.V,
			}
			if row.Validate() == nil {
				day := model.Day(c.T)
				byDay[day] = append(byDay[day], row)
			}
		}
	}
	return nil
}

func loadLegacySpotDir(dir string, byDay map[string][]model.Row) error {
	var files []string
	for _, sub := range []string{"chunks/spot", "recovery"} {
		p := filepath.Join(dir, sub)
		entries, e := os.ReadDir(p)
		if e != nil {
			continue
		}
		for _, ent := range entries {
			if !ent.IsDir() && strings.HasSuffix(ent.Name(), ".jsonl.gz") {
				files = append(files, filepath.Join(p, ent.Name()))
			}
		}
	}
	sort.Strings(files)
	for _, file := range files {
		f, e := os.Open(file)
		if e != nil {
			continue
		}
		gz, e := gzip.NewReader(f)
		if e != nil {
			f.Close()
			continue
		}
		r := bufio.NewReaderSize(gz, 256<<10)
		for {
			raw, e := r.ReadBytes('\n')
			if len(raw) > 0 {
				var d seedDepthRecord
				if json.Unmarshal(raw, &d) == nil && d.T > 0 && d.T%60000 == 0 && len(d.D) == 4 {
					if rows, err := mapDepthRecordToSpotRows(d, "sydney-legacy-collector"); err == nil && len(rows) > 0 {
						day := model.Day(d.T)
						byDay[day] = append(byDay[day], rows...)
					}
				}
			}
			if e != nil {
				break
			}
		}
		gz.Close()
		f.Close()
	}
	return nil
}

func writeVNextEnvFromLegacy(legacyEnvPath, outEnvPath string) error {
	b, e := os.ReadFile(legacyEnvPath)
	if e != nil {
		return e
	}
	var password string
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "ADMIN_PASSWORD=") {
			password = strings.TrimPrefix(line, "ADMIN_PASSWORD=")
			password = strings.Trim(password, "\"'")
			break
		}
	}
	if len(password) < 8 {
		return errors.New("ADMIN_PASSWORD not found or too short in legacy env")
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(password), 12)
	if e != nil {
		return e
	}
	key := make([]byte, 32)
	if _, e = rand.Read(key); e != nil {
		return e
	}
	keyB64 := base64.StdEncoding.EncodeToString(key)
	if e = os.MkdirAll(filepath.Dir(outEnvPath), 0700); e != nil {
		return e
	}
	content := fmt.Sprintf("MD_PASSWORD_BCRYPT=%s\nMD_SESSION_KEY_B64=%s\n", string(hash), keyB64)
	return os.WriteFile(outEnvPath, []byte(content), 0600)
}

func seedProduction(ctx context.Context, root string, initRoot bool, vnextSQLiteCSV, v66JSONL, legacySpotDir, binanceF1mDays, legacyEnv, vnextEnvOut string) error {
	if legacyEnv != "" && vnextEnvOut != "" {
		log.Printf("seed: generating VNext auth env at %s from %s", vnextEnvOut, legacyEnv)
		if e := writeVNextEnvFromLegacy(legacyEnv, vnextEnvOut); e != nil {
			return fmt.Errorf("write vnext env: %w", e)
		}
	}
	if root == "" {
		return nil
	}
	byDay := map[string][]model.Row{}
	if vnextSQLiteCSV != "" {
		for _, p := range strings.Split(vnextSQLiteCSV, ",") {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			log.Printf("seed: loading VNext SQLite %s", p)
			if e := loadVNextSQLiteRows(ctx, p, byDay); e != nil {
				return fmt.Errorf("load vnext sqlite %s: %w", p, e)
			}
		}
	}
	if binanceF1mDays != "" {
		log.Printf("seed: fetching Binance Futures 1m klines for %s", binanceF1mDays)
		if e := loadBinanceF1mDays(ctx, binanceF1mDays, byDay); e != nil {
			return fmt.Errorf("load binance f1m: %w", e)
		}
	}
	if legacySpotDir != "" {
		log.Printf("seed: loading Sydney legacy collector spot chunks from %s", legacySpotDir)
		if e := loadLegacySpotDir(legacySpotDir, byDay); e != nil {
			return fmt.Errorf("load legacy spot dir: %w", e)
		}
	}
	if v66JSONL != "" {
		log.Printf("seed: loading V66 local history export %s", v66JSONL)
		if e := loadV66JSONL(v66JSONL, byDay); e != nil {
			return fmt.Errorf("load v66 jsonl: %w", e)
		}
	}
	days := make([]string, 0, len(byDay))
	for d := range byDay {
		days = append(days, d)
	}
	sort.Strings(days)
	m, j, e := runtimeapp.OpenProductionSeed(ctx, root, initRoot)
	if e != nil {
		return e
	}
	defer m.Close()
	defer j.Close()
	totalInserted := 0
	for _, day := range days {
		n, e := j.SeedDay(ctx, day, byDay[day])
		if e != nil {
			return fmt.Errorf("seed day %s: %w", day, e)
		}
		totalInserted += n
		log.Printf("seed: day=%s candidates=%d inserted=%d", day, len(byDay[day]), n)
	}
	log.Printf("seed completed: days=%d total_inserted=%d", len(days), totalInserted)
	return nil
}

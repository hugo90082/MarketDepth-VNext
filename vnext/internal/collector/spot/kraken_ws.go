//go:build live_ws

package spot

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gorilla/websocket"
	"time"
)

// KrakenWS snapshots all three pairs on one short-lived connection; return
// partial successes on connection failure. No unvalidated update is used as a
// fresh snapshot. The parent provides the original T+1.5s deadline.
func KrakenWS(ctx context.Context) (map[string]CapturedBook, error) {
	out := map[string]CapturedBook{}
	cn, resp, e := websocket.DefaultDialer.DialContext(ctx, "wss://ws.kraken.com/v2", nil)
	if e != nil {
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
		}
		return out, e
	}
	defer cn.Close()
	stop := context.AfterFunc(ctx, func() { cn.Close() })
	defer stop()
	cn.SetReadLimit(8 << 20)
	if dl, ok := ctx.Deadline(); ok {
		_ = cn.SetReadDeadline(dl)
		_ = cn.SetWriteDeadline(dl)
	} else {
		_ = cn.SetReadDeadline(time.Now().Add(4 * time.Second))
	}
	if e = cn.WriteJSON(map[string]any{"method": "subscribe", "params": map[string]any{"channel": "book", "symbol": []string{"BTC/USD", "ETH/USD", "SOL/USD"}, "depth": 1000, "snapshot": true}}); e != nil {
		return out, e
	}
	type level struct {
		Price float64 `json:"price"`
		Qty   float64 `json:"qty"`
	}
	for len(out) < 3 {
		_, b, e := cn.ReadMessage()
		if e != nil {
			return out, e
		}
		var m struct {
			Channel string `json:"channel"`
			Type    string `json:"type"`
			Method  string `json:"method"`
			Success *bool  `json:"success"`
			Data    []struct {
				Symbol string  `json:"symbol"`
				Bids   []level `json:"bids"`
				Asks   []level `json:"asks"`
			} `json:"data"`
		}
		if e = json.Unmarshal(b, &m); e != nil {
			return out, e
		}
		recv := time.Now().UnixMilli()
		if m.Success != nil && !*m.Success {
			return out, errors.New("Kraken subscribe rejected")
		}
		if m.Channel != "book" || m.Type != "snapshot" {
			continue
		}
		for _, d := range m.Data {
			var asset string
			switch d.Symbol {
			case "BTC/USD":
				asset = "BTC"
			case "ETH/USD":
				asset = "ETH"
			case "SOL/USD":
				asset = "SOL"
			default:
				continue
			}
			if _, ok := out[asset]; ok {
				continue
			}
			bids := make([]Level, 0, len(d.Bids))
			asks := make([]Level, 0, len(d.Asks))
			for _, l := range d.Bids {
				bids = append(bids, Level{l.Price, l.Qty})
			}
			for _, l := range d.Asks {
				asks = append(asks, Level{l.Price, l.Qty})
			}
			depth, e := Normalize(bids, asks)
			if e != nil {
				continue
			}
			out[asset] = CapturedBook{depth, recv, "kraken_ws1000"}
		}
	}
	return out, nil
}

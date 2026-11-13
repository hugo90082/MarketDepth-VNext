package futures

import (
	"fmt"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func TestCollectorSixRowsAndAdmission(t *testing.T) {
	first := t0 + 50000
	now := time.UnixMilli(first - 100)
	c, e := newCollector(first, func() time.Time { return now })
	if e != nil {
		t.Fatal(e)
	}
	for i, x := range []int64{first - 1, first, first + 10000} {
		now = time.UnixMilli(x + 1)
		raw := fmt.Sprintf(`{"stream":"btcusdt@aggTrade","data":{"e":"aggTrade","s":"BTCUSDT","a":%d,"p":"100","q":"1","f":%d,"l":%d,"T":%d,"m":false}}`, i+1, i+1, i+1, x)
		if e = c.Accept([]byte(raw)); e != nil {
			t.Fatal(e)
		}
	}
	now = time.UnixMilli(first + 10001)
	raw := fmt.Sprintf(`{"stream":"btcusdt@kline_1m","data":{"e":"kline","s":"BTCUSDT","k":{"t":%d,"T":%d,"s":"BTCUSDT","i":"1m","x":true,"o":"100","h":"101","l":"99","c":"100","v":"10","q":"1000","V":"4","Q":"400","n":23}}}`, t0, t0+59999)
	if e = c.Accept([]byte(raw)); e != nil {
		t.Fatal(e)
	}
	if _, e = c.Finalize(first); e == nil {
		t.Fatal("early finalize")
	}
	now = time.UnixMilli(first + 12000)
	rows, e := c.Finalize(first)
	if e != nil || len(rows) != 6 {
		t.Fatal(rows, e)
	}
	if rows[0].Base().Status != "ok" || rows[1].Base().Status != "missing" || rows[3].Kind() != model.F1 || rows[3].Base().Status != "ok" || rows[4].Base().Status != "missing" {
		t.Fatal(rows)
	}
}

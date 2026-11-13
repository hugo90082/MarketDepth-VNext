package store

import (
	"encoding/json"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"os"
	"testing"
)

func liveRows() []model.Row {
	// 2026-11-13 Taipei midnight; use a large ID to catch float64 precision loss.
	t := int64(1794499200000)
	t -= t % 60000
	src := model.LiveSource
	c := model.Common{T: t, AvailableAt: model.Ptr(t + 60000), Asset: "BTC", Status: "partial", Source: &src, Revision: 1}
	return []model.Row{model.SpotRow{Common: c, Venue: "binance", Bid0100: model.Ptr(0.0)}, model.Futures10Row{Common: c, FirstAggID: model.Ptr(int64(9007199254740993))}, model.Futures1Row{Common: c}}
}
func TestDailySQLContract(t *testing.T) {
	type plan struct {
		Kind    model.Kind `json:"kind"`
		SQL     string     `json:"sql"`
		Args    []any      `json:"args"`
		Columns []string   `json:"columns"`
	}
	var out []plan
	for _, r := range liveRows() {
		if e := r.Validate(); e != nil {
			t.Fatal(e)
		}
		v, e := rowValues(r)
		if e != nil {
			t.Fatal(e)
		}
		for i, c := range columns[r.Kind()] {
			if c == "first_agg_id" && v[i] != int64(9007199254740993) {
				t.Fatal("ID precision", v[i])
			}
			if c == "bid_0_100" && v[i] != int64(0) {
				t.Fatal("zero", v[i])
			}
			if c == "ask_0_100" && v[i] != nil {
				t.Fatal("null", v[i])
			}
		}
		out = append(out, plan{r.Kind(), insertSQL(r.Kind()), v, columns[r.Kind()]})
	}
	if p := os.Getenv("MD_SQL_TEST_PLAN"); p != "" {
		b, e := json.Marshal(out)
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(p, b, 0600); e != nil {
			t.Fatal(e)
		}
	}
}

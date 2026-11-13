package futures

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

type workerReader struct {
	store.Reader
	rows map[model.Kind][]model.Row
}

func (r workerReader) History(_ context.Context, q store.Query) (store.Page, error) {
	return store.Page{Rows: append([]model.Row{}, r.rows[q.Kind]...), Complete: true}, nil
}

type workerWriter struct {
	rows []model.Row
	err  error
}

func (w *workerWriter) Put(_ context.Context, rs []model.Row) error {
	if w.err != nil {
		return w.err
	}
	w.rows = append(w.rows, rs...)
	return nil
}

type workerSource struct {
	now   int64
	calls []model.Kind
	fail  bool
}

func (s *workerSource) Recover1m(_ context.Context, a string, t, rev int64) (model.Futures1Row, error) {
	s.calls = append(s.calls, model.F1)
	if s.fail {
		return model.Futures1Row{}, errors.New("unconfirmed")
	}
	p := model.Ptr(100.0)
	return model.Futures1Row{Common: model.Common{T: t, Asset: a, AvailableAt: model.Ptr(s.now), Status: "recovered", Source: model.Ptr(model.LiveSource), Quality: recoveryQuality("official_rest_1m", s.now, nil), Revision: rev + 1}, OHLC: model.OHLC{Open: p, High: p, Low: p, Close: p}, Volume: model.Ptr(1.0), QuoteVolume: p, TakerBuyQty: model.Ptr(1.0), TakerBuyUSDT: p, TradeCount: model.Ptr(int64(1))}, nil
}
func (s *workerSource) Recover10(_ context.Context, a string, t, rev int64, _ *int64) (model.Futures10Row, error) {
	s.calls = append(s.calls, model.F10)
	return model.Futures10Row{}, errors.New("unconfirmed")
}
func TestRepairWorkerBoundsAndRetry(t *testing.T) {
	now := time.Date(2026, 11, 13, 12, 10, 0, 0, time.UTC)
	ts := now.Add(-3 * time.Minute).UnixMilli()
	c := model.Common{T: ts, Asset: "BTC", AvailableAt: model.Ptr(ts + 60000), Status: "missing", Source: model.Ptr(model.LiveSource), Revision: 1}
	r1 := model.Futures1Row{Common: c}
	c.Asset = "ETH"
	c.Status = "ok"
	complete := model.Futures1Row{Common: c}
	c.Asset = "SOL"
	c.Status = "missing"
	c.T = now.Add(-time.Minute).UnixMilli()
	young := model.Futures1Row{Common: c}
	c.T = ts
	c.Asset = "BTC"
	r10 := model.Futures10Row{Common: c}
	r := workerReader{rows: map[model.Kind][]model.Row{model.F1: {complete, young, r1}, model.F10: {r10}}}
	w := &workerWriter{}
	s := &workerSource{now: now.UnixMilli()}
	worker, e := NewRepairWorker(r, w, s)
	if e != nil {
		t.Fatal(e)
	}
	worker.now = func() time.Time { return now }
	stats, e := worker.Cycle(context.Background())
	if e != nil || stats.Recovered != 1 || stats.Failed != 1 || len(s.calls) != 2 || len(w.rows) != 1 || w.rows[0].Base().Revision != 2 {
		t.Fatal(stats, e, s.calls, w.rows)
	}
	// In real SQLite the repaired row is now recovered. A failed 10s target is
	// deferred until backoff; complete and not-yet-eligible rows are never fetched.
	r.rows[model.F1] = []model.Row{w.rows[0], complete, young}
	stats, e = worker.Cycle(context.Background())
	if e != nil || stats.Attempted != 0 || stats.Deferred != 1 {
		t.Fatal(stats, e)
	}
}

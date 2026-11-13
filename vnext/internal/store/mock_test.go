package store

import (
	"context"
	"errors"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"testing"
)

func TestHistorySync(t *testing.T) {
	ctx := context.Background()
	m := Fixture()
	rows, _ := m.Latest(ctx, model.Spot)
	end := rows[0].Key().T + 60000
	q := Query{Kind: model.Spot, From: end - 120000, To: end, Limit: 5}
	var all []model.Row
	for {
		p, e := m.History(ctx, q)
		if e != nil {
			t.Fatal(e)
		}
		all = append(all, p.Rows...)
		if p.Complete {
			break
		}
		q.Cursor = p.Next
	}
	if len(all) != 24 {
		t.Fatal(len(all))
	}
	for i := 1; i < len(all); i++ {
		if !all[i-1].Key().Less(all[i].Key()) {
			t.Fatal("duplicate/out of order")
		}
	}
	p, _ := m.Sync(ctx, model.Spot, "")
	if len(p.Rows) != 24 || p.Next == "" {
		t.Fatal(p)
	}
	r := *all[0].(*model.SpotRow)
	r.Revision++
	r.AvailableAt = model.Ptr(*r.AvailableAt + 90000)
	r.Bid0100 = model.Ptr(123.0)
	if e := m.Put(ctx, []model.Row{r}); e != nil {
		t.Fatal(e)
	}
	p2, e := m.Sync(ctx, model.Spot, p.Next)
	if e != nil || len(p2.Rows) != 1 || p2.Rows[0].Key() != r.Key() {
		t.Fatal(p2, e)
	}
	if _, e := m.History(ctx, q); !errors.Is(e, ErrResync) {
		t.Fatal("stale history accepted", e)
	}
	if _, e := Fixture().Sync(ctx, model.Spot, p.Next); !errors.Is(e, ErrResync) {
		t.Fatal("restart cursor accepted")
	}
	if e := m.Put(ctx, []model.Row{r}); e == nil {
		t.Fatal("duplicate revision accepted")
	}
	r.Revision++
	r.AvailableAt = model.Ptr(int64(0))
	if e := m.Put(ctx, []model.Row{r}); e == nil {
		t.Fatal("availability regressed")
	}
	q.Cursor = ""
	q.To += 60000
	g, e := m.History(ctx, q)
	if e != nil || len(g.Gaps) != 1 || g.Gaps[0].From != end {
		t.Fatal(g, e)
	}
}
func TestBatchAtomic(t *testing.T) {
	m := NewMock()
	r := model.SpotRow{Common: model.Common{T: 60000, Asset: "BTC", Status: "partial", Revision: 1}, Venue: "binance"}
	bad := r
	bad.Venue = "invalid"
	if e := m.Put(context.Background(), []model.Row{r, bad}); e == nil {
		t.Fatal("bad row accepted")
	}
	p, _ := m.Sync(context.Background(), model.Spot, "")
	if len(p.Rows) != 0 {
		t.Fatal("partial batch committed")
	}
}

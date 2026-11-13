package futures

import "testing"

func TestWindowBoundAndSequentialFinalize(t *testing.T) {
	w, e := NewWindow("BTC", t0, 3)
	if e != nil {
		t.Fatal(e)
	}
	for _, x := range []Trade{tr(10, -1, 1, 1, false), tr(11, 1, 2, 1, false), tr(12, 10000, 3, 1, false)} {
		if e = w.Add(x); e != nil {
			t.Fatal(e)
		}
	}
	r, e := w.Finalize(t0, t0+12000)
	if e != nil || r.Status != "ok" || *r.AggCount != 1 {
		t.Fatal(r, e)
	}
	if _, e = w.Finalize(t0, t0+12000); e == nil {
		t.Fatal("re-finalization accepted")
	}
	if e = w.Add(tr(13, 20000, 4, 1, false)); e != nil {
		t.Fatal(e)
	}
	r, e = w.Finalize(t0+10000, t0+22000)
	if e != nil || r.Status != "ok" || *r.Open != 3 {
		t.Fatal(r, e)
	}
}
func TestWindowOverflowFailClosed(t *testing.T) {
	w, _ := NewWindow("BTC", t0, 2)
	for _, x := range []Trade{tr(10, -1, 1, 1, false), tr(11, 1, 2, 1, false), tr(12, 10000, 3, 1, false)} {
		if e := w.Add(x); e != nil {
			t.Fatal(e)
		}
	}
	if e := w.Add(tr(13, 10001, 4, 1, false)); e == nil {
		t.Fatal("capacity unbounded")
	}
	r, e := w.Finalize(t0, t0+12000)
	if e != nil || r.Status != "partial" {
		t.Fatal(r, e)
	}
}

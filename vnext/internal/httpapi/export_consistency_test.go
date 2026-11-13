package httpapi

import (
	"compress/gzip"
	"context"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
)

type exportReader struct {
	store.Reader
	calls  int
	change bool
}

func (r *exportReader) RangeVersion(context.Context, []model.Kind, int64, int64) (string, error) {
	r.calls++
	if r.change && r.calls > 1 {
		return "changed", nil
	}
	return "same", nil
}
func TestLiveExportRequiresStableAllKindRange(t *testing.T) {
	for _, change := range []bool{false, true} {
		r := &exportReader{Reader: store.Fixture(), change: change}
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/api/v2/export?from=0&to=60000", nil)
		(API{Reader: r, Live: true}).export(w, req)
		gz, e := gzip.NewReader(w.Body)
		if e != nil {
			t.Fatal(e)
		}
		b, e := io.ReadAll(gz)
		gz.Close()
		if e != nil {
			t.Fatal(e)
		}
		complete := strings.Contains(string(b), `"complete":true`)
		if complete == change || r.calls != 2 {
			t.Fatalf("change=%v calls=%d body=%s", change, r.calls, b)
		}
	}
}

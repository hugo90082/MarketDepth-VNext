//go:build linux

package store

import (
	"context"
	"database/sql"
	"errors"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestManagerPreflightAndExclusiveLock(t *testing.T) {
	root := filepath.Join(t.TempDir(), "live")
	calls := 0
	open := func(string, bool) (*sql.DB, error) { calls++; return nil, errors.New("test opener") }
	base := liveRows()[0].(model.SpotRow)
	base.T = time.Date(2026, 11, 13, 12, 0, 0, 0, time.FixedZone("UTC+8", 8*3600)).UnixMilli()
	base.AvailableAt = model.Ptr(base.T + 1000)
	now := time.UnixMilli(base.T + 60000)
	m, e := newManager(root, open, func() time.Time { return now }, 5*time.Minute)
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close()
	if m2, e := NewManager(root, open); e == nil {
		m2.Close()
		t.Fatal("second writer")
	}
	old := base
	old.T -= 86400000
	old.AvailableAt = model.Ptr(old.T + 1000)
	future := base
	future.T += 120000
	future.AvailableAt = model.Ptr(future.T + 1000)
	for _, r := range []model.Row{old, future} {
		if e = m.Put(context.Background(), []model.Row{r}); e == nil {
			t.Fatal("bad time accepted")
		}
	}
	if calls != 0 {
		t.Fatal("preflight opened DB")
	}
	p := filepath.Join(root, model.Day(base.T)+".sqlite")
	if e = os.Symlink(filepath.Join(root, "unknown"), p); e != nil {
		t.Fatal(e)
	}
	if e = m.Put(context.Background(), []model.Row{base}); e == nil || calls != 0 {
		t.Fatal("symlink accepted")
	}
	if e = m.Close(); e != nil {
		t.Fatal(e)
	}
	m2, e := NewManager(root, open)
	if e != nil {
		t.Fatal(e)
	}
	m2.Close()
}

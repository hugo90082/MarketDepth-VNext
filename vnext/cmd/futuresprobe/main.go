//go:build linux && live_ws && sqlite_integration

// Explicit isolated public-market futures probe. No trading or deployment.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/collector/futures"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

func run(ctx context.Context, root string, minutes int) error {
	if root == "" || minutes < 1 || minutes > 10 {
		return errors.New("explicit --data-dir and --minutes 1-10 required")
	}
	if _, e := os.Lstat(root); !os.IsNotExist(e) {
		return errors.New("probe refuses existing data directory")
	}
	// Bound the entire probe, including warm-up, independently of caller.
	ctx, cancel := context.WithTimeout(ctx, time.Duration(minutes+3)*time.Minute)
	defer cancel()
	m, e := store.NewManager(root, store.SQLiteOpener)
	if e != nil {
		return e
	}
	defer m.Close()
	j, e := m.OpenCatalog(ctx)
	if e != nil {
		return e
	}
	defer j.Close()
	if e = j.Recover(ctx); e != nil {
		return e
	}
	q, e := store.NewWriteQueue(j, 8)
	if e != nil {
		return e
	}
	defer q.Close(context.Background())
	first := time.Now().Add(10 * time.Second).Truncate(time.Minute).Add(time.Minute).UnixMilli()
	c, e := futures.NewCollector(first)
	if e != nil {
		return e
	}
	feedCtx, stop := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { defer close(done); c.RunWS(feedCtx, func(s string) { log.Printf("futures WS: %s", s) }) }()
	defer func() { stop(); <-done }()
	enc := json.NewEncoder(os.Stdout)
	for i := 0; i < minutes*6; i++ {
		t := first + int64(i)*10000
		timer := time.NewTimer(time.Until(time.UnixMilli(t + 10000).Add(futures.FinalizeDelay)))
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		rows, e := c.Finalize(t)
		if e != nil {
			return e
		}
		want := 3
		if (t+10000)%60000 == 0 {
			want = 6
		}
		if len(rows) != want {
			return errors.New("unexpected row count")
		}
		if e = q.Put(ctx, rows); e != nil {
			return e
		}
		counts := map[string]int{}
		for _, r := range rows {
			counts[r.Base().Status]++
			if e = enc.Encode(r); e != nil {
				return e
			}
		}
		fmt.Fprintf(os.Stderr, "futures probe t=%d rows=%d statuses=%v\n", t, len(rows), counts)
	}
	return nil
}
func main() {
	root := flag.String("data-dir", "", "new, non-existing isolated data directory (required)")
	n := flag.Int("minutes", 2, "probe minutes (1-10)")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if e := run(ctx, *root, *n); e != nil {
		log.Fatal(e)
	}
}

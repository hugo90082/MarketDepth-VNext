//go:build linux && live_ws && sqlite_integration

// Explicit isolated live probe. Never run as production service.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/collector/spot"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	root := flag.String("data-dir", "", "new, non-existing isolated data directory (required)")
	n := flag.Int("minutes", 2, "probe minutes (1-10)")
	flag.Parse()
	if *root == "" || *n < 1 || *n > 10 {
		log.Fatal("explicit --data-dir and --minutes 1-10 required")
	}
	if _, e := os.Lstat(*root); !os.IsNotExist(e) {
		log.Fatal("probe refuses existing data directory")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	m, e := store.NewManager(*root, store.SQLiteOpener)
	if e != nil {
		log.Fatal(e)
	}
	defer m.Close()
	q, e := store.NewWriteQueue(m, 8)
	if e != nil {
		log.Fatal(e)
	}
	defer q.Close(context.Background())
	first := time.Now().Add(10 * time.Second).Truncate(time.Minute).Add(time.Minute).UnixMilli()
	feeds := map[string]*spot.BinanceFeed{}
	for _, a := range []string{"BTC", "ETH"} {
		f, e := spot.NewBinanceFeed(a, first)
		if e != nil {
			log.Fatal(e)
		}
		feeds[a] = f
		a := a
		go f.Run(ctx, func(s string) { log.Printf("binance %s: %s", a, s) })
	}
	sampler, e := spot.NewSampler(spot.NewRESTSource(), spot.KrakenWS, feeds)
	if e != nil {
		log.Fatal(e)
	}
	enc := json.NewEncoder(os.Stdout)
	for i := 0; i < *n; i++ {
		t := first + int64(i)*60000
		rows, e := sampler.SampleAt(ctx, t)
		if e != nil {
			log.Fatal(e)
		}
		if len(rows) != 12 {
			log.Fatal("unexpected row count")
		}
		if e = q.Put(ctx, rows); e != nil {
			log.Fatal(e)
		}
		counts := map[string]int{}
		for _, r := range rows {
			counts[r.Base().Status]++
			if e = enc.Encode(r); e != nil {
				log.Fatal(e)
			}
		}
		fmt.Fprintf(os.Stderr, "probe t=%d rows=%d statuses=%v\n", t, len(rows), counts)
	}
}

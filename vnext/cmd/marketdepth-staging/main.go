//go:build linux && live_ws && sqlite_integration && secure_auth

// Explicit isolated integration candidate. Not a production deployment.
package main

import (
	"context"
	"encoding/base64"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/collector/futures"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/collector/spot"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/httpapi"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/service"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

const marker = ".marketdepth-vnext-staging"
const markerBody = "MARKETDEPTH-VNEXT-STAGING-1\n"

func prepare(root string, init bool) error {
	if root == "" || !filepath.IsAbs(root) || filepath.Clean(root) != root || root == "/" {
		return errors.New("explicit absolute isolated data directory required")
	}
	parent := filepath.Dir(root)
	if real, e := filepath.EvalSymlinks(parent); e != nil || real != parent {
		return errors.New("staging parent must exist and not be a symlink")
	}
	if init {
		if e := os.Mkdir(root, 0700); e != nil {
			return fmt.Errorf("new staging directory required: %w", e)
		}
		f, e := os.OpenFile(filepath.Join(root, marker), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return e
		}
		if _, e = f.WriteString(markerBody); e != nil {
			f.Close()
			return e
		}
		e = f.Sync()
		ce := f.Close()
		if e != nil {
			return e
		}
		return ce
	}
	if real, e := filepath.EvalSymlinks(root); e != nil || real != root {
		return errors.New("staging root must exist and not be a symlink")
	}
	st, e := os.Lstat(filepath.Join(root, marker))
	if e != nil || !st.Mode().IsRegular() || st.Size() != int64(len(markerBody)) {
		return errors.New("existing directory lacks valid staging marker")
	}
	b, e := os.ReadFile(filepath.Join(root, marker))
	if e != nil || string(b) != markerBody {
		return errors.New("invalid staging marker")
	}
	return nil
}
func meter(root string) service.Meter {
	return func() (int64, int64, error) {
		used, e := archive.MeasureAllocated(root)
		if e != nil {
			return 0, 0, e
		}
		var s syscall.Statfs_t
		if e = syscall.Statfs(root, &s); e != nil {
			return 0, 0, e
		}
		if s.Bsize <= 0 || s.Bavail > uint64((1<<62)/s.Bsize) {
			return 0, 0, errors.New("invalid filesystem capacity")
		}
		return used, int64(s.Bavail) * s.Bsize, nil
	}
}

type health struct {
	mu                    sync.Mutex
	lastSpot, lastFutures int64
}

func (h *health) update(spot bool, t int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if spot {
		h.lastSpot = t
	} else {
		h.lastFutures = t
	}
}
func (h *health) read() map[string]any {
	h.mu.Lock()
	defer h.mu.Unlock()
	return map[string]any{"mode": "isolated_staging", "last_spot_committed_t": h.lastSpot, "last_futures_committed_t": h.lastFutures, "archive": "not_connected", "production_ready": false}
}
func run(ctx context.Context, root, addr, origin string, init bool) error {
	host, _, e := net.SplitHostPort(addr)
	if e != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return errors.New("staging requires numeric loopback listen address")
	}
	key, e := base64.StdEncoding.DecodeString(os.Getenv("MD_SESSION_KEY_B64"))
	if e != nil {
		return errors.New("invalid session key encoding")
	}
	auth, e := httpapi.NewBcryptAuth(origin, key, []byte(os.Getenv("MD_PASSWORD_BCRYPT")))
	if e != nil {
		return e
	}
	if e = prepare(root, init); e != nil {
		return e
	}
	m, e := store.NewManager(root, store.SQLiteOpener)
	if e != nil {
		return e
	}
	defer m.Close()
	measure := meter(root)
	used, free, e := measure()
	if e != nil {
		return e
	}
	if used >= archive.HighWater-service.WriteReserve || free < service.MinRootFree+service.WriteReserve {
		return service.ErrCapacity
	}
	j, e := m.OpenCatalog(ctx)
	if e != nil {
		return e
	}
	defer j.Close()
	if e = j.Recover(ctx); e != nil {
		return e
	}
	guard, e := service.NewGuardedWriter(j, measure)
	if e != nil {
		return e
	}
	q, e := store.NewWriteQueue(guard, 8)
	if e != nil {
		return e
	}
	defer q.Close(context.Background())
	first := time.Now().Add(10 * time.Second).Truncate(time.Minute).Add(time.Minute).UnixMilli()
	feeds := map[string]*spot.BinanceFeed{}
	for _, a := range []string{"BTC", "ETH"} {
		f, e := spot.NewBinanceFeed(a, first)
		if e != nil {
			return e
		}
		feeds[a] = f
	}
	sampler, e := spot.NewSampler(spot.NewRESTSource(), spot.KrakenWS, feeds)
	if e != nil {
		return e
	}
	fc, e := futures.NewCollector(first)
	if e != nil {
		return e
	}
	repair, e := futures.NewRepairWorker(j, q, futures.NewRESTClient())
	if e != nil {
		return e
	}
	h := &health{}
	srv := &http.Server{Handler: httpapi.API{Reader: j, Live: true, Auth: auth, Health: h.read}.Handler(), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 125 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	// Bind before starting any feeds, so a conflicting port cannot leave partial workers.
	ln, e := net.Listen("tcp", addr)
	if e != nil {
		return e
	}
	defer ln.Close()
	workers := []service.Worker{
		func(ctx context.Context) error {
			done := make(chan error, 1)
			go func() { done <- srv.Serve(ln) }()
			select {
			case e := <-done:
				return e
			case <-ctx.Done():
				c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				e := srv.Shutdown(c)
				if e != nil {
					srv.Close()
				}
				<-done
				return e
			}
		},
		func(ctx context.Context) error {
			fc.RunWS(ctx, func(s string) { log.Printf("futures WS: %s", s) })
			return ctx.Err()
		},
		func(ctx context.Context) error {
			for t := first; ; t += 60000 {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				if time.Now().UnixMilli()-t > 120000 {
					return errors.New("spot scheduler excessive lag; restart required")
				}
				rows, e := sampler.SampleAt(ctx, t)
				if e != nil {
					return e
				}
				if len(rows) != 12 {
					return errors.New("wrong spot batch")
				}
				if e = q.Put(ctx, rows); e != nil {
					return e
				}
				h.update(true, t)
			}
		},
		func(ctx context.Context) error {
			for t := first; ; t += 10000 {
				if e := service.WaitUntil(ctx, time.UnixMilli(t+10000).Add(futures.FinalizeDelay)); e != nil {
					return e
				}
				if time.Now().UnixMilli()-t > 120000 {
					return errors.New("futures scheduler excessive lag; restart required")
				}
				rows, e := fc.Finalize(t)
				if e != nil {
					return e
				}
				if e = q.Put(ctx, rows); e != nil {
					return e
				}
				h.update(false, t)
			}
		},
		func(ctx context.Context) error {
			for {
				if e := service.WaitUntil(ctx, time.Now().Add(time.Minute)); e != nil {
					return e
				}
				s, e := repair.Cycle(ctx)
				if e != nil {
					return e
				}
				if s.Attempted > 0 {
					log.Printf("repair attempted=%d recovered=%d failed=%d", s.Attempted, s.Recovered, s.Failed)
				}
			}
		},
	}
	for a, f := range feeds {
		a, f := a, f
		workers = append(workers, func(ctx context.Context) error {
			f.Run(ctx, func(s string) { log.Printf("binance %s: %s", a, s) })
			return ctx.Err()
		})
	}
	log.Printf("isolated staging only; first target %d; no Drive or automatic deletion", first)
	return service.RunGroup(ctx, workers...)
}
func main() {
	root := flag.String("data-dir", "", "absolute dedicated staging data dir")
	addr := flag.String("listen", "127.0.0.1:18082", "loopback only")
	origin := flag.String("origin", "", "exact HTTPS origin")
	init := flag.Bool("init-staging", false, "create new staging directory; never existing data")
	flag.Parse()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if e := run(ctx, *root, *addr, *origin, *init); e != nil {
		log.Fatal(e)
	}
}

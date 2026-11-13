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
	"math/rand/v2"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive/drive"
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
	lastArchive           int64
	archiveState          string
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
func (h *health) archiveUpdate(state string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.archiveState = state
	if state == "hourly_verified" || state == "daily_verified" {
		h.lastArchive = time.Now().UnixMilli()
	}
}
func (h *health) read() map[string]any {
	h.mu.Lock()
	defer h.mu.Unlock()
	return map[string]any{"mode": "isolated_staging", "last_spot_committed_t": h.lastSpot, "last_futures_committed_t": h.lastFutures, "archive": h.archiveState, "last_archive_verified_at": h.lastArchive, "production_ready": false}
}

// Credentials must remain outside the market-data tree and never be copied
// into the archive. The isolated binary cannot select a production namespace.
func stagingDrive(root, credentials, producer string) (*drive.Client, error) {
	if !filepath.IsAbs(credentials) || filepath.Clean(credentials) != credentials || len(producer) != 40 || strings.Trim(producer, "0123456789abcdef") != "" {
		return nil, errors.New("absolute private credential file and exact producer commit required")
	}
	real, e := filepath.EvalSymlinks(credentials)
	if e != nil || real != credentials {
		return nil, errors.New("unsafe credential path")
	}
	rel, e := filepath.Rel(root, real)
	if e != nil || rel == "." || (!strings.HasPrefix(rel, ".."+string(os.PathSeparator)) && rel != "..") {
		return nil, errors.New("credential must be outside market-data root")
	}
	cred, e := drive.LoadCredentials(real)
	if e != nil {
		return nil, e
	}
	tokens, e := drive.NewTokenSource(cred)
	if e != nil {
		return nil, e
	}
	state := filepath.Join(root, "drive-state")
	if e = os.Mkdir(state, 0700); e != nil && !errors.Is(e, os.ErrExist) {
		return nil, e
	}
	return drive.NewClient(tokens, "MarketDepth-VNext-staging", state)
}
func archiveLoop(ctx context.Context, w *store.ArchiveWorker, reader *store.ArchiveReader, h *health) error {
	delay := 30 * time.Second
	for {
		if e := ctx.Err(); e != nil {
			return e
		}
		state, e := w.Cycle(ctx)
		if e == nil && state == "idle" && reader != nil {
			state, e = reader.ReclaimVerifiedCycle(ctx)
		}
		if e == nil && state == "idle" && reader != nil {
			state, e = reader.CompactVerifiedCycle(ctx)
		}
		if e == nil && state == "idle" && reader != nil {
			state, e = reader.VacuumCatalogCycle(ctx)
		}
		wait := 15 * time.Second
		if e != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			code := "retry_pending"
			if errors.Is(e, drive.ErrReauthorize) {
				code = "reauthorize_required"
			} else if errors.Is(e, service.ErrCapacity) {
				code = "capacity_wait"
			}
			h.archiveUpdate(code)
			log.Printf("archive: %s", code)
			wait = delay + time.Duration(rand.Int64N(int64(delay/4)+1))
			if d := drive.RetryDelay(e); d > wait {
				wait = d
			}
			if delay < 15*time.Minute {
				delay *= 2
				if delay > 15*time.Minute {
					delay = 15 * time.Minute
				}
			}
		} else {
			delay = 30 * time.Second
			h.archiveUpdate(state)
			if state != "idle" {
				log.Printf("archive: %s", state)
			}
		}
		if e := service.WaitUntil(ctx, time.Now().Add(wait)); e != nil {
			return e
		}
	}
}
func run(ctx context.Context, root, addr, origin string, init bool, credentials, producer string) error {
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
	if e = j.RecoverLoss(ctx); e != nil { return e }
	if e = j.Recover(ctx); e != nil {
		return e
	}
	gate, e := service.NewCapacityGate(measure)
	if e != nil {
		return e
	}
	guard, e := service.NewSharedGuardedWriter(j, gate)
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
	h := &health{archiveState: "not_connected"}
	var backup *store.ArchiveWorker
	var archiveReader *store.ArchiveReader
	var reader store.Reader = j
	if credentials != "" {
		remote, e := stagingDrive(root, credentials, producer)
		if e != nil {
			return e
		}
		backup, e = store.NewArchiveWorker(m, j, remote, gate.Reserve, producer)
		if e != nil {
			return e
		}
		cache, e := store.NewArchiveReadCache(m, remote, gate.Reserve)
		if e != nil { return e }
		archiveReader, e = store.NewArchiveReader(j, cache)
		if e != nil { return e }
		reader = archiveReader
		h.archiveState = "configured_unverified"
	}
	srv := &http.Server{Handler: httpapi.API{Reader: reader, Live: true, Auth: auth, Health: h.read}.Handler(), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 125 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
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
	if backup != nil {
		workers = append(workers, func(ctx context.Context) error { return archiveLoop(ctx, backup, archiveReader, h) })
	}
	log.Printf("isolated staging only; first target %d; Drive enabled=%t; verified-only daily reclamation", first, backup != nil)
	return service.RunGroup(ctx, workers...)
}
func main() {
	root := flag.String("data-dir", "", "absolute dedicated staging data dir")
	addr := flag.String("listen", "127.0.0.1:18082", "loopback only")
	origin := flag.String("origin", "", "exact HTTPS origin")
	init := flag.Bool("init-staging", false, "create new staging directory; never existing data")
	credentials := flag.String("drive-credentials", "", "optional absolute private OAuth JSON outside data root; staging namespace only")
	producer := flag.String("producer-commit", "", "exact Git commit for archive provenance")
	flag.Parse()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if e := run(ctx, *root, *addr, *origin, *init, *credentials, *producer); e != nil {
		log.Fatal(e)
	}
}

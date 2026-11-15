package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/httpapi"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

type protectedRoots []string

func (r *protectedRoots) String() string { return strings.Join(*r, ",") }
func (r *protectedRoots) Set(v string) error {
	if v == "" {
		return errors.New("empty protected root")
	}
	*r = append(*r, v)
	return nil
}

func main() {
	addr := flag.String("listen", "127.0.0.1:18081", "loopback listen address")
	mock := flag.Bool("mock", false, "explicitly enable synthetic data; never production")
	check := flag.Bool("check-production", false, "read-only production configuration preflight (no activation)")
	runProd := flag.Bool("run-production", false, "run live production collector, API, web UI, and Drive archiver")
	seedProd := flag.Bool("seed-production", false, "seed historical data into production data directory")
	recoverCat := flag.Bool("recover-catalog", false, "recover production catalog from Google Drive into a new directory")
	initRoot := flag.Bool("init-root", false, "initialize new production data directory")
	allowLoss := flag.Bool("allow-capacity-loss", false, "permit emergency loss of unbacked old days under severe disk pressure")
	resumeRecovered := flag.Bool("resume-recovered", false, "resume a completed recovered production catalog")
	root := flag.String("data-dir", "", "absolute dedicated production data directory")
	webDir := flag.String("web-dir", "", "optional static web UI directory (dist/client)")
	origin := flag.String("origin", "", "exact HTTPS origin")
	credentials := flag.String("drive-credentials", "", "private external OAuth file")
	producer := flag.String("producer-commit", "", "exact producer commit")
	leaseDir := flag.String("drive-lease-dir", "", "private external namespace lock directory")
	seedSQLite := flag.String("seed-vnext-sqlite", "", "comma-separated VNext SQLite paths to seed")
	seedV66 := flag.String("seed-v66-jsonl", "", "V66 local history export .jsonl.gz path to seed")
	seedLegacySpot := flag.String("seed-legacy-spot-dir", "", "legacy collector spot data directory to seed")
	seedBinanceDays := flag.String("seed-binance-f1m-days", "", "comma-separated UTC+8 days to fetch Binance Futures 1m klines")
	legacyEnv := flag.String("legacy-env", "", "optional legacy collector env file containing ADMIN_PASSWORD")
	vnextEnvOut := flag.String("write-vnext-env", "", "optional output path for VNext env file (0600)")
	var roots protectedRoots
	flag.Var(&roots, "protected-root", "existing old/staging data root (repeat for all roots)")
	flag.Parse()
	if flag.NArg() != 0 {
		log.Fatal("unexpected positional arguments")
	}
	modes := 0
	for _, b := range []bool{*mock, *check, *runProd, *seedProd, *recoverCat} {
		if b {
			modes++
		}
	}
	if modes != 1 {
		log.Fatal("choose exactly one explicit mode: --mock, --check-production, --seed-production, --run-production, or --recover-catalog")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if *check {
		if e := checkProduction(*root, *addr, *origin, *credentials, *producer, *leaseDir, roots); e != nil {
			log.Fatal(e)
		}
		return
	}
	if *seedProd {
		if e := seedProduction(ctx, *root, *initRoot, *seedSQLite, *seedV66, *seedLegacySpot, *seedBinanceDays, *legacyEnv, *vnextEnvOut); e != nil {
			log.Fatal(e)
		}
		return
	}
	if *recoverCat {
		if !*initRoot {
			log.Fatal("--recover-catalog requires --init-root")
		}
		if e := recoverProduction(ctx, *root, *credentials, *producer, *leaseDir); e != nil {
			log.Fatal(e)
		}
		return
	}
	if *runProd {
		if e := runProduction(ctx, *root, *addr, *origin, *webDir, *initRoot, *credentials, *producer, *leaseDir, *allowLoss, *resumeRecovered); e != nil {
			log.Fatal(e)
		}
		return
	}
	if *root != "" || *origin != "" || *credentials != "" || *producer != "" || *leaseDir != "" || len(roots) > 0 {
		log.Fatal("production options require --check-production or --run-production")
	}
	h, _, e := net.SplitHostPort(*addr)
	if e != nil || net.ParseIP(h) == nil || !net.ParseIP(h).IsLoopback() {
		log.Fatal("mock server must bind a numeric loopback address")
	}
	s := http.Server{Addr: *addr, Handler: httpapi.API{Reader: store.Fixture(), WebDir: *webDir}.Handler(), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	log.Printf("SYNTHETIC MOCK ONLY: %s", *addr)
	log.Fatal(s.ListenAndServe())
}

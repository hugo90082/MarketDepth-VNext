//go:build linux && live_ws && sqlite_integration && secure_auth

// Explicit isolated integration candidate. Not a production deployment.
package main

import (
	"context"
	"flag"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/runtimeapp"
	"log"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	root := flag.String("data-dir", "", "absolute dedicated staging data dir")
	addr := flag.String("listen", "127.0.0.1:18082", "loopback only")
	origin := flag.String("origin", "", "exact HTTPS origin")
	init := flag.Bool("init-staging", false, "create new staging directory; never existing data")
	credentials := flag.String("drive-credentials", "", "optional absolute private OAuth JSON outside data root; staging namespace only")
	producer := flag.String("producer-commit", "", "exact Git commit for archive provenance")
	leaseDir := flag.String("drive-lease-dir", "", "shared private namespace lock directory; required for future Drive writer/recovery")
	allowLoss := flag.Bool("allow-capacity-loss", false, "isolated staging only: explicitly permit permanent loss of eligible unbacked old days under pressure")
	recoverCatalog := flag.Bool("recover-catalog", false, "read-only Drive recovery into a new isolated root; never start collection")
	resumeRecovered := flag.Bool("resume-recovered", false, "explicitly resume a completed recovery root; requires old writer stopped and nonoverlapping day")
	preserveActive := flag.Bool("preserve-active-backups", false, "same-day staging QA only: preserve all verified active Drive generations; persistent policy")
	flag.Parse()
	if flag.NArg() != 0 {
		log.Fatal("unexpected positional arguments")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if *recoverCatalog {
		if !*init || *allowLoss || *resumeRecovered || *preserveActive {
			log.Fatal("recovery requires --init-staging without resume or forced loss")
		}
		if e := runtimeapp.RecoverStaging(ctx, *root, *credentials, *producer, *leaseDir); e != nil {
			log.Fatal(e)
		}
		return
	}
	if e := runtimeapp.RunStaging(ctx, *root, *addr, *origin, *init, *credentials, *producer, *leaseDir, *allowLoss, *resumeRecovered, *preserveActive); e != nil {
		log.Fatal(e)
	}
}

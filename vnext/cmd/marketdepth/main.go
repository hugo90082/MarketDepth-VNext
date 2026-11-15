package main

import (
	"errors"
	"flag"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/httpapi"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
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
	addr := flag.String("listen", "127.0.0.1:18081", "loopback fixture server only")
	mock := flag.Bool("mock", false, "explicitly enable synthetic data; never production")
	check := flag.Bool("check-production", false, "read-only production configuration preflight (no activation)")
	root := flag.String("data-dir", "", "absolute dedicated production data directory")
	origin := flag.String("origin", "", "exact HTTPS origin")
	credentials := flag.String("drive-credentials", "", "private external OAuth file")
	producer := flag.String("producer-commit", "", "exact producer commit")
	leaseDir := flag.String("drive-lease-dir", "", "private external namespace lock directory")
	var roots protectedRoots
	flag.Var(&roots, "protected-root", "existing old/staging data root (repeat for all roots)")
	flag.Parse()
	if flag.NArg() != 0 || (*mock && *check) {
		log.Fatal("choose one explicit mode; no positional arguments")
	}
	if *check {
		if e := checkProduction(*root, *addr, *origin, *credentials, *producer, *leaseDir, roots); e != nil {
			log.Fatal(e)
		}
		return
	}
	if *root != "" || *origin != "" || *credentials != "" || *producer != "" || *leaseDir != "" || len(roots) > 0 {
		log.Fatal("production options require --check-production")
	}

	if !*mock {
		log.Fatal("select --mock or --check-production; production activation disabled pending release gates")
	}
	h, _, e := net.SplitHostPort(*addr)
	if e != nil || net.ParseIP(h) == nil || !net.ParseIP(h).IsLoopback() {
		log.Fatal("mock server must bind a numeric loopback address")
	}
	s := http.Server{Addr: *addr, Handler: httpapi.API{Reader: store.Fixture()}.Handler(), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	log.Printf("SYNTHETIC MOCK ONLY: %s", *addr)
	log.Fatal(s.ListenAndServe())
}

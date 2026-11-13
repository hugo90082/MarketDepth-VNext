package main

import (
	"flag"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/httpapi"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
	"log"
	"net"
	"net/http"
	"time"
)

func main() {
	addr := flag.String("listen", "127.0.0.1:18081", "loopback fixture server only")
	mock := flag.Bool("mock", false, "explicitly enable synthetic data; never production")
	flag.Parse()
	if !*mock {
		log.Fatal("Phase 1: only --mock is implemented; production disabled")
	}
	h, _, e := net.SplitHostPort(*addr)
	if e != nil || net.ParseIP(h) == nil || !net.ParseIP(h).IsLoopback() {
		log.Fatal("mock server must bind a numeric loopback address")
	}
	s := http.Server{Addr: *addr, Handler: httpapi.API{Reader: store.Fixture()}.Handler(), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	log.Printf("SYNTHETIC MOCK ONLY: %s", *addr)
	log.Fatal(s.ListenAndServe())
}

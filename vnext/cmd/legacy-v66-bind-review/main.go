//go:build linux && sqlite_integration

// Planning only: creates a detached proof review, never a publication.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/legacy"
	"io"
	"log"
	"os"
)

func readBounded(path string) ([]byte, error) {
	f, e := os.Open(path)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil || !st.Mode().IsRegular() || st.Size() <= 0 || st.Size() > 2<<20 {
		return nil, errors.New("bounded regular input required")
	}
	b, e := io.ReadAll(io.LimitReader(f, (2<<20)+1))
	if e != nil || int64(len(b)) != st.Size() {
		return nil, errors.New("input changed or unreadable")
	}
	return b, nil
}
func main() {
	d := flag.String("draft", "", "reviewed V66 draft JSON")
	dh := flag.String("draft-sha256", "", "independent reviewed draft SHA256")
	p := flag.String("placement", "", "actual reviewed placement report JSON")
	ph := flag.String("placement-sha256", "", "canonical placement report SHA256 from independent review")
	flag.Parse()
	raw, e := readBounded(*d)
	if e != nil {
		log.Fatal(e)
	}
	b, e := readBounded(*p)
	if e != nil {
		log.Fatal(e)
	}
	var r legacy.PlacementReport
	if e = json.Unmarshal(b, &r); e != nil {
		log.Fatal(e)
	}
	x, e := legacy.BindV66Proofs(raw, *dh, r, *ph)
	if e != nil {
		log.Fatal(e)
	}
	if e = json.NewEncoder(os.Stdout).Encode(x); e != nil {
		log.Fatal(e)
	}
}

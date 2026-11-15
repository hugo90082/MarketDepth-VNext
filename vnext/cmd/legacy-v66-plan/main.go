//go:build linux && sqlite_integration

// Offline preparation/inspection only. No credentials, network, or publish command.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/legacy"
)

func readFile(p, want string, max int64) ([]byte, error) {
	f, e := os.Open(p)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil || !st.Mode().IsRegular() || st.Size() <= 0 || st.Size() > max {
		return nil, errors.New("invalid input file")
	}
	b, e := io.ReadAll(io.LimitReader(f, max+1))
	if e != nil || int64(len(b)) != st.Size() {
		return nil, errors.New("input length differs")
	}
	h := sha256.Sum256(b)
	if want != "" && hex.EncodeToString(h[:]) != want {
		return nil, errors.New("input SHA256 differs")
	}
	return b, nil
}
func decode(b []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return e
	}
	var extra any
	if e := d.Decode(&extra); e != io.EOF {
		return errors.New("trailing JSON")
	}
	return nil
}
func run() error {
	root := flag.String("root", "", "new private offline plan root (or existing for inspect)")
	candidates := flag.String("candidate-root", "", "verified daily_candidates directory")
	draft := flag.String("draft", "", "reviewed source draft JSON")
	draftSHA := flag.String("draft-sha256", "", "independently reviewed draft SHA256")
	placement := flag.String("placement", "", "advisory placement JSON")
	placementSHA := flag.String("placement-sha256", "", "independently reviewed canonical placement SHA256")
	inventory := flag.String("inventory", "", "full protected archive-object inventory JSON array")
	inventorySHA := flag.String("inventory-sha256", "", "independently reviewed inventory file SHA256")
	producer := flag.String("producer-commit", "", "40-character verified producer commit")
	inspect := flag.String("inspect-plan-sha256", "", "inspect existing plan with expected exact SHA256; no network")
	flag.Parse()
	if flag.NArg() != 0 || *root == "" {
		return errors.New("--root required")
	}
	ctx := context.Background()
	var digest string
	if *inspect != "" {
		if *candidates != "" || *draft != "" || *draftSHA != "" || *placement != "" || *placementSHA != "" || *inventory != "" || *inventorySHA != "" || *producer != "" {
			return errors.New("inspect does not accept preparation inputs")
		}
		digest = *inspect
	} else {
		if *candidates == "" || *draft == "" || len(*draftSHA) != 64 || *placement == "" || len(*placementSHA) != 64 || *inventory == "" || len(*inventorySHA) != 64 || len(*producer) != 40 {
			return errors.New("all independently reviewed preparation inputs required")
		}
		b, e := readFile(*draft, *draftSHA, 2<<20)
		if e != nil {
			return e
		}
		pb, e := readFile(*placement, "", 16<<20)
		if e != nil {
			return e
		}
		var r legacy.PlacementReport
		if e = decode(pb, &r); e != nil {
			return e
		}
		ib, e := readFile(*inventory, *inventorySHA, 32<<20)
		if e != nil {
			return e
		}
		var base []legacy.ImportObject
		if e = decode(ib, &base); e != nil {
			return e
		}
		if base == nil {
			return errors.New("inventory must be explicit array")
		}
		digest, e = legacy.PrepareV66Import(ctx, *root, *candidates, b, *draftSHA, r, *placementSHA, base, *producer, time.Now())
		if e != nil {
			return e
		}
	}
	p, e := legacy.InspectV66Import(ctx, *root, digest)
	if e != nil {
		return e
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"status": "offline_plan_only", "plan_sha256": digest, "publication_approved": false, "days": len(p.Days), "held_days": p.HeldDays, "compressed_bytes": p.Bytes, "protected_objects": len(p.Baseline), "namespace": p.Namespace, "cutover_ms": p.CutoverMS, "producer": p.Producer})
}
func main() {
	if e := run(); e != nil {
		log.Fatal(fmt.Errorf("legacy-v66-plan: %w", e))
	}
}

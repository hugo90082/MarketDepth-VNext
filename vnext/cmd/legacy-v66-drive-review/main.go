//go:build linux && sqlite_integration

// Read-only review of stopped VNext roots and the existing Drive namespace.
// No publication command; OAuth token refresh is separate from Drive GETs.
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive/drive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/legacy"
)

type rootFlags []string

func (r *rootFlags) String() string     { return strings.Join(*r, ",") }
func (r *rootFlags) Set(s string) error { *r = append(*r, s); return nil }
func externalPath(p string, roots []string) error {
	if !filepath.IsAbs(p) || filepath.Clean(p) != p {
		return errors.New("absolute canonical path required")
	}
	for _, r := range roots {
		rel, e := filepath.Rel(r, p)
		if e != nil || rel == "." || rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			return errors.New("credential/state/output/lock must be outside data roots")
		}
	}
	return nil
}
func writeNew(p string, b []byte) error {
	f, e := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	_, e = f.Write(b)
	return errors.Join(e, f.Sync(), f.Close())
}
func hash(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func run(ctx context.Context) error {
	var roots rootFlags
	flag.Var(&roots, "stopped-root", "existing stopped VNext root (repeat for ALL roots in namespace)")
	creds := flag.String("credentials", "", "absolute private drive.file OAuth file outside data roots")
	state := flag.String("drive-state", "", "existing private durable reservation directory, outside data roots for this review")
	lock := flag.String("drive-lease-dir", "", "existing shared private namespace lock directory")
	cut := flag.Int64("cutover-ms", 0, "independently reviewed historical cutoff UTC epoch milliseconds")
	out := flag.String("out", "", "new private review output directory")
	flag.Parse()
	if flag.NArg() != 0 || len(roots) == 0 || *cut <= 0 || *cut > time.Now().UnixMilli() || *out == "" {
		return errors.New("all explicit stopped roots, cutoff and output required")
	}
	for _, p := range []string{*creds, *state, *lock, *out} {
		if e := externalPath(p, roots); e != nil {
			return e
		}
	}
	real, e := filepath.EvalSymlinks(*creds)
	if e != nil || real != *creds {
		return errors.New("unsafe credential path")
	}
	st, e := os.Lstat(*creds)
	if e != nil || st.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
		return errors.New("credentials must be owned by current user")
	}
	if _, e = os.Lstat(*out); !errors.Is(e, os.ErrNotExist) {
		return errors.New("fresh output required")
	}
	real, e = filepath.EvalSymlinks(filepath.Dir(*out))
	if e != nil || real != filepath.Dir(*out) {
		return errors.New("safe output parent required")
	}
	s, e := legacy.OpenStoppedDriveReview(ctx, *lock, roots)
	if e != nil {
		return e
	}
	defer s.Close()
	cred, e := drive.LoadCredentials(*creds)
	if e != nil {
		return e
	}
	token, e := drive.NewTokenSource(cred)
	if e != nil {
		return e
	}
	c, e := drive.NewClient(token, "MarketDepth-VNext-staging", *state)
	if e != nil {
		return e
	}
	days := []string{}
	d := time.Date(2026, 9, 20, 0, 0, 0, 0, time.FixedZone("UTC+8", 8*3600))
	for i := 0; i < 57; i++ {
		days = append(days, d.AddDate(0, 0, i).Format("2006-01-02"))
	}
	p, i, e := s.ReviewDrivePlacement(ctx, c.RecoveryReader(), days, *cut)
	if e != nil {
		return e
	}
	pb, ph, e := legacy.CanonicalPlacementReport(p)
	if e != nil {
		return e
	}
	ib, ih, e := legacy.CanonicalDriveInventory(i)
	if e != nil {
		return e
	}
	base, e := json.Marshal(i.Objects)
	if e != nil {
		return e
	}
	// The three immutable report files are only complete when summary.json exists.
	if e = os.Mkdir(*out, 0700); e != nil {
		return e
	}
	for _, f := range []struct {
		name string
		data []byte
	}{{"placement.json", pb}, {"drive-inventory.json", ib}, {"baseline.json", base}} {
		if e = writeNew(filepath.Join(*out, f.name), f.data); e != nil {
			return e
		}
	}
	summary := map[string]any{"status": "read_only_advisory", "publication_approved": false, "external_writer_fence_verified": false, "namespace": i.Namespace, "root_id": i.RootID, "stopped_roots": len(roots), "placement_sha256": ph, "inventory_sha256": ih, "baseline_sha256": hash(base), "objects": len(i.Objects), "folders": len(i.Folders), "free_bytes": i.FreeBytes, "cutover_ms": *cut, "visible_scope_only": true}
	b, e := json.Marshal(summary)
	if e != nil {
		return e
	}
	if e = writeNew(filepath.Join(*out, "summary.json"), b); e != nil {
		return e
	}
	dir, e := os.Open(*out)
	if e != nil {
		return e
	}
	if e = errors.Join(dir.Sync(), dir.Close()); e != nil {
		return e
	}
	parent, e := os.Open(filepath.Dir(*out))
	if e != nil {
		return e
	}
	if e = errors.Join(parent.Sync(), parent.Close()); e != nil {
		return e
	}
	fmt.Println(string(b))
	return nil
}
func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if e := run(ctx); e != nil {
		log.Fatal("legacy-v66-drive-review: ", e)
	}
}

//go:build linux && sqlite_integration

package legacy

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive/drive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

// Every eligible real day is rebuilt into a new archive, decompressed and
// independently validated; placement is deliberately synthetic, no network.
func TestRealV66SealedBuildBatch(t *testing.T) {
	root, path := os.Getenv("MD_REAL_CANDIDATE_ROOT"), os.Getenv("MD_REAL_V66_REVIEW_DRAFT")
	if root == "" || path == "" {
		t.Skip("offline real inputs required")
	}
	b, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	const expected = "e1a8d8feda9acc7fbecc4676a792f27929f96fd13069c1203995c57b6835c418"
	loc := time.FixedZone("UTC+8", 8*3600)
	a := time.Date(2026, 9, 20, 0, 0, 0, 0, loc)
	cut := time.Date(2026, 11, 14, 0, 0, 0, 0, loc).UnixMilli()
	r := PlacementReport{Version: "legacy-placement-review-v1", Namespace: "MarketDepth-VNext-staging", CutoverMS: cut, StartedAtMS: cut + 1000, FinishedAtMS: cut + 2000}
	for i := 0; i < 57; i++ {
		d := DayPlacement{Day: a.AddDate(0, 0, i).Format("2006-01-02"), LocalReasons: []string{}, RemoteObjects: []drive.PlacementObject{}, Status: "candidate_for_review"}
		if i >= 55 {
			d.LocalReasons = []string{"cutover_boundary_or_after"}
			d.Status = "blocked"
		}
		r.Days = append(r.Days, d)
	}
	_, ph, e := CanonicalPlacementReport(r)
	if e != nil {
		t.Fatal(e)
	}
	bound, e := BindV66Proofs(b, expected, r, ph)
	if e != nil || len(bound.Proofs) != 55 {
		t.Fatal(e)
	}
	start, end := 0, 55
	if v := os.Getenv("MD_REAL_V66_BATCH_START"); v != "" {
		start, e = strconv.Atoi(v)
		if e != nil {
			t.Fatal(e)
		}
	}
	if v := os.Getenv("MD_REAL_V66_BATCH_END"); v != "" {
		end, e = strconv.Atoi(v)
		if e != nil {
			t.Fatal(e)
		}
	}
	if start < 0 || end > 55 || start >= end {
		t.Fatal("batch bounds")
	}
	const reserve = 100_000_000
	ctx := context.Background()
	seal := time.UnixMilli(cut + 86400000)
	producer := strings.Repeat("c", 40)
	for _, held := range bound.HeldDays {
		if _, e := PrepareReviewedV66Day(ctx, b, expected, r, ph, held, strings.Repeat("a", 64), root, filepath.Join(t.TempDir(), "held"), producer, seal, reserve); e == nil {
			t.Fatal("held date accepted")
		}
	}
	for i := start; i < end; i++ {
		p := bound.Proofs[i]
		t.Run(p.Day, func(t *testing.T) {
			t.Parallel()
			_, digest, e := CanonicalLegacyProof(p)
			if e != nil {
				t.Fatal(e)
			}
			base := t.TempDir()
			s, e := PrepareReviewedV66Day(ctx, b, expected, r, ph, p.Day, digest, root, filepath.Join(base, "new"), producer, seal, reserve)
			if e != nil {
				t.Fatal(e)
			}
			f, e := os.Open(s.Path)
			if e != nil {
				t.Fatal(e)
			}
			defer f.Close()
			cache := filepath.Join(base, "cache")
			if e = os.Mkdir(cache, 0700); e != nil {
				t.Fatal(e)
			}
			m := s.Manifest
			m.FileID = "synthetic_local_verification"
			if _, e = store.RestoreVerifiedDay(ctx, m, f, cache, reserve); e != nil {
				t.Fatal(e)
			}
			out := map[string]any{"day": p.Day, "spot": p.UniqueSpot, "f1": p.UniqueFutures1m, "raw_bytes": m.RawSize, "gzip_bytes": m.Size, "proof": digest}
			j, _ := json.Marshal(out)
			t.Logf("LEGACY_DAY_QA %s", j)
		})
	}
}

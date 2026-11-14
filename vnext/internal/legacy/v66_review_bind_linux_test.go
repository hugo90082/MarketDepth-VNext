//go:build linux && sqlite_integration

package legacy

import (
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive/drive"
	"os"
	"testing"
	"time"
)

func TestRealV66DraftBindingSyntheticPlacement(t *testing.T) {
	path := os.Getenv("MD_REAL_V66_REVIEW_DRAFT")
	if path == "" {
		t.Skip("offline real draft required")
	}
	b, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	// Explicit synthetic observation: no claim about any real Drive or catalog.
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
	_, h, e := CanonicalPlacementReport(r)
	if e != nil {
		t.Fatal(e)
	}
	x, e := BindV66Proofs(b, hash(b), r, h)
	if e != nil || len(x.Proofs) != 55 || len(x.HeldDays) != 2 || x.PublicationApproved {
		t.Fatal(len(x.Proofs), e)
	}
	if _, e = BindV66Proofs(b, "bad", r, h); e == nil {
		t.Fatal("bad draft hash accepted")
	}
	if _, e = BindV66Proofs(b, hash(b), r, "bad"); e == nil {
		t.Fatal("bad placement hash accepted")
	}
	r.Days[0].LocalReasons = []string{"local_file_or_sidecar"}
	r.Days[0].Status = "blocked"
	_, h, e = CanonicalPlacementReport(r)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = BindV66Proofs(b, hash(b), r, h); e == nil {
		t.Fatal("collision accepted")
	}
	t.Log("55 real candidate source contributions bound to synthetic placement; 2 held; no production approval")
}

//go:build linux && sqlite_integration

package legacy

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

// PrepareReviewedV66Day binds a new local sealed file to the reviewed source
// draft, placement report and exact proof digest. This does not approve or
// publish anything. Real placement freshness/quiescence and upload permission
// remain independent gates. Held dates cannot be built through this adapter.
func PrepareReviewedV66Day(ctx context.Context, draft []byte, draftSHA string, placement PlacementReport, placementSHA, day, proofSHA, candidateRoot, stage, producer string, sealedAt time.Time, reserve int64) (store.SnapshotResult, error) {
	var zero store.SnapshotResult
	bound, e := BindV66Proofs(draft, draftSHA, placement, placementSHA)
	if e != nil {
		return zero, e
	}
	var d V66ProofDraft
	if e = json.Unmarshal(draft, &d); e != nil {
		return zero, e
	}
	for i, p := range bound.Proofs {
		if p.Day == day {
			_, digest, e := CanonicalLegacyProof(p)
			if e != nil || digest != proofSHA || d.Days[i].Day != day {
				return zero, errors.New("reviewed day proof digest differs")
			}
			return store.BuildReviewedLegacySnapshot(ctx, filepath.Join(candidateRoot, "days", "candidate-"+day+".sqlite"), d.Days[i].CandidateSHA, p, proofSHA, stage, producer, sealedAt, reserve)
		}
	}
	return zero, errors.New("day is not eligible in bound V66 review")
}

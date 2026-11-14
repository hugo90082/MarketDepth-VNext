//go:build linux && sqlite_integration

package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
)

type RecoveryDay struct {
	Day             string                    `json:"day"`
	Sealed          *archive.PublishedRecord  `json:"sealed,omitempty"`
	SealedRevisions []archive.PublishedRecord `json:"sealed_revisions,omitempty"`
	FullLoss        *LossState                `json:"full_loss,omitempty"`
	PartialLoss     *PartialLossState         `json:"partial_loss,omitempty"`
	LossObject      *archive.Object           `json:"loss_object,omitempty"`
	// Without a loss ledger or sealed day, these are candidates only. An
	// hourly backup's unknown tail is NOT a confirmed permanent loss.
	ActiveCandidate *archive.PublishedRecord `json:"active_candidate,omitempty"`
}

// InspectRecovery builds a deterministic metadata plan. A conflicting
// sealed/loss identity is a blocking inconsistency, not a heuristic choice.
// All selected snapshot data must be independently read back later.
func InspectRecovery(ctx context.Context, remote archive.RemoteObjects, objects []archive.Object) ([]RecoveryDay, error) {
	if remote == nil || len(objects) > 10000 {
		return nil, ErrUnavailable
	}
	days := map[string]*RecoveryDay{}
	seen, ids := map[string]bool{}, map[string]bool{}
	get := func(day string) *RecoveryDay {
		if days[day] == nil {
			days[day] = &RecoveryDay{Day: day}
		}
		return days[day]
	}
	var total int64
	for _, o := range objects {
		if o.Size <= 0 || o.Size > 2<<20 || total > 32<<20-o.Size {
			return nil, errors.New("recovery metadata budget exceeded")
		}
		total += o.Size
		if e := ctx.Err(); e != nil {
			return nil, e
		}
		if seen[o.Key] || ids[o.ID] {
			return nil, errors.New("duplicate recovery metadata identity")
		}
		seen[o.Key], ids[o.ID] = true, true
		switch {
		case strings.HasSuffix(o.Key, ".manifest.json"):
			rec, active, e := archive.ReadRecoveryManifest(ctx, remote, o)
			if e != nil {
				return nil, e
			}
			d := get(rec.Manifest.Day)
			if active {
				if d.ActiveCandidate == nil || rec.Manifest.Generation > d.ActiveCandidate.Manifest.Generation {
					x := rec
					d.ActiveCandidate = &x
				}
			} else {
				d.SealedRevisions = append(d.SealedRevisions, rec)
				if d.Sealed == nil || rec.Manifest.Revision > d.Sealed.Manifest.Revision {
					x := rec
					d.Sealed = &x
				}
			}
		case strings.HasPrefix(o.Key, "catalog/loss/") && strings.HasSuffix(o.Key, ".partial.json"):
			b, e := archive.ReadRecoveryMetadata(ctx, remote, o, 2<<20)
			if e != nil {
				return nil, e
			}
			var env partialLossEnvelope
			if json.Unmarshal(b, &env) != nil || env.ContractID != "MD-VNEXT-1" || env.Type != "partial_loss" {
				return nil, ErrUnavailable
			}
			key, raw, h, e := partialLossLedgerBytes(env.Loss)
			if e != nil || key != o.Key || h != o.SHA256 || !bytes.Equal(raw, b) {
				return nil, ErrUnavailable
			}
			d := get(env.Loss.Record.Day)
			if d.LossObject != nil {
				return nil, errors.New("conflicting loss ledgers")
			}
			x, y := env.Loss, o
			d.PartialLoss = &x
			d.LossObject = &y
		case strings.HasPrefix(o.Key, "catalog/loss/") && strings.HasSuffix(o.Key, ".json"):
			b, e := archive.ReadRecoveryMetadata(ctx, remote, o, 65536)
			if e != nil {
				return nil, e
			}
			var env lossEnvelope
			if json.Unmarshal(b, &env) != nil || env.ContractID != "MD-VNEXT-1" || env.Type != "permanent_loss" {
				return nil, ErrUnavailable
			}
			key, raw, h, e := lossLedgerBytes(env.Loss)
			if e != nil || key != o.Key || h != o.SHA256 || !bytes.Equal(raw, b) {
				return nil, ErrUnavailable
			}
			d := get(env.Loss.Record.Day)
			if d.LossObject != nil {
				return nil, errors.New("conflicting loss ledgers")
			}
			x, y := env.Loss, o
			d.FullLoss = &x
			d.LossObject = &y
		default:
			return nil, errors.New("unsupported recovery candidate")
		}
	}
	out := make([]RecoveryDay, 0, len(days))
	for _, d := range days {
		for _, rec := range d.SealedRevisions {
			if rec.Manifest.DataOrigin == "legacy" && (len(d.SealedRevisions) != 1 || d.ActiveCandidate != nil || d.FullLoss != nil || d.PartialLoss != nil) {
				return nil, errors.New("legacy day collides with another revision, active or loss")
			}
		}
		if d.Sealed != nil && (d.FullLoss != nil || d.PartialLoss != nil) || d.FullLoss != nil && d.ActiveCandidate != nil {
			return nil, errors.New("conflicting sealed or lost day")
		}
		if d.PartialLoss != nil {
			active := d.PartialLoss.Record.Active
			if d.ActiveCandidate == nil || d.ActiveCandidate.ManifestSHA256 != active.ManifestSHA256 {
				return nil, errors.New("partial loss active manifest missing or inconsistent")
			}
		}
		// A complete sealed day supersedes residual active generations, which
		// remain untouched. Do not import a stale active row into sealed history.
		if d.Sealed != nil || d.PartialLoss != nil {
			d.ActiveCandidate = nil
		}
		sort.Slice(d.SealedRevisions, func(i, j int) bool {
			return d.SealedRevisions[i].Manifest.Revision < d.SealedRevisions[j].Manifest.Revision
		})
		out = append(out, *d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Day < out[j].Day })
	return out, nil
}

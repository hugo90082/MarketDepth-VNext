package store

import (
	"encoding/json"
	"errors"
	"math"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// Active-day recovery only. Spot cannot be reconstructed from a current book.
// Recovery evidence is an internal collector assertion, not a user API input.
// The original row remains in the catalog's repair audit; sealed files need a
// separate immutable archive revision workflow.
func validateLiveWrite(r model.Row, allowRepair bool) error {
	c := r.Base()
	if c.Source == nil || *c.Source != model.LiveSource || c.AvailableAt == nil {
		return errors.New("live source and availability required")
	}
	if c.Revision == 1 {
		return nil
	}
	if !allowRepair || r.Kind() == model.Spot || c.Status != "recovered" || c.Quality == nil {
		return errors.New("only evidenced futures recovery in catalog mode")
	}
	var proof struct {
		Method      string `json:"repair_method"`
		Complete    bool   `json:"repair_complete"`
		RetrievedAt int64  `json:"retrieved_at"`
	}
	if json.Unmarshal([]byte(*c.Quality), &proof) != nil || !proof.Complete || proof.RetrievedAt < c.T+r.Kind().Interval() || proof.RetrievedAt > *c.AvailableAt {
		return errors.New("invalid recovery evidence")
	}
	// Require the complete data shape, even though the model's generic recovered
	// status also accommodates historical imports with different known fields.
	raw, e := json.Marshal(r)
	if e != nil {
		return e
	}
	v, e := model.Decode(r.Kind(), raw)
	if e != nil {
		return e
	}
	switch x := v.(type) {
	case *model.Futures1Row:
		if proof.Method != "official_rest_1m" {
			return errors.New("invalid 1m recovery method")
		}
		x.Status = "ok"
	case *model.Futures10Row:
		if proof.Method != "official_rest_aggtrade" {
			return errors.New("invalid 10s recovery method")
		}
		// Empty recovered bars are representable as recovered with explicit zero
		// counts and nil prices. Validate them under the same shape as empty.
		if x.AggCount != nil && *x.AggCount == 0 {
			x.Status = "empty"
		} else {
			x.Status = "ok"
			if x.FirstAggID == nil || x.LastAggID == nil || x.FirstTradeID == nil || x.LastTradeID == nil {
				return errors.New("recovery missing trade IDs")
			}
		}
	default:
		return errors.New("unsupported repair kind")
	}
	return v.Validate()
}
func validateRepair(old, new model.Row) error {
	if rowNil(old) || rowNil(new) || old.Kind() != new.Kind() || old.Key() != new.Key() {
		return errors.New("repair key mismatch")
	}
	a, b := old.Base(), new.Base()
	if a.Source == nil || *a.Source != model.LiveSource || a.AvailableAt == nil || b.AvailableAt == nil || a.Revision == math.MaxInt64 || b.Revision != a.Revision+1 || *b.AvailableAt < *a.AvailableAt {
		return errors.New("invalid repair revision or time")
	}
	if a.Status != "missing" && a.Status != "partial" {
		return errors.New("complete row is immutable")
	}
	return validateLiveWrite(new, true)
}

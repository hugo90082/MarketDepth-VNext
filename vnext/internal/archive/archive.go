// Package archive describes the later verified archive implementation; no cloud writes here.
package archive

import (
	"context"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/legacyproof"
	"io"
)

type Manifest struct {
	ContractID        string                      `json:"contract_id"`
	Day               string                      `json:"day"`
	Timezone          string                      `json:"timezone"`
	Revision          int64                       `json:"revision"`
	Generation        string                      `json:"generation"`
	FileID            string                      `json:"file_id"`
	SHA256            string                      `json:"sha256"`
	Size              int64                       `json:"size"`
	From              int64                       `json:"from"`
	To                int64                       `json:"to"`
	RowCounts         map[string]int64            `json:"row_counts"`
	DataOrigin        string                      `json:"data_origin"`
	ExpectedCounts    map[string]int64            `json:"expected_counts"`
	GridThrough       map[string]int64            `json:"grid_through_exclusive"`
	NullCounts        map[string]map[string]int64 `json:"null_counts"`
	MissingGridCounts map[string]int64            `json:"missing_grid_counts"`
	StatusCounts      map[string]map[string]int64 `json:"status_counts"`
	RawSize           int64                       `json:"raw_size"`
	RawSHA256         string                      `json:"raw_sha256"`
	ProducerCommit    string                      `json:"producer_commit"`
	LegacyProof       *legacyproof.LegacyDayProof `json:"legacy_proof,omitempty"`
	LegacyProofSHA256 string                      `json:"legacy_proof_sha256,omitempty"`
	SealedAt          *int64                      `json:"sealed_at"`
}

// Publish must verify data/hash before making a new manifest visible. Open returns verified bytes or an error.
type Repository interface {
	Publish(context.Context, Manifest, io.Reader) (Manifest, error)
	Open(context.Context, string, int64) (Manifest, io.ReadCloser, error)
}

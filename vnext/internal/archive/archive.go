// Package archive describes the later verified archive implementation; no cloud writes here.
package archive

import (
	"context"
	"io"
)

type Manifest struct {
	ContractID     string           `json:"contract_id"`
	Day            string           `json:"day"`
	Timezone       string           `json:"timezone"`
	Revision       int64            `json:"revision"`
	Generation     string           `json:"generation"`
	FileID         string           `json:"file_id"`
	SHA256         string           `json:"sha256"`
	Size           int64            `json:"size"`
	From           int64            `json:"from"`
	To             int64            `json:"to"`
	RowCounts      map[string]int64 `json:"row_counts"`
	ProducerCommit string           `json:"producer_commit"`
	SealedAt       *int64           `json:"sealed_at"`
}

// Publish must verify data/hash before making a new manifest visible. Open returns verified bytes or an error.
type Repository interface {
	Publish(context.Context, Manifest, io.Reader) (Manifest, error)
	Open(context.Context, string, int64) (Manifest, io.ReadCloser, error)
}

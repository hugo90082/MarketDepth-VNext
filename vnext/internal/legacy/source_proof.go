package legacy

import "github.com/hugo90082/MarketDepth-VNext/vnext/internal/legacyproof"

// Aliases preserve the existing proof wire format and call sites.
type SourceProof = legacyproof.SourceProof
type LegacyDayProof = legacyproof.LegacyDayProof

func CanonicalLegacyProof(p LegacyDayProof) ([]byte, string, error) {
	return legacyproof.CanonicalLegacyProof(p)
}

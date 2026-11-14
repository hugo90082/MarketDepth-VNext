package legacy

import (
 "encoding/json"
 "errors"
 "regexp"
 "time"
)

// SourceProof describes a reviewed day contribution, not evidence that the
// bytes have been independently verified. Counts are day-scoped occurrences;
// an original line can map to multiple rows in a future source-specific adapter.
type SourceProof struct {
 CompressedSHA256 string `json:"compressed_sha256"`
 UncompressedSHA256 string `json:"uncompressed_sha256"`
 MappingSHA256 string `json:"mapping_sha256"`
 AuditSHA256 string `json:"audit_sha256"`
 Adapter string `json:"adapter"`
 MappedOccurrences int64 `json:"mapped_occurrences"`
}

type LegacyDayProof struct {
 Version string `json:"version"`
 Day string `json:"day"`
 CutoverMS int64 `json:"cutover_ms"`
 Sources []SourceProof `json:"sources"`
 CanonicalRowsSHA256 string `json:"canonical_rows_sha256"`
 PlacementReportSHA256 string `json:"placement_report_sha256"`
 UniqueSpot int64 `json:"unique_spot"`
 UniqueFutures1m int64 `json:"unique_futures_1m"`
 DuplicateOccurrences int64 `json:"duplicate_occurrences"`
 Quarantined int64 `json:"quarantined"`
 Conflicts int64 `json:"conflicts"`
 UnknownAvailability int64 `json:"unknown_availability"`
}

// Proof is intentionally detached from the existing live archive manifest.
// V1 covers only a whole legacy day, without mixed revisions or guessed
// availability. Validation does not approve the mapping or authorize upload.
var adapterID=regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,127}$`)

func (p LegacyDayProof) Validate()error{
 if p.Version!="legacy-day-proof-v1"||!validHash(p.CanonicalRowsSHA256)||!validHash(p.PlacementReportSHA256){return errors.New("invalid legacy proof identity")}
 a,e:=time.ParseInLocation("2006-01-02",p.Day,time.FixedZone("UTC+8",8*3600))
 if e!=nil||a.Format("2006-01-02")!=p.Day||a.UnixMilli()<0||p.CutoverMS<a.Add(24*time.Hour).UnixMilli(){return errors.New("legacy proof crosses cutover")}
 if p.UniqueSpot<0||p.UniqueSpot>17280||p.UniqueFutures1m<0||p.UniqueFutures1m>4320||p.DuplicateOccurrences<0||p.DuplicateOccurrences>1000000000||p.Quarantined!=0||p.Conflicts!=0{return errors.New("invalid or unresolved legacy counts")}
 unique:=p.UniqueSpot+p.UniqueFutures1m
 if unique<=0||p.UnknownAvailability!=unique||len(p.Sources)==0||len(p.Sources)>1024{return errors.New("invalid legacy source or availability counts")}
 var total int64
 last:=""
 for _,s:=range p.Sources{
  if !validHash(s.CompressedSHA256)||!validHash(s.UncompressedSHA256)||!validHash(s.MappingSHA256)||!validHash(s.AuditSHA256)||!adapterID.MatchString(s.Adapter)||s.Adapter=="fixture-v1"||s.CompressedSHA256<=last||s.MappedOccurrences<=0||s.MappedOccurrences>1000000000{return errors.New("invalid, duplicate, unsorted or fixture source proof")}
  last=s.CompressedSHA256
  total+=s.MappedOccurrences
 }
 if total!=unique+p.DuplicateOccurrences{return errors.New("source occurrence accounting differs")}
 return nil
}

// CanonicalLegacyProof returns deterministic JSON bytes and digest, only
// after structural checks. The digest binds a proposal, not its truth.
func CanonicalLegacyProof(p LegacyDayProof)([]byte,string,error){
 if e:=p.Validate();e!=nil{return nil,"",e}
 b,e:=json.Marshal(p);if e!=nil{return nil,"",e}
 return b,hash(b),nil
}

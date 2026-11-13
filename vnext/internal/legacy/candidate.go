// Package legacy validates explicitly mapped historical candidates without writing
// live data. It does not infer a source adapter or approve a canonical row.
package legacy

import (
 "bytes"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "strings"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

const MaxRowBytes = 1 << 20

type Evidence struct {
 SourceSHA256 string
 RawSHA256 string
 Line int64
 Adapter string
}

type Candidate struct {
 Evidence Evidence
 Kind model.Kind
 Key model.Key
 Day string
 CanonicalJSON []byte
 SHA256 string
}

func validHash(s string) bool {
 if len(s)!=64 || strings.ToLower(s)!=s {return false}
 _,e:=hex.DecodeString(s);return e==nil
}

func hash(b []byte) string { h:=sha256.Sum256(b);return hex.EncodeToString(h[:]) }

// strictFields rejects duplicate, unknown (including case aliases) and omitted
// fields. Explicit null is distinct from an absent field. Nested quality_json
// is an opaque string checked by the shared model validator.
func strictFields(b []byte, expected map[string]json.RawMessage) error {
 d:=json.NewDecoder(bytes.NewReader(b))
 t,e:=d.Token();if e!=nil||t!=json.Delim('{'){return errors.New("row object required")}
 seen:=map[string]bool{}
 for d.More(){
  k,e:=d.Token();if e!=nil{return e}
  s,ok:=k.(string);if !ok{return errors.New("invalid field")}
  if _,ok=expected[s];!ok||seen[s]{return fmt.Errorf("unknown or duplicate field %q",s)}
  seen[s]=true
  var v json.RawMessage
  if e=d.Decode(&v);e!=nil{return e}
  switch s {case "t","asset","status","revision","venue":
   if bytes.Equal(bytes.TrimSpace(v),[]byte("null")){return fmt.Errorf("null required field %q",s)}
  }
 }
 t,e=d.Token();if e!=nil||t!=json.Delim('}'){return errors.New("invalid object end")}
 if _,e=d.Token();e!=io.EOF{return errors.New("trailing JSON")}
 if len(seen)!=len(expected){return errors.New("explicit complete row shape required")}
 return nil
}

// ValidateCandidate accepts a conservative initial legacy mapping only: spot
// and 1m, unknown availability, no claim of live or official closed status.
// Actual source adapters must establish field units and timestamp identity
// before calling it. F10 is intentionally unsupported, not synthesized.
func ValidateCandidate(ev Evidence, kind model.Kind, input []byte) (Candidate,error) {
 var c Candidate
 if !validHash(ev.SourceSHA256)||!validHash(ev.RawSHA256)||ev.Line<1||
  ev.Adapter==""||len(ev.Adapter)>128||strings.TrimSpace(ev.Adapter)!=ev.Adapter {
  return c,errors.New("invalid provenance")
 }
 if len(input)==0||len(input)>MaxRowBytes{return c,errors.New("row size limit")}
 var shape any
 switch kind {case model.Spot:shape=model.SpotRow{};case model.F1:shape=model.Futures1Row{};default:return c,errors.New("unsupported legacy kind")}
 b,e:=json.Marshal(shape);if e!=nil{return c,e}
 var expected map[string]json.RawMessage
 if e=json.Unmarshal(b,&expected);e!=nil{return c,e}
 if e=strictFields(input,expected);e!=nil{return c,e}
 row,e:=model.Decode(kind,input);if e!=nil{return c,e}
 base:=row.Base()
 if base.Status!="legacy_unknown"||base.AvailableAt!=nil||base.Revision!=1||
  base.Source==nil||*base.Source!="legacy:"+ev.Adapter {
  return c,errors.New("legacy status, availability, revision or source mismatch")
 }
 if s,ok:=row.(*model.SpotRow);ok&&s.CapturedAt!=nil&&*s.CapturedAt<0{return c,errors.New("invalid capture timestamp")}
 // The shared model allows very distant epoch values; bound the candidate to
 // the supported four-digit UTC+8 calendar before using a day path.
 day:=model.Day(base.T)
 if len(day)!=10{return c,errors.New("unsupported calendar date")}
 canonical,e:=json.Marshal(row);if e!=nil{return c,e}
 return Candidate{ev,kind,row.Key(),day,canonical,hash(canonical)},nil
}

type Relation string
const (
 DifferentKey Relation="different_key"
 Identical Relation="identical_candidate"
 Conflict Relation="conflict"
)

// Compare classifies independently validated candidates. No automatic winner,
// no revision assignment, and no overwrite of either source.
func Compare(a,b Candidate) Relation {
 if a.Kind!=b.Kind||a.Key!=b.Key{return DifferentKey}
 if a.SHA256==b.SHA256&&bytes.Equal(a.CanonicalJSON,b.CanonicalJSON){return Identical}
 return Conflict
}

//go:build sqlite_integration

package legacy

import (
 "context"
 "encoding/json"
 "errors"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// FixtureAdapter is intentionally NOT a production legacy format. It
// accepts only an explicit normalized envelope used for end-to-end QA.
const FixtureAdapter="fixture-v1"

func MapFixture(raw []byte)(model.Kind,[]byte,error){
 expected:=map[string]json.RawMessage{"kind":nil,"row":nil}
 if e:=strictFields(raw,expected);e!=nil{return "",nil,e}
 var v struct{
  Kind model.Kind `json:"kind"`
  Row json.RawMessage `json:"row"`
 }
 if e:=json.Unmarshal(raw,&v);e!=nil{return "",nil,e}
 if v.Kind!=model.Spot&&v.Kind!=model.F1{return "",nil,errors.New("unsupported fixture kind")}
 return v.Kind,v.Row,nil
}

// AddVerifiedFixture derives the row from the verified original bytes, not
// from a caller-supplied candidate or claimed evidence. No live publication.
func(l *Ledger)AddVerifiedFixture(ctx context.Context,s *RawStage,line int64)(Admission,error){
 ev,raw,e:=s.Line(ctx,line,FixtureAdapter);if e!=nil{return Admission{},e}
 k,b,e:=MapFixture(raw);if e!=nil{return Admission{},e}
 return l.Add(ctx,ev,k,b)
}

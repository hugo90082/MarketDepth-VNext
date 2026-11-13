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

// FixtureSummary is mapping QA, not a publication decision.
type FixtureSummary struct{
 Records int64
 Accepted int64
 Quarantined int64
}

// MapVerifiedFixture records an outcome for every original occurrence.
// A partial run remains building; it is not auto-resumed or published.
// Invalid candidate content is quarantined; storage/evidence errors abort.
func(l *Ledger)MapVerifiedFixture(ctx context.Context,s *RawStage)(FixtureSummary,error){
 var out FixtureSummary
 if s==nil{return out,errors.New("verified stage required")}
 out.Records=s.report.Records
 start,e:=l.db.BeginTx(ctx,nil);if e!=nil{return out,e}
 defer start.Rollback()
 var existing int64
 if e=start.QueryRowContext(ctx,"SELECT count(*) FROM candidate WHERE source_sha=?",s.report.CompressedSHA).Scan(&existing);e!=nil{return out,e}
 if existing!=0{return out,errors.New("source already has candidate rows")}
 if _,e=start.ExecContext(ctx,"INSERT INTO fixture_run VALUES(?,?,'building')",s.report.CompressedSHA,out.Records);e!=nil{return out,e}
 if e=start.Commit();e!=nil{return out,e}
 for line:=int64(1);line<=out.Records;line++{
  if e:=ctx.Err();e!=nil{return out,e}
  ev,raw,e:=s.Line(ctx,line,FixtureAdapter);if e!=nil{return out,e}
  k,b,e:=MapFixture(raw)
  if e==nil{_,e=ValidateCandidate(ev,k,b)}
  outcome,reason:="accepted",""
  if e!=nil{
   outcome,reason="quarantined",e.Error()
   out.Quarantined++
  }else{
   if _,e=l.Add(ctx,ev,k,b);e!=nil{return out,e}
   out.Accepted++
  }
  if _,e=l.db.ExecContext(ctx,"INSERT INTO fixture_audit VALUES(?,?,?,?,?)",ev.SourceSHA256,line,ev.RawSHA256,outcome,reason);e!=nil{return out,e}
 }
 tx,e:=l.db.BeginTx(ctx,nil);if e!=nil{return out,e}
 defer tx.Rollback()
 var count,accepted,quarantined int64
 if e=tx.QueryRowContext(ctx,`SELECT count(*),coalesce(sum(outcome='accepted'),0),coalesce(sum(outcome='quarantined'),0)
 FROM fixture_audit WHERE source_sha=?`,s.report.CompressedSHA).Scan(&count,&accepted,&quarantined);e!=nil{return out,e}
 if count!=out.Records||accepted!=out.Accepted||quarantined!=out.Quarantined||accepted+quarantined!=count{return out,errors.New("fixture audit count mismatch")}
 var candidateCount,matched int64
 if e=tx.QueryRowContext(ctx,"SELECT count(*) FROM candidate WHERE source_sha=?",s.report.CompressedSHA).Scan(&candidateCount);e!=nil{return out,e}
 if e=tx.QueryRowContext(ctx,`SELECT count(*) FROM candidate c JOIN fixture_audit a USING(source_sha,line_no) WHERE c.source_sha=? AND c.raw_sha=a.raw_sha AND c.adapter=? AND a.outcome='accepted'`,s.report.CompressedSHA,FixtureAdapter).Scan(&matched);e!=nil{return out,e}
 if candidateCount!=accepted||matched!=accepted{return out,errors.New("candidate audit mismatch")}
 if _,e=tx.ExecContext(ctx,"UPDATE fixture_run SET state='complete' WHERE source_sha=? AND state='building'",s.report.CompressedSHA);e!=nil{return out,e}
 if e=tx.Commit();e!=nil{return out,e}
 return out,nil
}

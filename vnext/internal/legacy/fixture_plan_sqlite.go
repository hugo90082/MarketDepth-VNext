//go:build sqlite_integration

package legacy

import (
 "bytes"
 "context"
 "database/sql"
 "errors"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

type FixturePlan struct {
 Occurrences int64
 UniqueKeys int64
 DuplicateOccurrences int64
}

// WalkFixturePlan verifies the complete single-source fixture ledger against
// its pinned raw stage and visits one candidate per exact key. Conflicts and
// quarantine are hard blockers. The visitor must not publish partial output.
// This is QA only; no real source format or cutover policy is approved.
func(l *Ledger)WalkFixturePlan(ctx context.Context,s *RawStage,visit func(Candidate)error)(FixturePlan,error){
 var out FixturePlan
 if s==nil{return out,errors.New("verified raw stage required")}
 tx,e:=l.db.BeginTx(ctx,&sql.TxOptions{ReadOnly:true});if e!=nil{return out,e}
 defer tx.Rollback()
 var state string
 var expected,n int64
 sha:=s.report.CompressedSHA
 if e=tx.QueryRowContext(ctx,"SELECT expected,state FROM fixture_run WHERE source_sha=?",sha).Scan(&expected,&state);e!=nil{return out,e}
 if state!="complete"||expected!=s.report.Records{return out,errors.New("fixture run incomplete")}
 for _,q:=range []string{
  "SELECT count(*) FROM fixture_run",
 }{
  if e=tx.QueryRowContext(ctx,q).Scan(&n);e!=nil{return out,e}
  if n!=1{return out,errors.New("single-source fixture plan required")}
 }
 var total,accepted,matched int64
 if e=tx.QueryRowContext(ctx,"SELECT count(*),coalesce(sum(source_sha=? AND outcome='accepted' AND reason=''),0) FROM fixture_audit",sha).Scan(&total,&accepted);e!=nil{return out,e}
 if total!=expected||accepted!=expected{return out,errors.New("quarantine or missing audit blocks fixture plan")}
 if e=tx.QueryRowContext(ctx,"SELECT count(*) FROM candidate").Scan(&n);e!=nil{return out,e}
 if n!=expected{return out,errors.New("candidate count mismatch")}
 if e=tx.QueryRowContext(ctx,`SELECT count(*) FROM candidate c JOIN fixture_audit a USING(source_sha,line_no)
 WHERE c.source_sha=? AND c.raw_sha=a.raw_sha AND c.adapter=? AND a.outcome='accepted'`,sha,FixtureAdapter).Scan(&matched);e!=nil{return out,e}
 if matched!=expected{return out,errors.New("candidate evidence mismatch")}
 var distinctLines int64
 if e=tx.QueryRowContext(ctx,"SELECT count(DISTINCT line_no) FROM candidate").Scan(&distinctLines);e!=nil{return out,e}
 if distinctLines!=expected{return out,errors.New("duplicate evidence line")}
 rows,e:=tx.QueryContext(ctx,`SELECT source_sha,raw_sha,line_no,adapter,kind,t,venue,asset,day,row_sha,row_json
 FROM candidate ORDER BY day,kind,t,venue,asset,source_sha,line_no,adapter`);if e!=nil{return out,e}
 defer rows.Close()
 var prev Candidate
 have:=false
 for rows.Next(){
  var ev Evidence
  var kind model.Kind
  var key model.Key
  var day,digest string
  var body []byte
  if e=rows.Scan(&ev.SourceSHA256,&ev.RawSHA256,&ev.Line,&ev.Adapter,&kind,&key.T,&key.Venue,&key.Asset,&day,&digest,&body);e!=nil{return out,e}
  verified,raw,e:=s.Line(ctx,ev.Line,FixtureAdapter);if e!=nil{return out,e}
  if ev!=verified{return out,errors.New("raw evidence differs")}
  k,b,e:=MapFixture(raw);if e!=nil{return out,e}
  c,e:=ValidateCandidate(verified,k,b);if e!=nil{return out,e}
  if c.Kind!=kind||c.Key!=key||c.Day!=day||c.SHA256!=digest||!bytes.Equal(c.CanonicalJSON,body){return out,errors.New("candidate differs from verified source")}
  out.Occurrences++
  if have&&prev.Kind==c.Kind&&prev.Key==c.Key{
   if Compare(prev,c)!=Identical{return out,errors.New("conflicting candidate blocks fixture plan")}
   out.DuplicateOccurrences++
   continue
  }
  if visit!=nil{if e=visit(c);e!=nil{return out,e}}
  out.UniqueKeys++
  prev=c;have=true
 }
 if e=rows.Err();e!=nil{return out,e}
 if out.Occurrences!=expected||out.UniqueKeys+out.DuplicateOccurrences!=expected{return out,errors.New("fixture plan count mismatch")}
 return out,nil
}

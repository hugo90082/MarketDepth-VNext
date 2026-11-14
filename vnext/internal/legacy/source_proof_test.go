package legacy

import (
 "strings"
 "testing"
 "time"
)

func proofFixture()LegacyDayProof{
 h:=func(s string)string{return strings.Repeat(s,64)}
 return LegacyDayProof{Version:"legacy-day-proof-v1",Day:"2026-11-10",
 CutoverMS:time.Date(2026,11,11,0,0,0,0,time.FixedZone("UTC+8",8*3600)).UnixMilli(),
 Sources:[]SourceProof{{h("a"),h("b"),h("c"),h("d"),"synthetic-proof-format",3}},
 CanonicalRowsSHA256:h("e"),PlacementReportSHA256:h("f"),UniqueSpot:1,UniqueFutures1m:1,DuplicateOccurrences:1,UnknownAvailability:2}
}
func TestLegacyDayProof(t *testing.T){
 p:=proofFixture()
 b,d,e:=CanonicalLegacyProof(p);if e!=nil||d!=hash(b){t.Fatal(d,e)}
 b2,d2,e:=CanonicalLegacyProof(p);if e!=nil||string(b2)!=string(b)||d2!=d{t.Fatal("nondeterministic proof")}
 for _,change:=range []func(*LegacyDayProof){
  func(p *LegacyDayProof){p.CutoverMS--},
  func(p *LegacyDayProof){p.UnknownAvailability--},
  func(p *LegacyDayProof){p.Sources[0].Adapter="fixture-v1"},
  func(p *LegacyDayProof){p.Sources[0].MappedOccurrences--},
  func(p *LegacyDayProof){p.Sources[0].AuditSHA256=""},
  func(p *LegacyDayProof){p.Sources=append(p.Sources,p.Sources[0])},
  func(p *LegacyDayProof){p.Quarantined=1},
  func(p *LegacyDayProof){p.Conflicts=1},
  func(p *LegacyDayProof){p.UniqueSpot=17281},
 }{
  q:=proofFixture();change(&q)
  if _,_,e=CanonicalLegacyProof(q);e==nil{t.Fatal("unsafe proof accepted",q)}
 }
}

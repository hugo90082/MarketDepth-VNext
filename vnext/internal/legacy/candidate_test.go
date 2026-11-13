package legacy

import (
 "encoding/json"
 "strings"
 "testing"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func evidence() Evidence {return Evidence{strings.Repeat("a",64),strings.Repeat("b",64),1,"fixture-v1"}}
func spot() model.SpotRow {
 return model.SpotRow{Common:model.Common{T:1794585600000,Asset:"BTC",Status:"legacy_unknown",Source:model.Ptr("legacy:fixture-v1"),Revision:1},Venue:"binance",Bid0100:model.Ptr(0.0)}
}
func encoded(t *testing.T,r any) []byte {t.Helper();b,e:=json.Marshal(r);if e!=nil{t.Fatal(e)};return b}
func TestCandidateNullZeroAndConflict(t *testing.T){
 a:=spot()
 c,e:=ValidateCandidate(evidence(),model.Spot,encoded(t,a));if e!=nil{t.Fatal(e)}
 if !strings.Contains(string(c.CanonicalJSON),`"bid_0_100":0`)||!strings.Contains(string(c.CanonicalJSON),`"ask_0_100":null`){t.Fatal("null/zero changed")}
 ev:=evidence();ev.Line=2
 d,e:=ValidateCandidate(ev,model.Spot,encoded(t,a));if e!=nil||Compare(c,d)!=Identical{t.Fatal("identical",e)}
 a.Bid0100=nil
 d,e=ValidateCandidate(ev,model.Spot,encoded(t,a));if e!=nil||Compare(c,d)!=Conflict{t.Fatal("null is not zero",e)}
 a.Asset="ETH"
 d,e=ValidateCandidate(ev,model.Spot,encoded(t,a));if e!=nil||Compare(c,d)!=DifferentKey{t.Fatal("different key",e)}
}
func TestCandidateRefusesUnsafeMapping(t *testing.T){
 for _,mut:=range []func(*model.SpotRow){
  func(r *model.SpotRow){r.T++},
  func(r *model.SpotRow){r.Asset="DOGE"},
  func(r *model.SpotRow){r.Venue="okx"},
  func(r *model.SpotRow){r.AvailableAt=model.Ptr(r.T)},
  func(r *model.SpotRow){r.Status="ok"},
  func(r *model.SpotRow){r.Source=model.Ptr(model.LiveSource)},
  func(r *model.SpotRow){r.Revision=2},
  func(r *model.SpotRow){r.Bid0100=model.Ptr(-1.0)},
  func(r *model.SpotRow){r.CapturedAt=model.Ptr(int64(-1))},
 } {
  a:=spot();mut(&a);if _,e:=ValidateCandidate(evidence(),model.Spot,encoded(t,a));e==nil{t.Fatalf("accepted invalid row: %+v",a)}
 }
 a:=spot();b:=string(encoded(t,a))
 for _,bad:=range []string{
  strings.Replace(b,`"ask_0_100":null,`,"",1),
  strings.Replace(b,`"t":`,`"T":`,1),
  strings.Replace(b,`"venue":`,`"unknown":`,1),
  strings.Replace(b,`"venue":"binance"`,`"venue":"binance","venue":"kraken"`,1),
  strings.Replace(b,`"revision":1`,`"revision":null`,1),
  b+" {}",
 }{if _,e:=ValidateCandidate(evidence(),model.Spot,[]byte(bad));e==nil{t.Fatalf("accepted %s",bad)}}
 ev:=evidence();ev.Line=0
 if _,e:=ValidateCandidate(ev,model.Spot,[]byte(b));e==nil{t.Fatal("missing line")}
 if _,e:=ValidateCandidate(evidence(),model.F10,[]byte(b));e==nil{t.Fatal("synthesized 10s")}
}
func TestLegacyMinuteNotOfficial(t *testing.T){
 r:=model.Futures1Row{Common:model.Common{T:spot().T,Asset:"BTC",Status:"legacy_unknown",Source:model.Ptr("legacy:fixture-v1"),Revision:1},Volume:model.Ptr(0.0),TradeCount:model.Ptr(int64(9007199254740993))}
 c,e:=ValidateCandidate(evidence(),model.F1,encoded(t,r));if e!=nil{t.Fatal(e)}
 if !strings.Contains(string(c.CanonicalJSON),"9007199254740993"){t.Fatal("integer precision lost")}
 r.Status="ok";if _,e=ValidateCandidate(evidence(),model.F1,encoded(t,r));e==nil{t.Fatal("legacy labeled official")}
}

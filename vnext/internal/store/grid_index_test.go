package store

import(
 "strings"
 "testing"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)
func TestGridIndexExactPresenceAndPagination(t *testing.T){
 day:="2026-11-13"
 a,_,e:=dayRange(day,day);if e!=nil{t.Fatal(e)}
 from:=a.UnixMilli()
 g,e:=NewGridIndex(day,1,strings.Repeat("a",64));if e!=nil{t.Fatal(e)}
 if len(g.Spot)+len(g.F10)+len(g.F1)!=5940{t.Fatal("wrong index size")}
 for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{
  step:=k.Interval()
  width:=gridWidth(k)
  for s:=0;s<width;s++{if e=g.Add(k,gridKey(k,from,s));e!=nil{t.Fatal(e)}}
  if e=g.Add(k,gridKey(k,from,0));e==nil{t.Fatal("duplicate accepted")}
  if e=g.Add(k,gridKey(k,from+1,0));e==nil{t.Fatal("off-grid accepted")}
  if g.Count(k)!=int64(width){t.Fatal("count mismatch")}
  // One selected key at the final grid, and complete first grid.
  if e=g.Add(k,gridKey(k,from+2*step,0));e!=nil{t.Fatal(e)}
  q:=Query{Kind:k,From:from,To:from+3*step,Limit:1}
  keys,e:=g.Keys(q,nil,1);if e!=nil||len(keys)!=1||keys[0]!=gridKey(k,from,0){t.Fatal(keys,e)}
  rest,e:=g.Keys(q,&keys[0],2001);if e!=nil||len(rest)!=width{t.Fatal(rest,e)}
  for i:=1;i<len(rest);i++{if !rest[i-1].Less(rest[i]){t.Fatal("unordered page")}}
  gaps,e:=g.Gaps(q);if e!=nil||len(gaps)!=1||gaps[0].From!=from+step||gaps[0].To!=q.To{t.Fatal(gaps,e)}
  q.Asset="BTC";if k==model.Spot{q.Venue="binance"}
  gaps,e=g.Gaps(q);if e!=nil||len(gaps)!=1||gaps[0].From!=from+step||gaps[0].To!=from+2*step{t.Fatal(gaps,e)}
  keys,e=g.Keys(q,nil,2001);if e!=nil||len(keys)!=2{t.Fatal(keys,e)}
 }
 if e=g.Add(model.F10,model.Key{T:from,Asset:"BTC",Venue:"binance"});e==nil{t.Fatal("wrong venue")}
 g.F1=nil
 if _,e=g.Keys(Query{Kind:model.F1,From:from,To:from+60000,Limit:1},nil,1);e==nil{t.Fatal("corrupt index accepted")}
}
func TestGridIndexFullDayCounts(t *testing.T){
 day:="2026-11-13";a,_,_:=dayRange(day,day);from:=a.UnixMilli()
 g,e:=NewGridIndex(day,2,strings.Repeat("b",64));if e!=nil{t.Fatal(e)}
 var total int64
 for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{
  for stamp:=from;stamp<from+86400000;stamp+=k.Interval(){
   for s:=0;s<gridWidth(k);s++{if e=g.Add(k,gridKey(k,stamp,s));e!=nil{t.Fatal(e)}}
  }
  total+=g.Count(k)
  q:=Query{Kind:k,From:from,To:from+86400000,Limit:2000}
  gaps,e:=g.Gaps(q);if e!=nil||len(gaps)!=0{t.Fatal(gaps,e)}
 }
 if total!=47520{t.Fatal(total)}
}

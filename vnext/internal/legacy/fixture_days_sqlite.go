//go:build sqlite_integration

package legacy

import (
 "context"
 "errors"
 "os"
 "path/filepath"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

const fixtureBuilding=".fixture-days-building"

type FixtureDays struct{
 Plan FixturePlan
 Days int64
}

// GenerateFixtureDays produces isolated QA files only. Preflight all evidence
// and conflicts before creating output; a second verified streaming pass
// writes one day at a time. Any failure leaves the building marker in place.
// The output is not a production archive and must not be published.
func(l *Ledger)GenerateFixtureDays(ctx context.Context,s *RawStage,root string)(FixtureDays,error){
 var out FixtureDays
 plan,e:=l.WalkFixturePlan(ctx,s,nil);if e!=nil{return out,e}
 if plan.UniqueKeys==0{return out,errors.New("empty fixture plan")}
 if e=os.Mkdir(root,0700);e!=nil{return out,e}
 marker:=filepath.Join(root,fixtureBuilding)
 f,e:=os.OpenFile(marker,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600);if e!=nil{return out,e}
 if _,e=f.WriteString("fixture-only incomplete\n");e!=nil{f.Close();return out,e}
 if e=f.Sync();e!=nil{f.Close();return out,e}
 if e=f.Close();e!=nil{return out,e}
 var writer *store.LegacyFixtureDay
 var day string
 defer func(){if writer!=nil{writer.Abort()}}()
 actual,e:=l.WalkFixturePlan(ctx,s,func(c Candidate)error{
  if c.Day!=day{
   if writer!=nil{if e:=writer.Finish(ctx);e!=nil{return e}}
   var e error
   writer,e=store.NewLegacyFixtureDay(ctx,root,c.Day);if e!=nil{return e}
   day=c.Day
   out.Days++
  }
  r,e:=model.Decode(c.Kind,c.CanonicalJSON);if e!=nil{return e}
  return writer.Put(ctx,r)
 })
 if e!=nil{return out,e}
 if actual!=plan||writer==nil{return out,errors.New("fixture plan changed")}
 if e=writer.Finish(ctx);e!=nil{return out,e}
 dir,e:=os.Open(root);if e!=nil{return out,e}
 defer dir.Close()
 if e=dir.Sync();e!=nil{return out,e}
 if e=os.Remove(marker);e!=nil{return out,e}
 if e=dir.Sync();e!=nil{return out,e}
 out.Plan=actual
 return out,nil
}

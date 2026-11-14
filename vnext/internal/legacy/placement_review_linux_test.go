//go:build linux && sqlite_integration

package legacy

import (
 "context"
 "errors"
 "testing"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive/drive"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

type testLocalPlacement struct{
 calls int
 changed bool
}
func(f *testLocalPlacement)InspectLegacyPlacement(_ context.Context,days []string,_ int64)([]store.LegacyPlacement,error){
 f.calls++
 out:=[]store.LegacyPlacement{}
 for _,day:=range days{
  p:=store.LegacyPlacement{Day:day,LocalClear:true,Reasons:[]string{}}
  if day=="2026-11-10"||(f.changed&&f.calls>1){p.LocalClear=false;p.Reasons=[]string{"local_file_or_sidecar"}}
  out=append(out,p)
 }
 return out,nil
}
type testRemotePlacement struct{
 namespace string
 objects []drive.PlacementObject
 err error
 calls int
}
func(f *testRemotePlacement)PlacementNamespace()string{return f.namespace}
func(f *testRemotePlacement)DiscoverPlacementObjects(context.Context)([]drive.PlacementObject,error){f.calls++;return f.objects,f.err}

func TestPlacementReview(t *testing.T){
 ctx:=context.Background()
 remote:=&testRemotePlacement{namespace:"MarketDepth-VNext-staging",objects:[]drive.PlacementObject{
  {Day:"2026-11-11",Key:"historical/2026/11/2026-11-11.r1.sqlite.gz",ID:"orphan"},
  {Day:"2026-11-10",Key:"catalog/loss/2026-11-10.json",ID:"loss"},
 }}
 local:=&testLocalPlacement{}
 days:=[]string{"2026-11-11","2026-11-09","2026-11-10"}
 report,e:=InspectPlacement(ctx,local,remote,days,1577836800000)
 if e!=nil||len(report.Days)!=3||report.PublicationApproved||local.calls!=2||remote.calls!=1{t.Fatal(report,e)}
 if report.Days[0].Status!="candidate_for_review"||report.Days[1].Status!="blocked"||report.Days[2].Status!="blocked"{t.Fatal(report)}
 if len(report.Days[1].LocalReasons)!=1||len(report.Days[1].RemoteObjects)!=1||len(report.Days[2].RemoteObjects)!=1{t.Fatal(report)}
}
func TestPlacementReviewFailsClosed(t *testing.T){
 ctx:=context.Background()
 for _,scenario:=range []string{"remote_failure","changing_local","wrong_namespace","duplicate","wrong_day"}{
  t.Run(scenario,func(t *testing.T){
   local:=&testLocalPlacement{}
   remote:=&testRemotePlacement{namespace:"MarketDepth-VNext-staging"}
   switch scenario{
   case "remote_failure":remote.err=errors.New("incomplete listing")
   case "changing_local":local.changed=true
   case "wrong_namespace":remote.namespace="production"
   case "duplicate":remote.objects=[]drive.PlacementObject{{Day:"2026-11-09",Key:"historical/2026/11/2026-11-09.r1.sqlite.gz",ID:"same"},{Day:"2026-11-09",Key:"historical/2026/11/2026-11-09.r1.manifest.json",ID:"same"}}
   case "wrong_day":remote.objects=[]drive.PlacementObject{{Day:"2026-11-09",Key:"catalog/loss/2026-11-10.json",ID:"bad"}}
   }
   if _,e:=InspectPlacement(ctx,local,remote,[]string{"2026-11-09"},1577836800000);e==nil{t.Fatal("unsafe review accepted")}
  })
 }
}

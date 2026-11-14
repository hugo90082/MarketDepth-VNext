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
  if day=="2020-11-10"||(f.changed&&f.calls>1){p.LocalClear=false;p.Reasons=[]string{"local_file_or_sidecar"}}
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
  {Day:"2020-11-11",Key:"historical/2020/11/2020-11-11.r1.sqlite.gz",ID:"orphan"},
  {Day:"2020-11-10",Key:"catalog/loss/2020-11-10.json",ID:"loss"},
 }}
 local:=&testLocalPlacement{}
 days:=[]string{"2020-11-11","2020-11-09","2020-11-10"}
 report,e:=InspectPlacement(ctx,local,remote,days,1605225600000)
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
   case "duplicate":remote.objects=[]drive.PlacementObject{{Day:"2020-11-09",Key:"historical/2020/11/2020-11-09.r1.sqlite.gz",ID:"same"},{Day:"2020-11-09",Key:"historical/2020/11/2020-11-09.r1.manifest.json",ID:"same"}}
   case "wrong_day":remote.objects=[]drive.PlacementObject{{Day:"2020-11-09",Key:"catalog/loss/2020-11-10.json",ID:"bad"}}
   }
   if _,e:=InspectPlacement(ctx,local,remote,[]string{"2020-11-09"},1605225600000);e==nil{t.Fatal("unsafe review accepted")}
  })
 }
}


func TestPlacementReportDigest(t *testing.T){
 local:=&testLocalPlacement{}
 remote:=&testRemotePlacement{namespace:"MarketDepth-VNext-staging"}
 report,e:=InspectPlacement(context.Background(),local,remote,[]string{"2020-11-09"},1605225600000)
 if e!=nil{t.Fatal(e)}
 b,h,e:=CanonicalPlacementReport(report);if e!=nil||h!=hash(b){t.Fatal(h,e)}
 report.PublicationApproved=true
 if _,_,e=CanonicalPlacementReport(report);e==nil{t.Fatal("approval accepted")}
 report.PublicationApproved=false
 report.Days[0].Status="blocked"
 if _,_,e=CanonicalPlacementReport(report);e==nil{t.Fatal("inconsistent disposition accepted")}
}


func TestMatchProofPlacement(t *testing.T){
 p:=proofFixture()
 p.Day="2020-11-09";p.CutoverMS=1605225600000
 local:=&testLocalPlacement{}
 remote:=&testRemotePlacement{namespace:"MarketDepth-VNext-staging"}
 report,e:=InspectPlacement(context.Background(),local,remote,[]string{p.Day},p.CutoverMS);if e!=nil{t.Fatal(e)}
 _,p.PlacementReportSHA256,e=CanonicalPlacementReport(report);if e!=nil{t.Fatal(e)}
 if e=MatchProofPlacement(p,report);e!=nil{t.Fatal(e)}
 p.PlacementReportSHA256=hash([]byte("different"))
 if e=MatchProofPlacement(p,report);e==nil{t.Fatal("wrong report hash accepted")}
 remote.objects=[]drive.PlacementObject{{Day:p.Day,Key:"catalog/loss/"+p.Day+".json",ID:"loss"}}
 report,e=InspectPlacement(context.Background(),local,remote,[]string{p.Day},p.CutoverMS);if e!=nil{t.Fatal(e)}
 _,p.PlacementReportSHA256,e=CanonicalPlacementReport(report);if e!=nil{t.Fatal(e)}
 if e=MatchProofPlacement(p,report);e==nil{t.Fatal("blocked day accepted")}
}

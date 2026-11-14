//go:build linux && sqlite_integration

package legacy

import (
 "context"
 "encoding/json"
 "errors"
 "path"
 "sort"
 "strings"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive/drive"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

type placementLocal interface {
 InspectLegacyPlacement(context.Context,[]string,int64)([]store.LegacyPlacement,error)
}
type placementRemote interface {
 PlacementNamespace()string
 DiscoverPlacementObjects(context.Context)([]drive.PlacementObject,error)
}

type DayPlacement struct {
 Day string `json:"day"`
 LocalReasons []string `json:"local_reasons"`
 RemoteObjects []drive.PlacementObject `json:"remote_objects"`
 Status string `json:"status"`
}

type PlacementReport struct {
 Version string `json:"version"`
 Namespace string `json:"namespace"`
 CutoverMS int64 `json:"cutover_ms"`
 StartedAtMS int64 `json:"started_at_ms"`
 FinishedAtMS int64 `json:"finished_at_ms"`
 Days []DayPlacement `json:"days"`
 ObservedRemoteCount int `json:"observed_remote_count"`
 PublicationApproved bool `json:"publication_approved"`
}

// InspectPlacement is a planning-only operation: it samples the local state
// before and after a complete scoped remote discovery. It never holds the
// collector locks across network calls. Even a clear result is advisory,
// not a reservation, a proof of quiescence, or an authorization to publish.
func InspectPlacement(ctx context.Context,local placementLocal,remote placementRemote,days []string,cutover int64)(PlacementReport,error){
 var zero PlacementReport
 if local==nil||remote==nil||remote.PlacementNamespace()!="MarketDepth-VNext-staging"||len(days)==0||len(days)>366||cutover<=0{return zero,errors.New("staging namespace, bounded days and cutover required")}
 started:=time.Now().UnixMilli()
 if cutover>started{return zero,errors.New("future cutover")}
 wanted:=append([]string(nil),days...)
 sort.Strings(wanted)
 for i,day:=range wanted{
  a,e:=time.Parse("2006-01-02",day)
  if e!=nil||a.Format("2006-01-02")!=day||(i>0&&wanted[i-1]==day){return zero,errors.New("invalid or duplicate requested day")}
 }
 before,e:=local.InspectLegacyPlacement(ctx,wanted,cutover);if e!=nil{return zero,e}
 objects,e:=remote.DiscoverPlacementObjects(ctx);if e!=nil{return zero,e}
 after,e:=local.InspectLegacyPlacement(ctx,wanted,cutover);if e!=nil{return zero,e}
 if e=ctx.Err();e!=nil{return zero,e}
 a,e:=json.Marshal(before);if e!=nil{return zero,e}
 b,e:=json.Marshal(after);if e!=nil{return zero,e}
 if string(a)!=string(b)||len(after)!=len(wanted)||remote.PlacementNamespace()!="MarketDepth-VNext-staging"{return zero,errors.New("placement inputs changed or incomplete")}
 if len(objects)>50000{return zero,errors.New("remote listing limit")}
 byDay:=map[string][]drive.PlacementObject{}
 seenKey,seenID:=map[string]bool{},map[string]bool{}
 for _,o:=range objects{
  stamp,e:=time.Parse("2006-01-02",o.Day)
  if e!=nil||stamp.Format("2006-01-02")!=o.Day||!strings.HasPrefix(path.Base(o.Key),o.Day+".")||o.ID==""||o.Key==""||seenKey[o.Key]||seenID[o.ID]{return zero,errors.New("invalid remote placement identity")}
  seenKey[o.Key],seenID[o.ID]=true,true
  byDay[o.Day]=append(byDay[o.Day],o)
 }
 out:=PlacementReport{Version:"legacy-placement-review-v1",Namespace:remote.PlacementNamespace(),CutoverMS:cutover,StartedAtMS:started,FinishedAtMS:time.Now().UnixMilli(),ObservedRemoteCount:len(objects)}
 for i,p:=range after{
  if p.Day!=wanted[i]||p.LocalClear!=(len(p.Reasons)==0){return zero,errors.New("local placement identity mismatch")}
  rs:=append([]string{},p.Reasons...)
  os:=append([]drive.PlacementObject{},byDay[p.Day]...)
  sort.Strings(rs)
  sort.Slice(os,func(i,j int)bool{return os[i].Key<os[j].Key})
  end,e:=time.ParseInLocation("2006-01-02",p.Day,time.FixedZone("UTC+8",8*3600));if e!=nil{return zero,e}
  if p.LocalClear&&end.Add(24*time.Hour).UnixMilli()>cutover{return zero,errors.New("local clear crosses cutover")}
  status:="candidate_for_review"
  if len(rs)>0||len(os)>0{status="blocked"}
  out.Days=append(out.Days,DayPlacement{p.Day,rs,os,status})
 }
 if _,_,e=CanonicalPlacementReport(out);e!=nil{return zero,e}
 return out,nil
}


// CanonicalPlacementReport binds the advisory observation to a stable hash.
// It rejects an inconsistent or purportedly approved report; it cannot
// verify that a caller-supplied observation is truthful or still current.
func CanonicalPlacementReport(r PlacementReport)([]byte,string,error){
 if r.Version!="legacy-placement-review-v1"||r.Namespace!="MarketDepth-VNext-staging"||r.PublicationApproved||r.CutoverMS<=0||r.StartedAtMS<r.CutoverMS||r.FinishedAtMS<r.StartedAtMS||len(r.Days)==0||len(r.Days)>366||r.ObservedRemoteCount<0||r.ObservedRemoteCount>50000{return nil,"",errors.New("invalid advisory report")}
 seenKey,seenID:=map[string]bool{},map[string]bool{}
 last:=""
 for _,d:=range r.Days{
  a,e:=time.ParseInLocation("2006-01-02",d.Day,time.FixedZone("UTC+8",8*3600))
  if e!=nil||a.Format("2006-01-02")!=d.Day||d.Day<=last||d.LocalReasons==nil||d.RemoteObjects==nil{return nil,"",errors.New("invalid report day")}
  last=d.Day
  blocked:=len(d.LocalReasons)>0||len(d.RemoteObjects)>0
  if (blocked&&d.Status!="blocked")||(!blocked&&d.Status!="candidate_for_review")||(!blocked&&a.Add(24*time.Hour).UnixMilli()>r.CutoverMS){return nil,"",errors.New("invalid placement disposition")}
  prior:=""
  for _,s:=range d.LocalReasons{
   if s<=prior{return nil,"",errors.New("invalid local reasons")}
   prior=s
  }
  prior=""
  for _,o:=range d.RemoteObjects{
   if o.Day!=d.Day||!strings.HasPrefix(path.Base(o.Key),d.Day+".")||o.Key<=prior||o.ID==""||seenID[o.ID]||seenKey[o.Key]{return nil,"",errors.New("invalid remote observation")}
   prior=o.Key;seenID[o.ID],seenKey[o.Key]=true,true
  }
 }
 if len(seenKey)>r.ObservedRemoteCount{return nil,"",errors.New("inconsistent remote count")}
 b,e:=json.Marshal(r);if e!=nil{return nil,"",e}
 return b,hash(b),nil
}


// MatchProofPlacement binds the detached source proof to the specific
// advisory observation and checks its day and cutover. No publication grant.
func MatchProofPlacement(p LegacyDayProof,r PlacementReport)error{
 if e:=p.Validate();e!=nil{return e}
 _,digest,e:=CanonicalPlacementReport(r);if e!=nil{return e}
 if digest!=p.PlacementReportSHA256||p.CutoverMS!=r.CutoverMS{return errors.New("proof placement digest or cutover differs")}
 for _,d:=range r.Days{
  if d.Day==p.Day{
   if d.Status!="candidate_for_review"{return errors.New("proof day placement blocked")}
   return nil
  }
 }
 return errors.New("proof day absent from placement report")
}

//go:build linux && sqlite_integration

package store

import (
 "context"
 "errors"
 "os"
 "sort"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// LegacyPlacement is a read-only local collision assessment. "local_clear"
// is not permission to import: remote namespace, source mapping, cutover
// approval, and publication revalidation are still mandatory.
type LegacyPlacement struct {
 Day string `json:"day"`
 Reasons []string `json:"reasons"`
 LocalClear bool `json:"local_clear"`
}

const maxPlacementDays=366

// InspectLegacyPlacement rejects uncertain catalog state and reports all
// observed local collisions. Whole-day imports are only candidates before
// the explicit cutover and outside the current grace window. It never
// assigns archive revisions, merges rows, or writes a file or catalog.
func(j *Journal)InspectLegacyPlacement(ctx context.Context,days []string,cutover int64)([]LegacyPlacement,error){
 if len(days)==0||len(days)>maxPlacementDays||cutover<=0{return nil,errors.New("explicit bounded days and cutover required")}
 target,ok:=j.target.(managerJournalTarget);if !ok{return nil,errors.New("manager catalog required")}
 ordered:=append([]string(nil),days...)
 sort.Strings(ordered)
 loc:=time.FixedZone("UTC+8",8*3600)
 bounds:=map[string]time.Time{}
 for _,day:=range ordered{
  a,e:=time.ParseInLocation("2006-01-02",day,loc)
  if e!=nil||a.Format("2006-01-02")!=day||a.UnixMilli()<0{return nil,errors.New("invalid placement day")}
  if _,ok=bounds[day];ok{return nil,errors.New("duplicate placement day")}
  bounds[day]=a
 }
 j.archiveMu.Lock();defer j.archiveMu.Unlock()
 j.mu.Lock();defer j.mu.Unlock()
 if e:=j.ready(ctx);e!=nil{return nil,e}
 if p,e:=j.archivePending(ctx);e!=nil||p!=nil{return nil,errors.New("pending or unreadable archive blocks placement")}
 m:=target.m
 m.mu.Lock();defer m.mu.Unlock()
 if m.closed||!m.catalogOpened{return nil,errors.New("catalog manager unavailable")}
 now:=m.now()
 if cutover>now.UnixMilli(){return nil,errors.New("future cutover not assessable")}
 reasons:=map[string]map[string]bool{}
 for _,day:=range ordered{
  reasons[day]=map[string]bool{}
  a:=bounds[day]
  if a.Add(24*time.Hour).UnixMilli()>cutover{reasons[day]["cutover_boundary_or_after"]=true}
  if now.Before(a.Add(24*time.Hour).Add(m.grace)){reasons[day]["active_or_grace"]=true}
  p,e:=m.path(day);if e!=nil{return nil,e}
  for _,suffix:=range []string{"","-wal","-shm","-journal"}{
   if st,e:=os.Lstat(p+suffix);e==nil{
    if !st.Mode().IsRegular(){return nil,errors.New("unsafe local day path")}
    reasons[day]["local_file_or_sidecar"]=true
   }else if !errors.Is(e,os.ErrNotExist){return nil,e}
  }
 }
 // Include every day-bearing durable catalog table, not just the latest
 // archive revision or visible history. Loss tombstones are collisions too.
 for _,table:=range []string{"journal_archive","journal_active","journal_active_recovery","journal_compact","journal_loss","journal_partial_loss","journal_loss_sync","journal_recovered_active"}{
  rows,e:=j.db.QueryContext(ctx,"SELECT DISTINCT day FROM "+table);if e!=nil{return nil,e}
  for rows.Next(){
   var day string
   if e=rows.Scan(&day);e!=nil{rows.Close();return nil,e}
   if rs,ok:=reasons[day];ok{rs[table]=true}
  }
  e=rows.Err();rows.Close();if e!=nil{return nil,e}
 }
 // A stray change/repair pointer with no local file is still an occupied
 // key range. Scan each table once, not once per candidate date.
 for _,table:=range []string{"journal_change","journal_repair"}{
  rows,e:=j.db.QueryContext(ctx,"SELECT DISTINCT t FROM "+table+" WHERE t>=? AND t<?",bounds[ordered[0]].UnixMilli(),bounds[ordered[len(ordered)-1]].Add(24*time.Hour).UnixMilli());if e!=nil{return nil,e}
  for rows.Next(){
   var t int64
   if e=rows.Scan(&t);e!=nil{rows.Close();return nil,e}
   if rs,ok:=reasons[model.Day(t)];ok{rs[table]=true}
  }
  e=rows.Err();rows.Close();if e!=nil{return nil,e}
 }
 out:=make([]LegacyPlacement,0,len(ordered))
 for _,day:=range ordered{
  rs:=make([]string,0,len(reasons[day]))
  for reason:=range reasons[day]{rs=append(rs,reason)}
  sort.Strings(rs)
  out=append(out,LegacyPlacement{day,rs,len(rs)==0})
 }
 return out,nil
}


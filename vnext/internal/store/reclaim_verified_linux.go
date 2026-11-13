//go:build linux && sqlite_integration

package store

import (
 "context"
 "database/sql"
 "errors"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// ReclaimVerifiedCycle removes at most one old, verified local day, after
// its hourly generations have been retired. The original archive worker
// finishes uploads first. Keep the newest local day of each kind so Latest
// remains a local operation even across an interrupted feed or midnight.
// No unverified day, remote historical file or journal entry is removed.
func (r *ArchiveReader) ReclaimVerifiedCycle(ctx context.Context)(string,error){
 j,m:=r.j,r.target.m
 days,e:=m.archiveDays()
 if e!=nil{return "",e}
 now:=m.now()
 // Collect last known committed day per kind under a short journal lock.
 latest:=map[string]bool{}
 var protected string
 e=func()error{
  j.mu.Lock()
  defer j.mu.Unlock()
  if e:=j.ready(ctx);e!=nil{return e}
  if p,e:=j.archivePending(ctx);e!=nil{return e}else if p!=nil{protected=p.Snapshot.Manifest.Day}
  for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{
   var stamp sql.NullInt64
   if e:=j.db.QueryRowContext(ctx,"SELECT MAX(t) FROM journal_change WHERE kind=?",k).Scan(&stamp);e!=nil{return e}
   if stamp.Valid{latest[model.Day(stamp.Int64)]=true}
  }
  return nil
 }()
 if e!=nil{return "",e}
 for _,day:=range days{
  if e=ctx.Err();e!=nil{return "",e}
  a,_,e:=dayRange(day,day);if e!=nil{return "",e}
  if now.Before(a.Add(24*time.Hour+m.grace))||latest[day]||day==protected{continue}
  if _,e=j.ArchiveRecord(ctx,day,0);errors.Is(e,sql.ErrNoRows){continue}else if e!=nil{return "",e}
  if _,e=j.ActiveState(ctx,day);e==nil{continue}else if !errors.Is(e,sql.ErrNoRows){return "",e}
  if e=r.EvictVerifiedLocalDay(ctx,day);e!=nil{return "",e}
  return "local_reclaimed",nil
 }
 return "idle",nil
}

//go:build linux && sqlite_integration

package store

import(
 "context"
 "database/sql"
 "errors"
 "time"
)

// ForceLossCycle performs at most one last-resort local eviction, only
// when an external capacity coordinator has measured pressure and provided
// an emergency reservation. This method does no network I/O. It never
// abandons the exact pending upload, even during prolonged Drive outage.
// Not yet wired into automatic staging execution.
func(w *ArchiveWorker) ForceLossCycle(ctx context.Context,reserve ArchiveReserve,budget int64)(string,error){
 if reserve==nil||budget<=0{return "",ErrUnavailable}
 if !w.mu.TryLock(){return "maintenance_busy",nil}
 defer w.mu.Unlock()
 if e:=ctx.Err();e!=nil{return "",e}
 pending,e:=w.j.ArchivePending(ctx);if e!=nil{return "",e}
 days,e:=w.m.archiveDays();if e!=nil{return "",e}
 now:=w.m.now()
 for _,day:=range days{
  if e=ctx.Err();e!=nil{return "",e}
  a,_,e:=dayRange(day,day);if e!=nil{return "",e}
  if now.Before(a.Add(24*time.Hour+w.m.grace))||pending!=nil&&pending.Snapshot.Manifest.Day==day{continue}
  w.j.mu.Lock();newest,e:=w.j.newestDayLocked(ctx,day);w.j.mu.Unlock()
  if e!=nil{return "",e};if newest{continue}
  // A registered sealed archive must use the verified reclamation path,
  // never a forced-loss tombstone. Its local copy remains if recheck fails.
  if _,e=w.j.ArchiveRecord(ctx,day,0);e==nil{continue}else if !errors.Is(e,sql.ErrNoRows){return "",e}
  partial:=false
  if _,e=w.j.ActiveState(ctx,day);e==nil{
   if _,e=w.j.ActiveRecovery(ctx,day);e!=nil{
    // Cannot prove the exact recoverable keys; protect this day.
    continue
   }
   partial=true
  }else if !errors.Is(e,sql.ErrNoRows){return "",e}
  release,e:=reserve(ctx,budget);if e!=nil{return "",e}
  e=func()error{
   defer release()
   // Local sealing is safe after grace even without Drive. It checkpoints
   // WAL and prevents late mutation before the durable loss intent.
   if _,e:=w.j.SealDay(ctx,day,w.producer);e!=nil{return e}
   if partial{return w.j.EvictPartialDay(ctx,day)}
   return w.j.EvictUnbackedDay(ctx,day)
  }()
  if e!=nil{return "",e}
  if partial{return "partial_loss_reclaimed",nil}
  return "permanent_loss_reclaimed",nil
 }
 return "no_safe_loss_candidate",nil
}

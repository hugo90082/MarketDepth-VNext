//go:build linux && sqlite_integration

package store

import(
 "context"
 "crypto/rand"
 "database/sql"
 "encoding/hex"
 "encoding/json"
 "errors"
 "net/url"
 "os"
 "strings"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// preparePartialLossLocked runs only for an old sealed local day. Both
// journal and manager locks are held; no network is used. The current
// active recovery evidence was generated during a previous verified upload.
func(j *Journal) preparePartialLossLocked(ctx context.Context,m *Manager,day string)(PartialLossRecord,error){
 var out PartialLossRecord
 if e:=j.ready(ctx);e!=nil{return out,e}
 a,_,e:=dayRange(day,day);if e!=nil{return out,e}
 if m.closed||!m.catalogOpened||m.now().Before(a.Add(24*time.Hour+m.grace))||(m.daily!=nil&&m.daily.day==day){return out,errors.New("active or grace day protected")}
 if newest,e:=j.newestDayLocked(ctx,day);e!=nil{return out,e}else if newest{return out,errors.New("latest day protected")}
 if pending,e:=j.archivePending(ctx);e!=nil{return out,e}else if pending!=nil&&pending.Snapshot.Manifest.Day==day{return out,ErrArchivePending}
 for _,table:=range []string{"journal_archive","journal_loss","journal_partial_loss","journal_compact"}{
  var n int
  if e=j.db.QueryRowContext(ctx,"SELECT COUNT(*) FROM "+table+" WHERE day=?",day).Scan(&n);e!=nil{return out,e}
  if n!=0{return out,errors.New("day already sealed remotely or has loss record")}
 }
 s,e:=j.activeState(ctx,day);if e!=nil{return out,e}
 evidence,e:=j.activeRecoveryForLocked(ctx,s.Current);if e!=nil{return out,e}
 p,e:=m.path(day);if e!=nil{return out,e}
 if e=checkLossSidecars(p);e!=nil{return out,e}
 details,e:=checkSnapshot(ctx,p,day);if e!=nil{return out,e}
 if details.sealed==nil||details.revision!=s.Current.Manifest.Revision{return out,ErrUnavailable}
 if e=checkLossSidecars(p);e!=nil{return out,e}
 digest,e:=sealedLogicalDigest(ctx,p,day);if e!=nil{return out,e}
 recovered,e:=NewGridIndex(day,details.revision,s.Current.ManifestSHA256);if e!=nil{return out,e}
 lost,e:=NewGridIndex(day,details.revision,s.Current.ManifestSHA256);if e!=nil{return out,e}
 u:=url.URL{Scheme:"file",Path:p};q:=u.Query();q.Set("mode","ro");q.Set("immutable","1");q.Set("_query_only","1");u.RawQuery=q.Encode()
 db,e:=sql.Open("sqlite3",u.String());if e!=nil{return out,e}
 defer db.Close();db.SetMaxOpenConns(1)
 from,to:=a.UnixMilli(),a.Add(24*time.Hour).UnixMilli()
 for _,kind:=range []model.Kind{model.Spot,model.F10,model.F1}{
  var after *model.Key
  for{
   where:="c.kind=? AND c.t>=? AND c.t<?";args:=[]any{kind,from,to}
   if after!=nil{where+=" AND (c.t,c.venue,c.asset)>(?,?,?)";args=append(args,after.T,after.Venue,after.Asset)}
   ptr,e:=j.readPointers(ctx,kind,where,args,256);if e!=nil{return out,e}
   for _,v:=range ptr{
    row,e:=readRow(ctx,db,kind,v.key)
    if e!=nil||rowNil(row)||row.Key()!=v.key||row.Base().Revision!=v.rev{return out,ErrUnavailable}
    h,e:=journalHash(row);if e!=nil||h!=v.hash{return out,ErrUnavailable}
    saved,e:=evidence.HashAt(kind,v.key);if e!=nil{return out,e}
    dest:=lost
    if saved==h{dest=recovered}
    if e=dest.Add(kind,v.key);e!=nil{return out,e}
   }
   if len(ptr)<256{break}
   k:=ptr[len(ptr)-1].key;after=&k
  }
 }
 if e=db.Close();e!=nil{return out,e}
 out=PartialLossRecord{Day:day,From:from,To:to,RowCounts:details.counts,Revision:details.revision,LogicalSHA256:digest,Reason:"capacity_forced_partial_loss",RecordedAt:m.now().UnixMilli(),Active:s.Current,Recoverable:*recovered,Lost:*lost}
 if e=validatePartialLoss(out);e!=nil{return PartialLossRecord{},e}
 b,e:=json.Marshal(out);if e!=nil||len(b)>2<<20{return PartialLossRecord{},ErrUnavailable}
 if _,e=j.db.ExecContext(ctx,"INSERT INTO journal_partial_loss(day,from_t,to_t,record_json,state) VALUES(?,?,?,?,'prepared')",day,from,to,b);e!=nil{return PartialLossRecord{},e}
 return out,nil
}

func deleteLostKeys(ctx context.Context,tx *sql.Tx,r PartialLossRecord)error{
 for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{
  q:=Query{Kind:k,From:r.From,To:r.To,Limit:100}
  var after *model.Key
  for{
   keys,e:=r.Lost.Keys(q,after,100);if e!=nil{return e}
   if len(keys)==0{break}
   args:=make([]any,0,4*len(keys));marks:=make([]string,0,len(keys))
   for _,key:=range keys{marks=append(marks,"(?,?,?,?)");args=append(args,k,key.T,key.Venue,key.Asset)}
   res,e:=tx.ExecContext(ctx,"DELETE FROM journal_change WHERE (kind,t,venue,asset) IN ("+strings.Join(marks,",")+")",args...)
   if e!=nil{return e}
   n,e:=res.RowsAffected();if e!=nil||n<int64(len(keys)){return ErrPendingLoss}
   last:=keys[len(keys)-1];after=&last
  }
  var n int64
  if e:=tx.QueryRowContext(ctx,"SELECT COUNT(*) FROM journal_change c WHERE c.kind=? AND c.t>=? AND c.t<? AND "+latestOnly,k,r.From,r.To).Scan(&n);e!=nil||n!=r.Recoverable.Count(k){return ErrPendingLoss}
 }
 return nil
}
func(j *Journal) finalizePartialLossLocked(ctx context.Context,r PartialLossRecord,completed int64)error{
 if completed<r.RecordedAt{completed=r.RecordedAt}
 var seed [16]byte
 if _,e:=rand.Read(seed[:]);e!=nil{return e}
 generation:=hex.EncodeToString(seed[:])
 b,e:=json.Marshal(r);if e!=nil{return e}
 tx,e:=j.db.BeginTx(ctx,nil);if e!=nil{return e}
 defer tx.Rollback()
 res,e:=tx.ExecContext(ctx,"UPDATE journal_partial_loss SET state='removed',completed_at=? WHERE day=? AND state='prepared' AND record_json=?",completed,r.Day,b)
 if e!=nil{return e}
 if n,e:=res.RowsAffected();e!=nil||n!=1{return ErrPendingLoss}
 if e=deleteLostKeys(ctx,tx,r);e!=nil{return e}
 if _,e=tx.ExecContext(ctx,"UPDATE journal_meta SET value=? WHERE key='generation'",generation);e!=nil{return e}
 if e=tx.Commit();e!=nil{return e}
 j.generation=generation
 return nil
}

// EvictPartialDay is an explicit, unscheduled pressure-only primitive.
// No remote deletion, no network, no loss of a protected pending snapshot.
// Keep pointers for exactly matching snapshot rows, remove only lost keys.
func(j *Journal) EvictPartialDay(ctx context.Context,day string)error{
 target,ok:=j.target.(managerJournalTarget);if !ok{return ErrUnavailable}
 m:=target.m
 j.archiveMu.Lock();defer j.archiveMu.Unlock()
 j.mu.Lock();defer j.mu.Unlock()
 m.mu.Lock();defer m.mu.Unlock()
 r,e:=j.preparePartialLossLocked(ctx,m,day);if e!=nil{return e}
 p,e:=m.path(day);if e!=nil{return e}
 if e=ctx.Err();e!=nil{return e}
 for _,s:=range []string{"-wal","-shm"}{if e=os.Remove(p+s);e!=nil&&!errors.Is(e,os.ErrNotExist){return e}}
 if e=os.Remove(p);e!=nil{return e}
 if e=syncLossDir(m.root);e!=nil{return e}
 return j.finalizePartialLossLocked(ctx,r,m.now().UnixMilli())
}

// Recovery is identical in authority to full-day loss: preserve an
// unchanged surviving DB; otherwise finalize only the already recorded
// partition if its exact active snapshot still matches the catalog.
func(j *Journal) RecoverPartialLoss(ctx context.Context)error{
 target,ok:=j.target.(managerJournalTarget);if !ok{return ErrUnavailable}
 m:=target.m
 j.archiveMu.Lock();defer j.archiveMu.Unlock()
 j.mu.Lock();defer j.mu.Unlock()
 m.mu.Lock();defer m.mu.Unlock()
 var day string
 e:=j.db.QueryRowContext(ctx,"SELECT day FROM journal_partial_loss WHERE state='prepared'").Scan(&day)
 if errors.Is(e,sql.ErrNoRows){return nil};if e!=nil{return e}
 var n int
 if e=j.db.QueryRowContext(ctx,"SELECT COUNT(*) FROM journal_partial_loss WHERE state='prepared'").Scan(&n);e!=nil||n!=1{return ErrPendingLoss}
 if b,e:=j.pending(ctx);e!=nil{return e}else if b!=nil{return ErrPendingWrite}
 if p,e:=j.archivePending(ctx);e!=nil{return e}else if p!=nil&&p.Snapshot.Manifest.Day==day{return ErrArchivePending}
 state,e:=j.partialLossLocked(ctx,day);if e!=nil{return e}
 s,e:=j.activeState(ctx,day);if e!=nil||s.Current.ManifestSHA256!=state.Record.Active.ManifestSHA256{return ErrPendingLoss}
 p,e:=m.path(day);if e!=nil{return e}
 if _,e=os.Lstat(p);e==nil{
  if e=checkLossSidecars(p);e!=nil{return e}
  digest,e:=sealedLogicalDigest(ctx,p,day);if e!=nil||digest!=state.Record.LogicalSHA256{return ErrPendingLoss}
  _,e=j.db.ExecContext(ctx,"DELETE FROM journal_partial_loss WHERE day=? AND state='prepared'",day);return e
 }else if !errors.Is(e,os.ErrNotExist){return e}
 for _,suffix:=range []string{"-wal","-shm"}{if _,e=os.Lstat(p+suffix);!errors.Is(e,os.ErrNotExist){return ErrPendingLoss}}
 if e=syncLossDir(m.root);e!=nil{return e}
 return j.finalizePartialLossLocked(ctx,state.Record,m.now().UnixMilli())
}

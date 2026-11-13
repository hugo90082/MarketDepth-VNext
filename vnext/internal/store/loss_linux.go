//go:build linux && sqlite_integration

package store

import(
 "context"
 "crypto/rand"
 "database/sql"
 "encoding/hex"
 "encoding/json"
 "errors"
 "os"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func (j *Journal) prepareUnbackedLossLocked(ctx context.Context,m *Manager,day string)(LossRecord,error){
 var record LossRecord
 if e:=j.ready(ctx);e!=nil{return record,e}
 a,_,e:=dayRange(day,day)
 if e!=nil{return record,e}
 if m.closed||!m.catalogOpened||m.now().Before(a.Add(24*time.Hour+m.grace))||(m.daily!=nil&&m.daily.day==day){return record,errors.New("active or grace day protected")}
 if p,e:=j.archivePending(ctx);e!=nil{return record,e}else if p!=nil&&p.Snapshot.Manifest.Day==day{return record,ErrArchivePending}
 for _,table:=range []string{"journal_archive","journal_active","journal_loss","journal_partial_loss","journal_compact"}{
  var n int
  if e=j.db.QueryRowContext(ctx,"SELECT COUNT(*) FROM "+table+" WHERE day=?",day).Scan(&n);e!=nil{return record,e}
  if n!=0{return record,errors.New("existing archive or loss record; separate recovery path required")}
 }
 p,e:=m.path(day);if e!=nil{return record,e}
 if e=checkLossSidecars(p);e!=nil{return record,e}
 // Snapshot metadata, counts, digest, and journal latest counts must all
 // agree while both locks exclude local readers and writers.
 details,e:=checkSnapshot(ctx,p,day);if e!=nil{return record,e}
 if details.sealed==nil{return record,errors.New("unbacked day must be sealed")}
 if e=checkLossSidecars(p);e!=nil{return record,e}
 digest,e:=sealedLogicalDigest(ctx,p,day);if e!=nil{return record,e}
 record=LossRecord{Day:day,From:a.UnixMilli(),To:a.Add(24*time.Hour).UnixMilli(),Revision:details.revision,RowCounts:details.counts,LogicalSHA256:digest,ArchiveState:"no_verified_archive",Reason:"capacity_forced_loss",RecordedAt:m.now().UnixMilli()}
 if e=validateLossRecord(record);e!=nil{return LossRecord{},e}
 for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{
  var n int64
  if e=j.db.QueryRowContext(ctx,"SELECT COUNT(*) FROM journal_change c WHERE c.kind=? AND c.t>=? AND c.t<? AND "+latestOnly,k,record.From,record.To).Scan(&n);e!=nil||n!=record.RowCounts[string(k)]{return LossRecord{},errors.New("loss day catalog count mismatch")}
 }
 b,e:=json.Marshal(record);if e!=nil{return LossRecord{},e}
 // FULL synchronous journal WAL is durable before any local unlink.
 if _,e=j.db.ExecContext(ctx,"INSERT INTO journal_loss(day,from_t,to_t,record_json,state) VALUES(?,?,?,?,'prepared')",day,record.From,record.To,b);e!=nil{return LossRecord{},e}
 return record,nil
}
func checkLossSidecars(p string)error{
 st,e:=os.Lstat(p)
 if e!=nil||!st.Mode().IsRegular(){return errors.New("unsafe loss day file")}
 for _,s:=range []string{"-wal","-shm"}{
  st,e:=os.Lstat(p+s)
  if errors.Is(e,os.ErrNotExist){continue}
  if e!=nil||!st.Mode().IsRegular()||s=="-wal"&&st.Size()!=0{return errors.New("uncheckpointed loss day")}
 }
 return nil
}
func syncLossDir(root string)error{
 d,e:=os.Open(root);if e!=nil{return e}
 return errors.Join(d.Sync(),d.Close())
}
func (j *Journal) finalizeLossLocked(ctx context.Context,r LossRecord,completed int64)error{
 if completed<r.RecordedAt{completed=r.RecordedAt}
 var seed [16]byte
 if _,e:=rand.Read(seed[:]);e!=nil{return e}
 generation:=hex.EncodeToString(seed[:])
 tx,e:=j.db.BeginTx(ctx,nil);if e!=nil{return e}
 defer tx.Rollback()
 b,e:=json.Marshal(r);if e!=nil{return e}
 res,e:=tx.ExecContext(ctx,"UPDATE journal_loss SET state='removed',completed_at=? WHERE day=? AND state='prepared' AND record_json=?",completed,r.Day,b)
 if e!=nil{return e}
 if n,e:=res.RowsAffected();e!=nil||n!=1{return ErrPendingLoss}
 // Old cursors must resync; remaining rows are still authoritative.
 if _,e=tx.ExecContext(ctx,"DELETE FROM journal_change WHERE t>=? AND t<?",r.From,r.To);e!=nil{return e}
 if _,e=tx.ExecContext(ctx,"UPDATE journal_meta SET value=? WHERE key='generation'",generation);e!=nil{return e}
 if e=tx.Commit();e!=nil{return e}
 j.generation=generation
 return nil
}

// EvictUnbackedDay is an explicit, unscheduled last-resort operation for an
// isolated manager with no verified sealed OR hourly backup. It deliberately
// refuses partially recoverable days until a separate active restore path
// is implemented. No callers in staging or production automatically invoke
// it. Repair audit rows remain in the catalog.
func(j *Journal) EvictUnbackedDay(ctx context.Context,day string)error{
 target,ok:=j.target.(managerJournalTarget);if !ok{return ErrUnavailable}
 m:=target.m
 j.archiveMu.Lock();defer j.archiveMu.Unlock()
 j.mu.Lock();defer j.mu.Unlock()
 m.mu.Lock();defer m.mu.Unlock()
 r,e:=j.prepareUnbackedLossLocked(ctx,m,day);if e!=nil{return e}
 p,e:=m.path(day);if e!=nil{return e}
 // Once prepared, either finish durably or leave intent for startup
 // reconciliation. Use the caller's context before irreversible unlink.
 if e=ctx.Err();e!=nil{return e}
 for _,s:=range []string{"-wal","-shm"}{if e=os.Remove(p+s);e!=nil&&!errors.Is(e,os.ErrNotExist){return e}}
 if e=os.Remove(p);e!=nil{return e}
 if e=syncLossDir(m.root);e!=nil{return e}
 return j.finalizeLossLocked(ctx,r,m.now().UnixMilli())
}

// RecoverLoss resolves only the single pending pre-unlink intent after a
// restart. If the sealed DB still exists unchanged, cancel the attempt;
// if absent with no sidecars, finalize the permanent loss. Never auto-delete
// surviving data on restart. Call before starting workers or HTTP.
func(j *Journal) RecoverLoss(ctx context.Context)error{
 target,ok:=j.target.(managerJournalTarget);if !ok{return ErrUnavailable}
 m:=target.m
 j.archiveMu.Lock();defer j.archiveMu.Unlock()
 j.mu.Lock();defer j.mu.Unlock()
 m.mu.Lock();defer m.mu.Unlock()
 var day string
 e:=j.db.QueryRowContext(ctx,"SELECT day FROM journal_loss WHERE state='prepared'").Scan(&day)
 if errors.Is(e,sql.ErrNoRows){return nil};if e!=nil{return e}
 var n int
 if e=j.db.QueryRowContext(ctx,"SELECT COUNT(*) FROM journal_loss WHERE state='prepared'").Scan(&n);e!=nil||n!=1{return ErrPendingLoss}
 if b,e:=j.pending(ctx);e!=nil{return e}else if b!=nil{return ErrPendingWrite}
 if p,e:=j.archivePending(ctx);e!=nil{return e}else if p!=nil&&p.Snapshot.Manifest.Day==day{return ErrArchivePending}
 state,e:=j.lossRecordLocked(ctx,day);if e!=nil{return e}
 p,e:=m.path(day);if e!=nil{return e}
 if _,e=os.Lstat(p);e==nil{
  if e=checkLossSidecars(p);e!=nil{return e}
  digest,e:=sealedLogicalDigest(ctx,p,day)
  if e!=nil||digest!=state.Record.LogicalSHA256{return ErrPendingLoss}
  _,e=j.db.ExecContext(ctx,"DELETE FROM journal_loss WHERE day=? AND state='prepared'",day)
  return e
 }else if !errors.Is(e,os.ErrNotExist){return e}
 for _,s:=range []string{"-wal","-shm"}{if _,e=os.Lstat(p+s);!errors.Is(e,os.ErrNotExist){return ErrPendingLoss}}
 if e=syncLossDir(m.root);e!=nil{return e}
 return j.finalizeLossLocked(ctx,state.Record,m.now().UnixMilli())
}

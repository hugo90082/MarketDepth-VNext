//go:build linux && sqlite_integration

package store

import(
 "context"
 "errors"
 "os"
 "path/filepath"
 "testing"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func TestUnbackedLossIntentRecoveryAndGap(t *testing.T){
 ctx:=context.Background()
 rows:=liveRows();day:=model.Day(rows[0].Key().T)
 now:=time.UnixMilli(rows[0].Key().T+120000)
 root:=filepath.Join(t.TempDir(),"live")
 open:=func()(*Manager,*Journal){
  m,e:=newManager(root,SQLiteOpener,func()time.Time{return now},5*time.Minute);if e!=nil{t.Fatal(e)}
  j,e:=m.OpenCatalog(ctx);if e!=nil{t.Fatal(e)}
  return m,j
 }
 m,j:=open()
 if e:=j.Put(ctx,rows);e!=nil{t.Fatal(e)}
 if e:=j.EvictUnbackedDay(ctx,day);e==nil{t.Fatal("active day deleted")}
 a,_,e:=dayRange(day,day);if e!=nil{t.Fatal(e)}
 q:=Query{Kind:rows[0].Kind(),From:a.UnixMilli(),To:a.Add(24*time.Hour).UnixMilli(),Limit:10}
 before,e:=j.Sync(ctx,q.Kind,"");if e!=nil||before.Next==""{t.Fatal(before,e)}
 now=a.Add(24*time.Hour+6*time.Minute)
 if _,e=j.SealDay(ctx,day,"test");e!=nil{t.Fatal(e)}
 // Simulate durable intent then process exit before unlink.
 prepare:=func(){
  j.mu.Lock();defer j.mu.Unlock();m.mu.Lock();defer m.mu.Unlock()
  if _,e:=j.prepareUnbackedLossLocked(ctx,m,day);e!=nil{t.Fatal(e)}
 }
 prepare()
 if _,e=j.History(ctx,q);!errors.Is(e,ErrPendingLoss){t.Fatal("pending intent not blocked",e)}
 if e=j.Close();e!=nil{t.Fatal(e)};if e=m.Close();e!=nil{t.Fatal(e)}
 m,j=open()
 if e=j.RecoverLoss(ctx);e!=nil{t.Fatal(e)}
 p:=filepath.Join(root,day+".sqlite")
 if _,e=os.Stat(p);e!=nil{t.Fatal("surviving data not preserved",e)}
 if _,e=j.History(ctx,q);e!=nil{t.Fatal(e)}
 // Simulate crash after unlink and before final catalog transaction.
 prepare()
 for _,name:=range []string{p+"-wal",p+"-shm",p}{if e=os.Remove(name);e!=nil&&!errors.Is(e,os.ErrNotExist){t.Fatal(e)}}
 if e=j.Close();e!=nil{t.Fatal(e)};if e=m.Close();e!=nil{t.Fatal(e)}
 m,j=open();defer m.Close();defer j.Close()
 if e=j.RecoverLoss(ctx);e!=nil{t.Fatal(e)}
 loss,e:=j.LossRecord(ctx,day)
 if e!=nil||loss.State!="removed"||loss.CompletedAt==nil||loss.Record.RowCounts[string(q.Kind)]!=1{t.Fatal(loss,e)}
 page,e:=j.History(ctx,q)
 if e!=nil||len(page.Rows)!=0||len(page.Gaps)!=1||page.Gaps[0].Reason!="permanent_loss"||page.Gaps[0].From!=q.From||page.Gaps[0].To!=q.To{t.Fatal(page,e)}
 days,e:=j.Days(ctx,day,day)
 if e!=nil||len(days)!=1||days[0].State!="permanent_loss"{t.Fatal(days,e)}
 if _,e=j.Sync(ctx,q.Kind,before.Next);!errors.Is(e,ErrResync){t.Fatal("old cursor accepted",e)}
 if e=j.RecoverLoss(ctx);e!=nil{t.Fatal(e)}
 remote:=&sealedRemote{objects:map[string]storedArchiveObject{},keys:map[string]string{},failManifest:true}
 c,e:=NewArchiveReadCache(m,remote,func(context.Context,int64)(func(),error){return func(){},nil})
 if e!=nil{t.Fatal(e)}
 r,e:=NewArchiveReader(j,c);if e!=nil{t.Fatal(e)}
 if _,e=r.SyncLossCycle(ctx);e==nil{t.Fatal("upload failure ignored")}
 var synced int
 if e=j.db.QueryRowContext(ctx,"SELECT COUNT(*) FROM journal_loss_sync").Scan(&synced);e!=nil||synced!=0{t.Fatal(synced,e)}
 remote.failManifest=false
 if state,e:=r.SyncLossCycle(ctx);e!=nil||state!="loss_ledger_verified"{t.Fatal(state,e)}
 if state,e:=r.SyncLossCycle(ctx);e!=nil||state!="idle"{t.Fatal(state,e)}
 if len(remote.objects)!=1{t.Fatal("duplicate loss record",len(remote.objects))}
 key,b,hash,e:=lossLedgerBytes(loss);if e!=nil{t.Fatal(e)}
 o:=remote.objects[remote.keys[key]]
 if string(o.data)!=string(b)||o.meta.SHA256!=hash{t.Fatal("ledger readback mismatch")}
}

//go:build linux && sqlite_integration

package store

import(
 "context"
 "errors"
 "os"
 "path/filepath"
 "testing"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)
func TestPartialLossKeepsExactActiveRowsAndRejectsStaleRepair(t *testing.T){
 ctx:=context.Background()
 rows:=liveRows();spot:=rows[0].(model.SpotRow);f10:=rows[1].(model.Futures10Row);old:=rows[2].(model.Futures1Row)
 day:=model.Day(spot.T);a,_,e:=dayRange(day,day);if e!=nil{t.Fatal(e)}
 now:=time.UnixMilli(spot.T+180000);root:=filepath.Join(t.TempDir(),"live")
 open:=func()(*Manager,*Journal){
  m,e:=newManager(root,SQLiteOpener,func()time.Time{return now},5*time.Minute);if e!=nil{t.Fatal(e)}
  j,e:=m.OpenCatalog(ctx);if e!=nil{t.Fatal(e)}
  return m,j
 }
 m,j:=open()
 if e=j.Put(ctx,rows);e!=nil{t.Fatal(e)}
 stage,verify:=filepath.Join(t.TempDir(),"stage"),filepath.Join(t.TempDir(),"verify")
 for _,p:=range []string{stage,verify}{if e=os.Mkdir(p,0700);e!=nil{t.Fatal(e)}}
 snap,e:=m.CreateSnapshot(ctx,day,stage,archive.HourGeneration(a),"test",20_000_000);if e!=nil{t.Fatal(e)}
 remote:=&sealedRemote{objects:map[string]storedArchiveObject{},keys:map[string]string{}}
 rec,e:=j.PublishActiveSnapshot(ctx,remote,snap,verify,20_000_000);if e!=nil{t.Fatal(e)}
 extra:=spot;extra.T+=60000;extra.AvailableAt=model.Ptr(extra.T+1000)
 if extra.CapturedAt!=nil{extra.CapturedAt=model.Ptr(extra.T)}
 if e=j.Put(ctx,[]model.Row{extra,repairedKline(old,now.UnixMilli())});e!=nil{t.Fatal(e)}
 now=a.Add(24*time.Hour+6*time.Minute)
 if _,e=j.SealDay(ctx,day,"test");e!=nil{t.Fatal(e)}
 // Keep all three newest live kinds on a different day.
 ns,nf,no:=spot,f10,old
 ns.T+=86400000;ns.AvailableAt=model.Ptr(*ns.AvailableAt+86400000);if ns.CapturedAt!=nil{ns.CapturedAt=model.Ptr(*ns.CapturedAt+86400000)}
 nf.T+=86400000;nf.AvailableAt=model.Ptr(*nf.AvailableAt+86400000)
 no.T+=86400000;no.AvailableAt=model.Ptr(*no.AvailableAt+86400000)
 now=time.UnixMilli(ns.T+600000)
 if e=j.Put(ctx,[]model.Row{ns,nf,no});e!=nil{t.Fatal(e)}
 prepare:=func(){
  j.mu.Lock();defer j.mu.Unlock();m.mu.Lock();defer m.mu.Unlock()
  r,e:=j.preparePartialLossLocked(ctx,m,day)
  if e!=nil||r.Recoverable.Count(model.Spot)!=1||r.Lost.Count(model.Spot)!=1||r.Recoverable.Count(model.F10)!=1||r.Lost.Count(model.F1)!=1{t.Fatal(r,e)}
 }
 prepare()
 if _,e=j.Sync(ctx,model.Spot,"");!errors.Is(e,ErrPendingLoss){t.Fatal(e)}
 if e=j.Close();e!=nil{t.Fatal(e)};if e=m.Close();e!=nil{t.Fatal(e)}
 m,j=open()
 if e=j.RecoverPartialLoss(ctx);e!=nil{t.Fatal(e)}
 p:=filepath.Join(root,day+".sqlite")
 if _,e=os.Stat(p);e!=nil{t.Fatal("surviving local file missing",e)}
 // Simulated crash after unlink, before final catalog transaction.
 prepare()
 for _,name:=range []string{p+"-wal",p+"-shm",p}{if e=os.Remove(name);e!=nil&&!errors.Is(e,os.ErrNotExist){t.Fatal(e)}}
 if e=j.Close();e!=nil{t.Fatal(e)};if e=m.Close();e!=nil{t.Fatal(e)}
 m,j=open();defer m.Close();defer j.Close()
 if e=j.RecoverPartialLoss(ctx);e!=nil{t.Fatal(e)}
 loss,e:=j.PartialLoss(ctx,day);if e!=nil||loss.State!="removed"||loss.Record.Active.ManifestSHA256!=rec.ManifestSHA256{t.Fatal(loss,e)}
 c,e:=NewArchiveReadCache(m,remote,func(context.Context,int64)(func(),error){return func(){},nil});if e!=nil{t.Fatal(e)}
 r,e:=NewArchiveReader(j,c);if e!=nil{t.Fatal(e)}
 q:=Query{Kind:model.Spot,From:spot.T,To:extra.T+60000,Asset:spot.Asset,Venue:spot.Venue,Limit:10}
 page,e:=r.History(ctx,q)
 if e!=nil||len(page.Rows)!=1||page.Rows[0].Key()!=spot.Key()||len(page.Gaps)!=1||page.Gaps[0].Reason!="permanent_loss"||page.Gaps[0].From!=extra.T{t.Fatal(page,e)}
 q=Query{Kind:model.F1,From:old.T,To:old.T+60000,Asset:old.Asset,Limit:10}
 page,e=r.History(ctx,q)
 if e!=nil||len(page.Rows)!=0||len(page.Gaps)!=1||page.Gaps[0].Reason!="permanent_loss"{t.Fatal("stale snapshot repair exposed",page,e)}
 days,e:=r.Days(ctx,day,day);if e!=nil||len(days)!=1||days[0].State!="partial_remote"||days[0].Counts[model.Spot]!=1{t.Fatal(days,e)}
 if _,e=r.OpenSealed(ctx,day,0);e==nil{t.Fatal("active download called sealed")}
 var n int
 if e=j.db.QueryRowContext(ctx,"SELECT COUNT(*) FROM journal_change WHERE t>=? AND t<?",loss.Record.From,loss.Record.To).Scan(&n);e!=nil||n!=0{t.Fatal("partial pointer index retained",n,e)}
 if e=j.db.QueryRowContext(ctx,"SELECT COUNT(*) FROM journal_active_recovery WHERE day=?",day).Scan(&n);e!=nil||n!=0{t.Fatal("dense recovery evidence retained",n,e)}
 syncPage,e:=r.Sync(ctx,model.Spot,"");if e!=nil||len(syncPage.Rows)!=1||len(syncPage.Gaps)!=1||syncPage.Gaps[0].Reason!="partial_history_query_history"{t.Fatal(syncPage,e)}
 if len(remote.objects)!=2{t.Fatal("active remote changed")}
 if state,e:=r.SyncLossCycle(ctx);e!=nil||state!="loss_ledger_verified"{t.Fatal(state,e)}
 if state,e:=r.SyncLossCycle(ctx);e!=nil||state!="idle"{t.Fatal(state,e)}
 if len(remote.objects)!=3{t.Fatal("partial loss ledger not published once")}
 if e=j.db.QueryRowContext(ctx,"SELECT COUNT(*) FROM journal_loss_sync WHERE day=?",day).Scan(&n);e!=nil||n!=1{t.Fatal(n,e)}
}

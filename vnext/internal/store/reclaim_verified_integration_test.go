//go:build linux && sqlite_integration

package store

import (
 "context"
 "os"
 "path/filepath"
 "testing"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)
func TestReclaimVerifiedCycleProtectsLatestAndRestoresOldDay(t *testing.T){
 ctx:=context.Background()
 rows:=liveRows()
 day:=model.Day(rows[0].Key().T)
 a,_,e:=dayRange(day,day);if e!=nil{t.Fatal(e)}
 now:=time.UnixMilli(rows[0].Key().T+120000)
 m,e:=newManager(filepath.Join(t.TempDir(),"live"),SQLiteOpener,func()time.Time{return now},5*time.Minute)
 if e!=nil{t.Fatal(e)};defer m.Close()
 j,e:=m.OpenCatalog(ctx);if e!=nil{t.Fatal(e)};defer j.Close()
 if e=j.Put(ctx,rows);e!=nil{t.Fatal(e)}
 now=a.Add(24*time.Hour+6*time.Minute)
 if _,e=j.SealDay(ctx,day,"test");e!=nil{t.Fatal(e)}
 stage,verify:=filepath.Join(t.TempDir(),"stage"),filepath.Join(t.TempDir(),"verify")
 for _,p:=range []string{stage,verify}{if e=os.Mkdir(p,0700);e!=nil{t.Fatal(e)}}
 snap,e:=m.CreateSnapshot(ctx,day,stage,"g1","test",20_000_000);if e!=nil{t.Fatal(e)}
 remote:=&sealedRemote{objects:map[string]storedArchiveObject{},keys:map[string]string{}}
 rec,e:=j.PublishSealedSnapshot(ctx,remote,snap,verify,20_000_000);if e!=nil{t.Fatal(e)}
 c,e:=NewArchiveReadCache(m,remote,func(context.Context,int64)(func(),error){return func(){},nil})
 if e!=nil{t.Fatal(e)}
 r,e:=NewArchiveReader(j,c);if e!=nil{t.Fatal(e)}
 if state,e:=r.ReclaimVerifiedCycle(ctx);e!=nil||state!="idle"{t.Fatal(state,e)}
 oldPath:=filepath.Join(m.root,day+".sqlite")
 if _,e=os.Stat(oldPath);e!=nil{t.Fatal(e)}
 // Advance the latest row of every kind; preserve original availability lag.
 next:=[]model.Row{}
 for _,row:=range rows{
  switch v:=row.(type){
  case model.SpotRow:
   v.T+=86400000;v.AvailableAt=model.Ptr(*v.AvailableAt+86400000)
   if v.CapturedAt!=nil{v.CapturedAt=model.Ptr(*v.CapturedAt+86400000)}
   next=append(next,v)
  case model.Futures10Row:
   v.T+=86400000;v.AvailableAt=model.Ptr(*v.AvailableAt+86400000)
   next=append(next,v)
  case model.Futures1Row:
   v.T+=86400000;v.AvailableAt=model.Ptr(*v.AvailableAt+86400000)
   next=append(next,v)
  default:t.Fatalf("unexpected fixture type %T",row)
  }
 }
 now=time.UnixMilli(next[0].Key().T+600000)
 if e=j.Put(ctx,next);e!=nil{t.Fatal(e)}
 if state,e:=r.ReclaimVerifiedCycle(ctx);e!=nil||state!="local_reclaimed"{t.Fatal(state,e)}
 if _,e=os.Stat(oldPath);!os.IsNotExist(e){t.Fatal("day not reclaimed",e)}
 if c.dir!=""{t.Fatal("eviction cache retained")}
 if p,e:=r.History(ctx,Query{Kind:rows[0].Kind(),From:rec.Manifest.From,To:rec.Manifest.To,Limit:10});e!=nil||len(p.Rows)!=1{t.Fatal(p,e)}
 if state,e:=r.ReclaimVerifiedCycle(ctx);e!=nil||state!="idle"{t.Fatal(state,e)}
 // Compact only after the local copy is gone, and compare every remote
 // row hash with its original journal pointer before dropping pointers.
 before,e:=r.Sync(ctx,rows[0].Kind(),"");if e!=nil||before.Next==""{t.Fatal(before,e)}
 if state,e:=r.CompactVerifiedCycle(ctx);e!=nil||state!="catalog_compacted"{t.Fatal(state,e)}
 if state,e:=r.CompactVerifiedCycle(ctx);e!=nil||state!="idle"{t.Fatal(state,e)}
 var n int
 if e=j.db.QueryRowContext(ctx,"SELECT COUNT(*) FROM journal_change WHERE t>=? AND t<?",rec.Manifest.From,rec.Manifest.To).Scan(&n);e!=nil||n!=0{t.Fatal(n,e)}
 if _,e=r.Sync(ctx,rows[0].Kind(),before.Next);e!=ErrResync{t.Fatal("old sync cursor accepted",e)}
 s,e:=r.Sync(ctx,rows[0].Kind(),"");if e!=nil||len(s.Rows)!=1||len(s.Gaps)!=1||s.Gaps[0].Reason!="sealed_history_query_history"{t.Fatal(s,e)}
 q:=Query{Kind:rows[0].Kind(),From:rec.Manifest.From,To:next[0].Key().T+60000,Limit:1,Asset:rows[0].Key().Asset,Venue:rows[0].Key().Venue}
 p,e:=r.History(ctx,q);if e!=nil||len(p.Rows)!=1||p.Rows[0].Key()!=rows[0].Key()||p.Complete||p.Next==""{t.Fatal(p,e)}
 for _,gap:=range p.Gaps{if gap.From<=rows[0].Key().T&&gap.To>rows[0].Key().T{t.Fatal("present archived row marked missing",gap)}}
 q.Cursor=p.Next
 p,e=r.History(ctx,q);if e!=nil||len(p.Rows)!=1||p.Rows[0].Key()!=next[0].Key()||!p.Complete{t.Fatal(p,e)}
 if _,e=j.History(ctx,Query{Kind:q.Kind,From:rec.Manifest.From,To:rec.Manifest.To,Limit:10});e!=ErrArchiveUnavailable{t.Fatal("local-only history hid compacted day",e)}
 if _,e=r.VacuumCatalogCycle(ctx);e!=nil{t.Fatal(e)}
 if _,e=r.History(ctx,Query{Kind:q.Kind,From:rec.Manifest.From,To:rec.Manifest.To,Limit:10});e!=nil{t.Fatal(e)}
}

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
   v.CapturedAt+=86400000
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
}

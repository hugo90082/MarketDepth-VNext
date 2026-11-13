//go:build linux && sqlite_integration

package store

import(
 "context"
 "errors"
 "os"
 "path/filepath"
 "strings"
 "testing"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)
func recoveryCandidates(remote *sealedRemote)[]archive.Object{
 out:=[]archive.Object{}
 for _,v:=range remote.objects{if strings.HasSuffix(v.meta.Key,".json"){out=append(out,v.meta)}}
 return out
}
func freshRecovery(t *testing.T,ctx context.Context,root string,now time.Time)(*Manager,*Journal){
 t.Helper()
 m,e:=newManager(root,SQLiteOpener,func()time.Time{return now},5*time.Minute);if e!=nil{t.Fatal(e)}
 j,e:=m.OpenCatalog(ctx);if e!=nil{m.Close();t.Fatal(e)}
 return m,j
}
func TestRebuildVerifiedCatalogSealedAndSnapshotOnly(t *testing.T){
 ctx:=context.Background()
 rows:=liveRows();now:=time.UnixMilli(rows[0].Key().T+180000)
 m,e:=newManager(filepath.Join(t.TempDir(),"source"),SQLiteOpener,func()time.Time{return now},5*time.Minute);if e!=nil{t.Fatal(e)};defer m.Close()
 j,e:=m.OpenCatalog(ctx);if e!=nil{t.Fatal(e)};defer j.Close()
 if e=j.Put(ctx,rows);e!=nil{t.Fatal(e)}
 day:=model.Day(rows[0].Key().T)
 a,_,e:=dayRange(day,day);if e!=nil{t.Fatal(e)}
 now=a.Add(24*time.Hour+6*time.Minute)
 if _,e=j.SealDay(ctx,day,"test");e!=nil{t.Fatal(e)}
 stage,verify:=filepath.Join(t.TempDir(),"stage"),filepath.Join(t.TempDir(),"verify")
 for _,p:=range []string{stage,verify}{if e=os.Mkdir(p,0700);e!=nil{t.Fatal(e)}}
 remote:=&sealedRemote{objects:map[string]storedArchiveObject{},keys:map[string]string{}}
 snap,e:=m.CreateSnapshot(ctx,day,stage,"g1","test",20_000_000);if e!=nil{t.Fatal(e)}
 sealed,e:=j.PublishSealedSnapshot(ctx,remote,snap,verify,20_000_000);if e!=nil{t.Fatal(e)}
 next:=shiftLossRows(rows,86400000)
 if e=j.Put(ctx,next);e!=nil{t.Fatal(e)}
 day2:=model.Day(next[0].Key().T)
 snap,e=m.CreateSnapshot(ctx,day2,stage,archive.HourGeneration(now),"test",20_000_000);if e!=nil{t.Fatal(e)}
 active,e:=j.PublishActiveSnapshot(ctx,remote,snap,verify,20_000_000);if e!=nil{t.Fatal(e)}
 objs:=recoveryCandidates(remote)
 if len(objs)!=2{t.Fatal(objs)}
 allow:=func(context.Context,int64)(func(),error){return func(){},nil}
 root:=filepath.Join(t.TempDir(),"restored")
 m2,j2:=freshRecovery(t,ctx,root,now)
 result,e:=j2.RebuildVerifiedCatalog(ctx,remote,objs,allow)
 if e!=nil||result.SealedDays!=1||result.SealedRevisions!=1||result.SnapshotOnlyDays!=1{t.Fatal(result,e)}
 if e=j2.Close();e!=nil{t.Fatal(e)};if e=m2.Close();e!=nil{t.Fatal(e)}
 m2,j2=freshRecovery(t,ctx,root,now);defer m2.Close();defer j2.Close()
 if ok,e:=j2.RecoveryCompleted(ctx);e!=nil||!ok{t.Fatal(ok,e)}
 if e=j2.CanCollectDay(ctx,day2);e==nil{t.Fatal("same-day recovered write allowed")}
 if e=j2.Put(ctx,next);e==nil{t.Fatal("overlapping recovered write")}
 if e=j2.CanCollectDay(ctx,model.Day(next[0].Key().T+86400000));e!=nil{t.Fatal(e)}
 if _,e=j2.ArchiveRecord(ctx,day,1);e!=nil{t.Fatal(e)}
 c,e:=NewArchiveReadCache(m2,remote,allow);if e!=nil{t.Fatal(e)}
 r,e:=NewArchiveReader(j2,c);if e!=nil{t.Fatal(e)}
 q:=Query{Kind:model.Spot,From:rows[0].Key().T,To:next[0].Key().T+120000,Asset:"BTC",Venue:"binance",Limit:1}
 p,e:=r.History(ctx,q);if e!=nil||len(p.Rows)!=1||p.Rows[0].Key()!=rows[0].Key()||p.Next==""{t.Fatal(p,e)}
 for _,gap:=range p.Gaps{if gap.Reason=="permanent_loss"{t.Fatal("unknown tail declared lost",gap)}}
 q.Cursor=p.Next;p,e=r.History(ctx,q);if e!=nil||len(p.Rows)!=1||p.Rows[0].Key()!=next[0].Key()||!p.Complete{t.Fatal(p,e)}
 days,e:=r.Days(ctx,day,day2)
 if e!=nil||len(days)!=2||days[0].State!="sealed_remote"||days[1].State!="active_recovered_remote"{t.Fatal(days,e)}
 if _,e=r.OpenSealed(ctx,day2,0);e==nil{t.Fatal("active treated as sealed")}
 if latest,e:=r.Latest(ctx,model.Spot);e!=nil||len(latest)!=0{t.Fatal("remote history used as current live",latest,e)}
 // A corrupt remote data object must leave a blocked incomplete catalog.
 badRoot:=filepath.Join(t.TempDir(),"failed")
 badM,badJ:=freshRecovery(t,ctx,badRoot,now)
 raw:=remote.objects[active.Manifest.FileID];changed:=raw;changed.data=append([]byte(nil),raw.data...);changed.data[0]^=1
 remote.objects[active.Manifest.FileID]=changed
 if _,e=badJ.RebuildVerifiedCatalog(ctx,remote,objs,allow);e==nil{t.Fatal("corrupt archive accepted")}
 if _,e=badJ.History(ctx,Query{Kind:model.Spot,From:sealed.Manifest.From,To:sealed.Manifest.To,Limit:1});!errors.Is(e,ErrRecoveryIncomplete){t.Fatal(e)}
 if e=badJ.Close();e!=nil{t.Fatal(e)};if e=badM.Close();e!=nil{t.Fatal(e)}
 badM,e=newManager(badRoot,SQLiteOpener,func()time.Time{return now},5*time.Minute);if e!=nil{t.Fatal(e)};defer badM.Close()
 if x,e:=badM.OpenCatalog(ctx);!errors.Is(e,ErrRecoveryIncomplete){if x!=nil{x.Close()};t.Fatal("incomplete catalog reopened",e)}
 remote.objects[active.Manifest.FileID]=raw
 if len(remote.objects)!=4{t.Fatal("remote modified")}
}

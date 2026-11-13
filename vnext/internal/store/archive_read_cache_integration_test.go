//go:build linux && sqlite_integration

package store

import (
 "context"
 "os"
 "path/filepath"
 "testing"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)
func TestArchiveReadCacheVerifiedReuseAndCorruption(t *testing.T){
 ctx:=context.Background()
 rows:=liveRows()
 day:=model.Day(rows[0].Key().T)
 now:=time.UnixMilli(rows[0].Key().T+120000)
 m,e:=newManager(filepath.Join(t.TempDir(),"live"),SQLiteOpener,func()time.Time{return now},5*time.Minute)
 if e!=nil{t.Fatal(e)};defer m.Close()
 j,e:=m.OpenCatalog(ctx);if e!=nil{t.Fatal(e)};defer j.Close()
 if e=j.Put(ctx,rows);e!=nil{t.Fatal(e)}
 a,_,e:=dayRange(day,day);if e!=nil{t.Fatal(e)}
 now=a.Add(24*time.Hour+6*time.Minute)
 if _,e=j.SealDay(ctx,day,"test");e!=nil{t.Fatal(e)}
 stage,verify:=filepath.Join(t.TempDir(),"stage"),filepath.Join(t.TempDir(),"verify")
 for _,p:=range []string{stage,verify}{if e=os.Mkdir(p,0700);e!=nil{t.Fatal(e)}}
 snap,e:=m.CreateSnapshot(ctx,day,stage,"g1","test",20_000_000);if e!=nil{t.Fatal(e)}
 remote:=&sealedRemote{objects:map[string]storedArchiveObject{},keys:map[string]string{}}
 rec,e:=j.PublishSealedSnapshot(ctx,remote,snap,verify,20_000_000);if e!=nil{t.Fatal(e)}
 reservations:=0
 reserve:=func(ctx context.Context,n int64)(func(),error){
  if n<=0||n>archive.CacheLimit{t.Fatal("invalid reservation",n)}
  reservations++;return func(){},nil
 }
 c,e:=NewArchiveReadCache(m,remote,reserve);if e!=nil{t.Fatal(e)}
 keys:=[]JournalKey{{rows[0].Kind(),rows[0].Key()}}
 check:=func(){
  got,e:=c.Read(ctx,rec,keys);if e!=nil||len(got)!=1{t.Fatal(got,e)}
  h1,e1:=journalHash(got[0]);h2,e2:=journalHash(rows[0])
  if e1!=nil||e2!=nil||h1!=h2{t.Fatal("row mismatch")}
 }
 check();check()
 // Simulate a missing daily file only in the isolated test, not production eviction.
 original:=filepath.Join(m.root,day+".sqlite")
 moved:=filepath.Join(t.TempDir(),"retained.sqlite")
 if e=os.Rename(original,moved);e!=nil{t.Fatal(e)}
 q:=Query{Kind:rows[0].Kind(),From:rec.Manifest.From,To:rec.Manifest.To,Limit:10}
 reader,e:=NewArchiveReader(j,c);if e!=nil{t.Fatal(e)}
 p,e:=reader.History(ctx,q);if e!=nil||len(p.Rows)!=1{t.Fatal(p,e)}
 syncPage,e:=reader.Sync(ctx,rows[0].Kind(),"");if e!=nil||len(syncPage.Rows)!=1||syncPage.Next==""{t.Fatal(syncPage,e)}
 syncNext,e:=reader.Sync(ctx,rows[0].Kind(),syncPage.Next);if e!=nil||len(syncNext.Rows)!=0{t.Fatal(syncNext,e)}
 days,e:=reader.Days(ctx,day,day);if e!=nil||len(days)!=1||days[0].State!="sealed_remote"||days[0].SHA256==nil||*days[0].SHA256!=rec.Manifest.SHA256||days[0].Counts[rows[0].Kind()]!=1{t.Fatal(days,e)}
 if _,e=reader.RangeVersion(ctx,[]model.Kind{rows[0].Kind()},rec.Manifest.From,rec.Manifest.To);e!=nil{t.Fatal(e)}
 if _,e=os.Stat(original);!os.IsNotExist(e){t.Fatal("reader recreated daily database",e)}
 if e=os.Rename(moved,original);e!=nil{t.Fatal(e)}
 if reservations!=1{t.Fatal("cache miss on repeat",reservations)}
 // Alter a cache byte and ensure it is not served; restore from remote again.
 f,e:=os.OpenFile(c.path,os.O_WRONLY,0600);if e!=nil{t.Fatal(e)}
 if _,e=f.WriteAt([]byte{0},0);e!=nil{t.Fatal(e)};f.Close()
 check();if reservations!=2{t.Fatal("corruption not rebuilt",reservations)}
 if e=c.Clear(ctx);e!=nil{t.Fatal(e)}
 // Corrupt the actual remote archive; no valid local cache may be returned.
 obj:=remote.objects[rec.Manifest.FileID];obj.data=append([]byte(nil),obj.data...);obj.data[0]^=1;remote.objects[rec.Manifest.FileID]=obj
 if _,e=c.Read(ctx,rec,keys);e==nil{t.Fatal("corrupt remote accepted")}
 if c.path!=""||c.dir!=""{t.Fatal("failed cache leaked")}
 if _,e=os.Stat(snap.Path);e!=nil{t.Fatal("source changed",e)}
 // Fresh process constructor cleans only owned disposable cache jobs.
 if _,e=NewArchiveReadCache(m,remote,reserve);e==nil{t.Fatal("second live cache accepted")}
}

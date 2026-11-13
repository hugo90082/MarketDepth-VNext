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

func TestEvictVerifiedLocalDayPreservesArchiveAndIndex(t *testing.T){
 ctx:=context.Background()
 rows:=liveRows()
 day:=model.Day(rows[0].Key().T)
 now:=time.UnixMilli(rows[0].Key().T+120000)
 m,e:=newManager(filepath.Join(t.TempDir(),"live"),SQLiteOpener,func()time.Time{return now},5*time.Minute)
 if e!=nil{t.Fatal(e)};defer m.Close()
 j,e:=m.OpenCatalog(ctx);if e!=nil{t.Fatal(e)};defer j.Close()
 if e=j.Put(ctx,rows);e!=nil{t.Fatal(e)}
 remote:=&sealedRemote{objects:map[string]storedArchiveObject{},keys:map[string]string{}}
 c,e:=NewArchiveReadCache(m,remote,func(context.Context,int64)(func(),error){return func(){},nil})
 if e!=nil{t.Fatal(e)}
 r,e:=NewArchiveReader(j,c);if e!=nil{t.Fatal(e)}
 if e=r.EvictVerifiedLocalDay(ctx,day);e==nil{t.Fatal("active day evicted")}
 a,_,e:=dayRange(day,day);if e!=nil{t.Fatal(e)}
 now=a.Add(24*time.Hour+6*time.Minute)
 if _,e=j.SealDay(ctx,day,"test");e!=nil{t.Fatal(e)}
 if e=r.EvictVerifiedLocalDay(ctx,day);e==nil{t.Fatal("unverified day evicted")}
 stage,verify:=filepath.Join(t.TempDir(),"stage"),filepath.Join(t.TempDir(),"verify")
 for _,p:=range []string{stage,verify}{if e=os.Mkdir(p,0700);e!=nil{t.Fatal(e)}}
 snap,e:=m.CreateSnapshot(ctx,day,stage,"g1","test",20_000_000);if e!=nil{t.Fatal(e)}
 rec,e:=j.PublishSealedSnapshot(ctx,remote,snap,verify,20_000_000);if e!=nil{t.Fatal(e)}
 p:=filepath.Join(m.root,day+".sqlite")
 obj:=remote.objects[rec.Manifest.FileID]
 bad:=obj;bad.data=append([]byte(nil),obj.data...);bad.data[0]^=1;remote.objects[rec.Manifest.FileID]=bad
 if e=r.EvictVerifiedLocalDay(ctx,day);e==nil{t.Fatal("corrupt remote authorized eviction")}
 if _,e=os.Stat(p);e!=nil{t.Fatal("local data lost",e)}
 remote.objects[rec.Manifest.FileID]=obj
 // A changed local row must not be deleted even though the archive
 // still has a valid manifest and matching row count.
 db,e:=SQLiteOpener(p,false);if e!=nil{t.Fatal(e)}
 if _,e=db.Exec("INSERT INTO events(t,code,message) VALUES(?,?,?)",rows[0].Key().T,"test_mutation","not archived");e!=nil{db.Close();t.Fatal(e)}
 if e=db.Close();e!=nil{t.Fatal(e)}
 if e=r.EvictVerifiedLocalDay(ctx,day);e==nil{t.Fatal("different local data evicted")}
 if _,e=os.Stat(p);e!=nil{t.Fatal("local data lost",e)}
 db,e=SQLiteOpener(p,false);if e!=nil{t.Fatal(e)}
 if _,e=db.Exec("DELETE FROM events WHERE code='test_mutation'");e!=nil{db.Close();t.Fatal(e)}
 if e=db.Close();e!=nil{t.Fatal(e)}
 if e=r.EvictVerifiedLocalDay(ctx,day);e!=nil{t.Fatal(e)}
 if _,e=os.Stat(p);!os.IsNotExist(e){t.Fatal("local file still present",e)}
 q:=Query{Kind:rows[0].Kind(),From:rec.Manifest.From,To:rec.Manifest.To,Limit:10}
 page,e:=r.History(ctx,q);if e!=nil||len(page.Rows)!=1{t.Fatal(page,e)}
 if _,e=j.ArchiveRecord(ctx,day,0);e!=nil{t.Fatal("archive index lost",e)}
 if len(remote.objects)!=2{t.Fatal("remote archive changed")}
}

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
func shiftLossRows(rows []model.Row,n int64)[]model.Row{
 out:=[]model.Row{}
 for _,r:=range rows{
  switch v:=r.(type){
  case model.SpotRow:v.T+=n;v.AvailableAt=model.Ptr(*v.AvailableAt+n);if v.CapturedAt!=nil{v.CapturedAt=model.Ptr(*v.CapturedAt+n)};out=append(out,v)
  case model.Futures10Row:v.T+=n;v.AvailableAt=model.Ptr(*v.AvailableAt+n);out=append(out,v)
  case model.Futures1Row:v.T+=n;v.AvailableAt=model.Ptr(*v.AvailableAt+n);out=append(out,v)
  }
 }
 return out
}
func TestForceLossCycleProtectsPendingAndLatest(t *testing.T){
 ctx:=context.Background()
 rows:=liveRows();now:=time.UnixMilli(rows[0].Key().T+180000)
 root:=filepath.Join(t.TempDir(),"live")
 m,e:=newManager(root,SQLiteOpener,func()time.Time{return now},5*time.Minute);if e!=nil{t.Fatal(e)};defer m.Close()
 j,e:=m.OpenCatalog(ctx);if e!=nil{t.Fatal(e)};defer j.Close()
 for i:=int64(0);i<3;i++{
  r:=shiftLossRows(rows,i*86400000)
  now=time.UnixMilli(r[0].Key().T+180000)
  if e=j.Put(ctx,r);e!=nil{t.Fatal(e)}
 }
 day1:=model.Day(rows[0].Key().T);day2:=model.Day(rows[0].Key().T+86400000);day3:=model.Day(rows[0].Key().T+2*86400000)
 remote:=&rotatingRemote{sealedRemote:&sealedRemote{objects:map[string]storedArchiveObject{},keys:map[string]string{}},trashed:map[string]bool{}}
 allow:=func(context.Context,int64)(func(),error){return func(){},nil}
 w,e:=NewArchiveWorker(m,j,remote,allow,"test");if e!=nil{t.Fatal(e)}
 // Oldest day is a protected exact pending upload.
 if state,e:=w.Cycle(ctx);e!=nil||state!="staged"{t.Fatal(state,e)}
 p,e:=j.ArchivePending(ctx);if e!=nil||p==nil||p.Snapshot.Manifest.Day!=day1{t.Fatal(p,e)}
 deny:=func(context.Context,int64)(func(),error){return nil,errors.New("reserve refused")}
 if _,e=w.ForceLossCycle(ctx,deny,32_000_000);e==nil{t.Fatal("capacity refusal ignored")}
 if _,e=os.Stat(filepath.Join(root,day2+".sqlite"));e!=nil{t.Fatal(e)}
 state,e:=w.ForceLossCycle(ctx,allow,32_000_000)
 if e!=nil||state!="permanent_loss_reclaimed"{t.Fatal(state,e)}
 for _,d:=range []string{day1,day3}{if _,e=os.Stat(filepath.Join(root,d+".sqlite"));e!=nil{t.Fatal("protected day lost",d,e)}}
 if _,e=os.Stat(filepath.Join(root,day2+".sqlite"));!os.IsNotExist(e){t.Fatal("old eligible day not removed",e)}
 after,e:=j.ArchivePending(ctx);if e!=nil||after==nil||after.Snapshot.Path!=p.Snapshot.Path{t.Fatal("pending changed",after,e)}
 if _,e=os.Stat(p.Snapshot.Path);e!=nil{t.Fatal("pending bytes lost",e)}
 l,e:=j.LossRecord(ctx,day2);if e!=nil||l.State!="removed"{t.Fatal(l,e)}
 if state,e=w.ForceLossCycle(ctx,allow,32_000_000);e!=nil||state!="no_safe_loss_candidate"{t.Fatal(state,e)}
 if len(remote.objects)!=0{t.Fatal("force loss performed network write")}
}

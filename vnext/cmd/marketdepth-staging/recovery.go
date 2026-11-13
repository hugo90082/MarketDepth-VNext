//go:build linux && live_ws && sqlite_integration && secure_auth

package main

import(
 "context"
 "encoding/json"
 "errors"
 "fmt"
 "os"
 "path/filepath"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/service"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)
const recoveryMarker=".recovery-build"
func durableRecoveryMarker(root string)error{
 f,e:=os.OpenFile(filepath.Join(root,recoveryMarker),os.O_WRONLY|os.O_CREATE|os.O_EXCL,0600);if e!=nil{return e}
 _,e=f.WriteString("MARKETDEPTH-VNEXT-RECOVERY-BUILD-1\n")
 if e=errors.Join(e,f.Sync(),f.Close());e!=nil{return e}
 dir,e:=os.Open(root);if e!=nil{return e}
 return errors.Join(dir.Sync(),dir.Close())
}
// runRecovery only creates a new isolated directory. It performs GETs on
// the fixed staging namespace and never starts HTTP, collector or archive
// publishing. A failed build remains marked and cannot be auto-started.
func runRecovery(ctx context.Context,root,credentials,producer string)error{
 if credentials==""{return errors.New("recovery requires external private OAuth credentials")}
 if e:=prepare(root,true);e!=nil{return e}
 if e:=durableRecoveryMarker(root);e!=nil{return e}
 var result store.RecoveryResult
 e:=func()(err error){
  m,e:=store.NewManager(root,store.SQLiteOpener);if e!=nil{return e}
  defer func(){err=errors.Join(err,m.Close())}()
  measure:=meter(root)
  used,free,e:=measure();if e!=nil{return e}
  if used>=archive.HighWater-service.WriteReserve||free<service.MinRootFree+service.WriteReserve{return service.ErrCapacity}
  j,e:=m.OpenCatalog(ctx);if e!=nil{return e}
  defer func(){err=errors.Join(err,j.Close())}()
  remote,e:=stagingDrive(root,credentials,producer);if e!=nil{return e}
  reader:=remote.RecoveryReader()
  objects,e:=reader.Discover(ctx);if e!=nil{return e}
  gate,e:=service.NewCapacityGate(measure);if e!=nil{return e}
  result,e=j.RebuildVerifiedCatalog(ctx,reader,objects,gate.Reserve)
  return e
 }()
 if e!=nil{return e}
 if e=os.Remove(filepath.Join(root,recoveryMarker));e!=nil{return e}
 dir,e:=os.Open(root);if e!=nil{return e}
 if e=errors.Join(dir.Sync(),dir.Close());e!=nil{return e}
 b,e:=json.Marshal(result);if e!=nil{return e}
 fmt.Println(string(b))
 return nil
}

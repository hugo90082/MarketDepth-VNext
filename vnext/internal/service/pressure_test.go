package service
import("context";"errors";"testing";"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive")
func TestPressureStepSafeFirstAndExplicitLoss(t *testing.T){
 ctx:=context.Background()
 for _,tc:=range []struct{name string;cacheRelieves,allow,verifiedRelieves,fail bool;want string;force int}{
  {"cache",true,true,false,false,"idle",0},
  {"verified",false,true,true,false,"local_reclaimed",0},
  {"disabled",false,false,false,false,"loss_disabled",0},
  {"force",false,true,false,false,"permanent_loss_reclaimed",1},
  {"unknown-error",false,true,false,true,"",0},
 }{
  t.Run(tc.name,func(t *testing.T){
   used:=archive.HighWater-WriteReserve-LossReserve
   g,e:=NewCapacityGate(func()(int64,int64,error){return used,2e9,nil});if e!=nil{t.Fatal(e)}
   calls:=[]string{};force:=0
   ops:=PressureOperations{
    ClearCache:func(context.Context)error{calls=append(calls,"cache");if tc.cacheRelieves{used=0};return nil},
    ClearScratch:func(context.Context)(string,error){calls=append(calls,"scratch");return "scratch_checked",nil},
    Verified:func(context.Context)(string,error){calls=append(calls,"verified");if tc.fail{return "",errors.New("untrusted local data")};if tc.verifiedRelieves{return "local_reclaimed",nil};return "idle",nil},
    Force:func(context.Context)(string,error){calls=append(calls,"force");force++;return "permanent_loss_reclaimed",nil},
   }
   s,e:=PressureStep(ctx,g,ops,tc.allow)
   if s!=tc.want||force!=tc.force||(e!=nil)!=tc.fail{t.Fatal(s,e,calls)}
   if len(calls)==0||calls[0]!="cache"{t.Fatal(calls)}
   if force>0&&(len(calls)!=4||calls[2]!="verified"){t.Fatal(calls)}
  })
 }
}

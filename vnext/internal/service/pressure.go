package service

import(
 "context"
 "errors"
 "time"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
)

// PressureOperations are isolated reclamation actions, called serially by
// a capacity supervisor. Every operation independently validates its lease.
// Unknown errors abort the cycle rather than authorizing destructive loss.
type PressureOperations struct{
 ClearCache func(context.Context)error
 ClearScratch func(context.Context)(string,error)
 Verified func(context.Context)(string,error)
 Force func(context.Context)(string,error)
}
func PressureStep(ctx context.Context,g *CapacityGate,ops PressureOperations,allowLoss bool)(string,error){
 if g==nil||ops.ClearCache==nil||ops.ClearScratch==nil||ops.Verified==nil||ops.Force==nil{return "",errors.New("pressure dependencies required")}
 check:=func()(string,error){
  if e:=ctx.Err();e!=nil{return "",e}
  s,e:=g.Status();if e!=nil{return "",e}
  if s.Reserved!=0{return "maintenance_busy",nil}
  if !s.NeedsForce(){return "idle",nil}
  return "pressure",nil
 }
 state,e:=check();if e!=nil||state!="pressure"{return state,e}
 if e=ops.ClearCache(ctx);e!=nil{return "",e}
 state,e=check();if e!=nil||state!="pressure"{return state,e}
 state,e=ops.ClearScratch(ctx);if e!=nil||state=="maintenance_busy"{return state,e}
 state,e=check();if e!=nil||state!="pressure"{return state,e}
 state,e=ops.Verified(ctx)
 if e!=nil&&!errors.Is(e,ErrCapacity){return "",e}
 if e==nil&&state!="idle"{return state,nil}
 state,e=check();if e!=nil||state!="pressure"{return state,e}
 if !allowLoss{return "loss_disabled",nil}
 return ops.Force(ctx)
}

// StartupPressure refuses to start feeds unless the measured writer budget
// is safe. It performs only bounded, demonstrably space-releasing steps;
// it cannot spin or repeatedly remove days when nothing is reclaimed.
func StartupPressure(ctx context.Context,g *CapacityGate,ops PressureOperations,allowLoss bool)error{
 if g==nil{return ErrCapacity}
 for i:=0;i<16;i++{
  s,e:=g.Status();if e!=nil{return e}
  if s.Reserved!=0{return ErrCapacity}
  if s.Used<archive.HighWater-WriteReserve&&s.Free>=MinRootFree+WriteReserve{return nil}
  step,cancel:=context.WithTimeout(ctx,20*time.Second)
  _,e=PressureStep(step,g,ops,allowLoss);cancel()
  if e!=nil{return e}
  next,e:=g.Status();if e!=nil{return e}
  if next.Used>=s.Used&&next.Free<=s.Free{return ErrCapacity}
 }
 return ErrCapacity
}

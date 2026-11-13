package service

import(
 "context"
 "errors"
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

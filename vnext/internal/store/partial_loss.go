package store

import(
 "context"
 "database/sql"
 "encoding/json"
 "errors"
 "sort"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// PartialLossRecord partitions the actual local latest row keys into exact
// snapshot-recoverable and permanently lost keys. Pre-existing missing
// grid points belong to neither bitmap. A stale repaired snapshot row is
// not marked recoverable for the newer revision.
type PartialLossRecord struct{
 Day string `json:"day"`
 From int64 `json:"from"`
 To int64 `json:"to"`
 RowCounts map[string]int64 `json:"row_counts"`
 Revision int64 `json:"revision"`
 LogicalSHA256 string `json:"logical_sha256"`
 Reason string `json:"reason"`
 RecordedAt int64 `json:"recorded_at"`
 Active archive.PublishedRecord `json:"active"`
 Recoverable GridIndex `json:"recoverable"`
 Lost GridIndex `json:"lost"`
}
type PartialLossState struct{
 Record PartialLossRecord `json:"record"`
 State string `json:"state"`
 CompletedAt *int64 `json:"completed_at"`
}
func validatePartialLoss(r PartialLossRecord)error{
 a,b,e:=dayRange(r.Day,r.Day)
 if e!=nil||r.From!=a.UnixMilli()||r.To!=b.UnixMilli()+86400000||r.RecordedAt<r.To||r.Revision<1||!validSHA(r.LogicalSHA256)||r.Reason!="capacity_forced_partial_loss"||archive.ValidateActiveRecord(r.Active)!=nil{return ErrUnavailable}
 m:=r.Active.Manifest
 if m.Day!=r.Day||m.From!=r.From||m.To!=r.To||m.Revision!=r.Revision||len(r.RowCounts)!=4{return ErrUnavailable}
 for _,g:=range []*GridIndex{&r.Recoverable,&r.Lost}{
  f,t,e:=g.bounds()
  if e!=nil||f!=r.From||t!=r.To||g.Day!=r.Day||g.Revision!=r.Revision||g.ManifestSHA256!=r.Active.ManifestSHA256{return ErrUnavailable}
 }
 for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{
  n,ok:=r.RowCounts[string(k)]
  through,has:=m.GridThrough[string(k)]
  if !ok||!has||through<r.From||through>r.To||(through-r.From)%k.Interval()!=0||n!=r.Recoverable.Count(k)+r.Lost.Count(k)||r.Recoverable.Count(k)>m.RowCounts[string(k)]{return ErrUnavailable}
  x,y:=r.Recoverable.data(k),r.Lost.data(k)
  for i:=range x{if x[i]&y[i]!=0{return ErrUnavailable}}
  end:=int((through-r.From)/k.Interval())*gridWidth(k)
  for i:=end;i<gridCapacity(k);i++{if x[i/8]&(1<<uint(i%8))!=0{return ErrUnavailable}}
 }
 if n,ok:=r.RowCounts["events"];!ok||n<0{return ErrUnavailable}
 return nil
}
func(j *Journal) partialLossLocked(ctx context.Context,day string)(PartialLossState,error){
 var v PartialLossState;var b []byte;var f,t int64;var done sql.NullInt64
 if e:=j.db.QueryRowContext(ctx,"SELECT from_t,to_t,record_json,state,completed_at FROM journal_partial_loss WHERE day=?",day).Scan(&f,&t,&b,&v.State,&done);e!=nil{return v,e}
 if len(b)>2<<20||json.Unmarshal(b,&v.Record)!=nil||validatePartialLoss(v.Record)!=nil||v.Record.Day!=day||v.Record.From!=f||v.Record.To!=t{return PartialLossState{},ErrUnavailable}
 if v.State=="prepared"&&done.Valid||v.State=="removed"&&(!done.Valid||done.Int64<v.Record.RecordedAt)||v.State!="removed"&&v.State!="prepared"{return PartialLossState{},ErrUnavailable}
 if done.Valid{v.CompletedAt=&done.Int64}
 return v,nil
}
func(j *Journal) PartialLoss(ctx context.Context,day string)(PartialLossState,error){
 j.mu.Lock();defer j.mu.Unlock()
 return j.partialLossLocked(ctx,day)
}
func(g *GridIndex) Contains(k model.Kind,key model.Key)(bool,error){
 f,t,e:=g.bounds();if e!=nil{return false,e}
 n,e:=gridOffset(k,f,t,key);if e!=nil{return false,e}
 return g.data(k)[n/8]&(1<<uint(n%8))!=0,nil
}
// lostIntervals marks only actual lost row keys selected by the query.
func(g *GridIndex) lostIntervals(q Query)([]Gap,error){
 f,first,end,e:=g.scanBounds(q);if e!=nil{return nil,e}
 step,width:=q.Kind.Interval(),gridWidth(q.Kind)
 d:=g.data(q.Kind);out:=[]Gap{}
 for t:=first;t<end;t+=step{
  base:=int((t-f)/step)*width
  found:=false
  for s:=0;s<width;s++{n:=base+s;if gridSelected(q.Kind,s,q)&&d[n/8]&(1<<uint(n%8))!=0{found=true;break}}
  if !found{continue}
  stop:=t+step;if stop>end{stop=end}
  if n:=len(out);n>0&&out[n-1].To==t{out[n-1].To=stop}else{out=append(out,Gap{t,stop,"permanent_loss"})}
  if len(out)>4096{return nil,errors.New("too many loss intervals; reduce range")}
 }
 return out,nil
}
func(j *Journal) annotatePartialLossGaps(ctx context.Context,q Query,gaps []Gap)([]Gap,error){
 rs,e:=j.db.QueryContext(ctx,"SELECT day FROM journal_partial_loss WHERE state='removed' AND from_t<? AND to_t>? ORDER BY from_t",q.To,q.From)
 if e!=nil{return nil,e}
 days:=[]string{}
 for rs.Next(){var day string;if e=rs.Scan(&day);e!=nil{rs.Close();return nil,e};days=append(days,day)}
 e=rs.Err();rs.Close();if e!=nil{return nil,e}
 if len(days)==0{return gaps,nil}
 losses:=[]Gap{}
 for _,day:=range days{
  state,e:=j.partialLossLocked(ctx,day);if e!=nil{return nil,e}
  x,e:=state.Record.Lost.lostIntervals(q);if e!=nil{return nil,e}
  losses=append(losses,x...)
 }
 sort.Slice(losses,func(i,k int)bool{return losses[i].From<losses[k].From})
 out:=[]Gap{}
 add:=func(g Gap){
  if g.From>=g.To{return}
  if n:=len(out);n>0&&out[n-1].To==g.From&&out[n-1].Reason==g.Reason{out[n-1].To=g.To;return}
  out=append(out,g)
 }
 for _,g:=range gaps{
  start:=g.From
  for _,l:=range losses{
   if l.To<=start||l.From>=g.To{continue}
   a,b:=l.From,l.To;if a<start{a=start};if b>g.To{b=g.To}
   add(Gap{start,a,g.Reason});add(Gap{a,b,"permanent_loss"});start=b
  }
  add(Gap{start,g.To,g.Reason})
  if len(out)>4096{return nil,errors.New("too many gap intervals; reduce range")}
 }
 return out,nil
}

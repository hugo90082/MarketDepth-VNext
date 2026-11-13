package store

import(
 "context"
 "database/sql"
 "encoding/json"
 "errors"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// LossRecord is the immutable pre-unlink evidence for a closed day without
// any registered recovery object. Partial active backups require a separate
// verified recovery path; this record cannot claim their whole day is lost.
type LossRecord struct{
 Day string `json:"day"`
 From int64 `json:"from"`
 To int64 `json:"to"`
 RowCounts map[string]int64 `json:"row_counts"`
 Revision int64 `json:"revision"`
 LogicalSHA256 string `json:"logical_sha256"`
 ArchiveState string `json:"archive_state"`
 Reason string `json:"reason"`
 RecordedAt int64 `json:"recorded_at"`
}
type LossState struct{
 Record LossRecord `json:"record"`
 State string `json:"state"`
 CompletedAt *int64 `json:"completed_at"`
}
var ErrPendingLoss=errors.New("unreconciled capacity loss intent; writes and reads blocked")
func validateLossRecord(r LossRecord)error{
 a,b,e:=dayRange(r.Day,r.Day)
 if e!=nil||r.From!=a.UnixMilli()||r.To!=b.UnixMilli()+86400000||r.RecordedAt<r.To||r.Revision<1||!validSHA(r.LogicalSHA256)||r.ArchiveState!="no_verified_archive"||r.Reason!="capacity_forced_loss"{return errors.New("invalid loss record")}
 if len(r.RowCounts)!=4{return errors.New("invalid loss counts")}
 for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{
  n,ok:=r.RowCounts[string(k)]
  max:=int64(86400000/k.Interval())*3
  if k==model.Spot{max*=4}
  if !ok||n<0||n>max{return errors.New("invalid loss grid count")}
 }
 n,ok:=r.RowCounts["events"];if !ok||n<0{return errors.New("invalid loss event count")}
 return nil
}
func (j *Journal) lossRecordLocked(ctx context.Context,day string)(LossState,error){
 var out LossState
 var b []byte
 var from,to int64
 var completed sql.NullInt64
 if e:=j.db.QueryRowContext(ctx,"SELECT from_t,to_t,record_json,state,completed_at FROM journal_loss WHERE day=?",day).Scan(&from,&to,&b,&out.State,&completed);e!=nil{return out,e}
 if len(b)>65536||json.Unmarshal(b,&out.Record)!=nil||validateLossRecord(out.Record)!=nil||out.Record.Day!=day||out.Record.From!=from||out.Record.To!=to{return LossState{},ErrUnavailable}
 if out.State=="prepared"&&completed.Valid||out.State=="removed"&&(!completed.Valid||completed.Int64<out.Record.RecordedAt)||out.State!="removed"&&out.State!="prepared"{return LossState{},ErrUnavailable}
 if completed.Valid{out.CompletedAt=&completed.Int64}
 return out,nil
}
func (j *Journal) LossRecord(ctx context.Context,day string)(LossState,error){
 j.mu.Lock();defer j.mu.Unlock()
 return j.lossRecordLocked(ctx,day)
}

// annotateLossGaps splits missing-grid intervals at known permanent loss
// boundaries without altering the query grid or manufacturing rows. Ledger
// records are compact, one per day; callers hold the journal mutex.
func(j *Journal) annotateLossGaps(ctx context.Context,from,to int64,gaps []Gap)([]Gap,error){
 rs,e:=j.db.QueryContext(ctx,"SELECT day FROM journal_loss WHERE state='removed' AND from_t<? AND to_t>? ORDER BY from_t",to,from)
 if e!=nil{return nil,e}
 var days []string
 for rs.Next(){var day string;if e=rs.Scan(&day);e!=nil{rs.Close();return nil,e};days=append(days,day)}
 e=rs.Err();rs.Close();if e!=nil{return nil,e}
 losses:=[]LossRecord{}
 for _,day:=range days{v,e:=j.lossRecordLocked(ctx,day);if e!=nil{return nil,e};losses=append(losses,v.Record)}
 out:=[]Gap{}
 for _,g:=range gaps{
  start:=g.From
  for _,v:=range losses{
   if v.To<=start||v.From>=g.To{continue}
   a,b:=v.From,v.To
   if a<start{a=start};if b>g.To{b=g.To}
   if start<a{out=append(out,Gap{start,a,g.Reason})}
   out=append(out,Gap{a,b,"permanent_loss"})
   start=b
  }
  if start<g.To{out=append(out,Gap{start,g.To,g.Reason})}
  if len(out)>4096{return nil,errors.New("too many gap intervals; query a smaller range")}
 }
 return out,nil
}

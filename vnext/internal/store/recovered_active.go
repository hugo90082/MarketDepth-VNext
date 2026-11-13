package store

import(
 "context"
 "encoding/json"
 "errors"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

var ErrRecoveryIncomplete=errors.New("catalog disaster recovery incomplete; do not start service")
func validateActiveGrid(g *GridIndex,r archive.PublishedRecord)error{
 if g==nil||archive.ValidateActiveRecord(r)!=nil{return ErrUnavailable}
 f,t,e:=g.bounds();m:=r.Manifest
 if e!=nil||g.Day!=m.Day||g.Revision!=m.Revision||g.ManifestSHA256!=r.ManifestSHA256||f!=m.From||t!=m.To{return ErrUnavailable}
 for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{
  n,ok:=m.RowCounts[string(k)];through,has:=m.GridThrough[string(k)]
  if !ok||!has||g.Count(k)!=n||through<f||through>t||(through-f)%k.Interval()!=0{return ErrUnavailable}
  end:=int((through-f)/k.Interval())*gridWidth(k)
  for i:=end;i<gridCapacity(k);i++{if g.data(k)[i/8]&(1<<uint(i%8))!=0{return ErrUnavailable}}
 }
 return nil
}
// A disaster-recovered active snapshot is immutable historical evidence,
// never a finalized sealed day and never a confirmed permanent loss.
func(j *Journal) recoveredActiveLocked(ctx context.Context,day string)(compactDay,error){
 var d compactDay;var f,t int64;var rb,gb []byte
 if e:=j.db.QueryRowContext(ctx,"SELECT from_t,to_t,record_json,grid_json FROM journal_recovered_active WHERE day=?",day).Scan(&f,&t,&rb,&gb);e!=nil{return d,e}
 if len(rb)>2<<20||len(gb)>16384||json.Unmarshal(rb,&d.record)!=nil||json.Unmarshal(gb,&d.grid)!=nil||d.grid.Day!=day||d.record.Manifest.From!=f||d.record.Manifest.To!=t||validateActiveGrid(&d.grid,d.record)!=nil{return compactDay{},ErrUnavailable}
 d.active,d.recovered=true,true
 return d,nil
}

package store

import(
 "context"
 "encoding/json"
 "errors"
 "sort"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
)

// compactIndicesLocked returns validated immutable day indexes with their
// exact registered archive records. Every loader checks the latest revision;
// a mismatched/replaced archive requires explicit rebuild, never silent data
// substitution. The caller holds j.mu.
type compactDay struct{
 grid GridIndex
 record archive.PublishedRecord
 active bool
 recovered bool
}
func(j *Journal) compactIndicesLocked(ctx context.Context,from,to int64)([]compactDay,error){
 rs,e:=j.db.QueryContext(ctx,`SELECT c.day,c.from_t,c.to_t,c.grid_json,a.record_json
 FROM journal_compact c LEFT JOIN journal_archive a ON a.day=c.day AND a.revision=(SELECT MAX(x.revision) FROM journal_archive x WHERE x.day=c.day)
 WHERE c.from_t<? AND c.to_t>? ORDER BY c.from_t`,to,from)
 if e!=nil{return nil,e};defer rs.Close()
 out:=[]compactDay{}
 for rs.Next(){
  var d compactDay;var day string;var f,t int64;var g,b []byte
  if e=rs.Scan(&day,&f,&t,&g,&b);e!=nil{return nil,e}
  if len(g)>16384||len(b)>2<<20||json.Unmarshal(g,&d.grid)!=nil||json.Unmarshal(b,&d.record)!=nil||d.grid.Day!=day||d.grid.ValidateManifest(d.record)!=nil||d.record.Manifest.From!=f||d.record.Manifest.To!=t{return nil,ErrUnavailable}
  if len(out)>0&&out[len(out)-1].record.Manifest.To>f{return nil,ErrUnavailable}
  out=append(out,d)
 }
 e=rs.Err();rs.Close();if e!=nil{return nil,e}
 // Removed partial days have their own immutable recovery bitmap and
 // active snapshot identity; their per-row pointers were pruned in the
 // same finalize transaction. Never treat them as complete sealed days.
 rs,e=j.db.QueryContext(ctx,"SELECT day FROM journal_partial_loss WHERE state='removed' AND from_t<? AND to_t>? ORDER BY from_t",to,from)
 if e!=nil{return nil,e}
 partialDays:=[]string{}
 for rs.Next(){var day string;if e=rs.Scan(&day);e!=nil{rs.Close();return nil,e};partialDays=append(partialDays,day)}
 e=rs.Err();rs.Close();if e!=nil{return nil,e}
 for _,day:=range partialDays{
  p,e:=j.partialLossLocked(ctx,day);if e!=nil{return nil,e}
  out=append(out,compactDay{grid:p.Record.Recoverable,record:p.Record.Active,active:true})
 }
 rs,e=j.db.QueryContext(ctx,"SELECT day FROM journal_recovered_active WHERE from_t<? AND to_t>? ORDER BY from_t",to,from)
 if e!=nil{return nil,e}
 recoveredDays:=[]string{}
 for rs.Next(){var day string;if e=rs.Scan(&day);e!=nil{rs.Close();return nil,e};recoveredDays=append(recoveredDays,day)}
 e=rs.Err();rs.Close();if e!=nil{return nil,e}
 for _,day:=range recoveredDays{x,e:=j.recoveredActiveLocked(ctx,day);if e!=nil{return nil,e};out=append(out,x)}
 sort.Slice(out,func(i,k int)bool{return out[i].record.Manifest.From<out[k].record.Manifest.From})
 for i:=1;i<len(out);i++{if out[i-1].record.Manifest.To>out[i].record.Manifest.From{return nil,ErrUnavailable}}
 return out,nil
}
func(j *Journal) hasCompactLocked(ctx context.Context,from,to int64)(bool,error){
 var n int
 e:=j.db.QueryRowContext(ctx,"SELECT EXISTS(SELECT 1 FROM journal_compact WHERE from_t<? AND to_t>? UNION ALL SELECT 1 FROM journal_partial_loss WHERE state='removed' AND from_t<? AND to_t>? UNION ALL SELECT 1 FROM journal_recovered_active WHERE from_t<? AND to_t>?)",to,from,to,from,to,from).Scan(&n)
 return n!=0,e
}

// The original grid-gap query sees pruned days as missing. Replace exactly
// those day portions with the bitmap's exact gaps. Keep permanent-loss and
// all noncompact intervals, including non-grid-aligned query edges.
func mixedGridGaps(q Query,base []Gap,days []compactDay)([]Gap,error){
 out:=[]Gap{}
 for _,g:=range base{
  start:=g.From
  for _,d:=range days{
   f,t:=d.record.Manifest.From,d.record.Manifest.To
   if t<=start||f>=g.To{continue}
   if f>start{out=append(out,Gap{start,f,g.Reason})}
   if t>start{start=t}
   if start>=g.To{break}
  }
  if start<g.To{out=append(out,Gap{start,g.To,g.Reason})}
 }
 for _,d:=range days{
  gaps,e:=d.grid.Gaps(q);if e!=nil{return nil,e}
  out=append(out,gaps...)
 }
 sort.Slice(out,func(i,k int)bool{return out[i].From<out[k].From})
 merged:=[]Gap{}
 for _,g:=range out{
  if len(merged)>0{
   last:=&merged[len(merged)-1]
   if last.To>g.From{return nil,ErrUnavailable}
   if last.To==g.From&&last.Reason==g.Reason{last.To=g.To;continue}
  }
  merged=append(merged,g)
  if len(merged)>4096{return nil,errors.New("too many gap intervals; query smaller range")}
 }
 return merged,nil
}

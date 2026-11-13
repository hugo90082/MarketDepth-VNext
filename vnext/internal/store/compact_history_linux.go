//go:build linux && sqlite_integration

package store

import(
 "context"
 "errors"
 "fmt"
 "sort"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

type mixedPointer struct{
 ptr readPointer
 compact *compactDay
}

// historyMixed keeps the existing filtered/versioned cursor contract. One
// page contains local journal pointers and/or exact keys from compacted
// sealed-day bitmaps. Only selected days require downloading data; complete
// query gaps are computed from small local indexes, not 31 remote downloads.
func(r *ArchiveReader) historyMixed(ctx context.Context,q Query)(Page,error){
 j:=r.j
 j.mu.Lock()
 p,ptr,version,e:=j.planHistoryLocked(ctx,q)
 if e!=nil{j.mu.Unlock();return p,e}
 days,e:=j.compactIndicesLocked(ctx,q.From,q.To)
 if e!=nil{j.mu.Unlock();return Page{},e}
 if len(days)==0{
  j.mu.Unlock()
  // Keep the already tested noncompact path. It replans after lock release.
  return j.HistoryWithArchive(ctx,q,r.c)
 }
 if q.Cursor==""{
  p.Gaps,e=mixedGridGaps(q,p.Gaps,days)
  if e==nil{p.Gaps,e=j.annotatePartialLossGaps(ctx,q,p.Gaps)}
  if e!=nil{j.mu.Unlock();return Page{},e}
 }
 var after *model.Key
 if q.Cursor!=""{
  old,e:=decode(q.Cursor)
  if e!=nil{j.mu.Unlock();return Page{},ErrResync}
  after=&old.Key
 }
 items:=make([]mixedPointer,0,len(ptr)+q.Limit+1)
 for _,x:=range ptr{items=append(items,mixedPointer{ptr:x})}
 extra:=q.Limit+1
 for i:=range days{
  if extra==0{break}
  d:=&days[i]
  keys,e:=d.grid.Keys(q,after,extra)
  if e!=nil{j.mu.Unlock();return Page{},e}
  for _,k:=range keys{items=append(items,mixedPointer{ptr:readPointer{key:k},compact:d})}
  extra-=len(keys)
 }
 sort.Slice(items,func(i,k int)bool{return items[i].ptr.key.Less(items[k].ptr.key)})
 for i:=1;i<len(items);i++{if items[i-1].ptr.key==items[i].ptr.key{j.mu.Unlock();return Page{},ErrUnavailable}}
 p.Complete=p.Complete&&len(items)<=q.Limit
 if len(items)>q.Limit{items=items[:q.Limit]}
 p.Next=""
 if !p.Complete&&len(items)>0{
  where,args:=rangeWhere(q)
  var seq int64
  if e=j.db.QueryRowContext(ctx,"SELECT COALESCE(MAX(c.seq),0) FROM journal_change c WHERE "+where,args...).Scan(&seq);e!=nil{j.mu.Unlock();return Page{},e}
  p.Next=encode(cursor{Generation:j.generation,Version:seq,Kind:q.Kind,From:q.From,To:q.To,Asset:q.Asset,Venue:q.Venue,Mode:historyMode,Key:items[len(items)-1].ptr.key})
 }
 j.mu.Unlock()
 p.Rows=make([]model.Row,0,len(items))
 for i:=0;i<len(items);{
  end:=i+1
  for end<len(items)&&items[end].compact==items[i].compact&&model.Day(items[end].ptr.key.T)==model.Day(items[i].ptr.key.T){end++}
  if items[i].compact==nil{
   ps:=make([]readPointer,0,end-i)
   for _,x:=range items[i:end]{ps=append(ps,x.ptr)}
   got,e:=j.resolveArchivePointers(ctx,q.Kind,ps,r.c,r.target)
   if e!=nil{return Page{},e}
   p.Rows=append(p.Rows,got...)
  }else{
   d:=items[i].compact
   keys:=make([]JournalKey,0,end-i)
   for _,x:=range items[i:end]{keys=append(keys,JournalKey{q.Kind,x.ptr.key})}
   var got []model.Row
   var err error
   if d.active {got,err=r.c.ReadActive(ctx,d.record,keys)}else{got,err=r.c.Read(ctx,d.record,keys)}
   if err!=nil{return Page{},fmt.Errorf("%w: compacted day unavailable",ErrArchiveUnavailable)}
   if len(got)!=len(keys){return Page{},ErrUnavailable}
   if d.recovered{
    j.mu.Lock();latest,e:=j.recoveredActiveLocked(ctx,d.grid.Day);j.mu.Unlock()
    if e!=nil||latest.record.ManifestSHA256!=d.grid.ManifestSHA256{return Page{},ErrResync}
   }else if d.active{
    latest,e:=j.PartialLoss(ctx,d.grid.Day)
    if e!=nil||latest.State!="removed"||latest.Record.Active.ManifestSHA256!=d.grid.ManifestSHA256{return Page{},ErrResync}
   }else{
    latest,e:=j.ArchiveRecord(ctx,d.grid.Day,0)
    if e!=nil||latest.ManifestSHA256!=d.grid.ManifestSHA256{return Page{},ErrResync}
   }
   p.Rows=append(p.Rows,got...)
  }
  i=end
 }
 if len(p.Rows)!=len(items){return Page{},errors.New("mixed history count mismatch")}
 j.mu.Lock();defer j.mu.Unlock()
 if e=j.ready(ctx);e!=nil{return Page{},e}
 where,args:=rangeWhere(q)
 var seq int64
 if e=j.db.QueryRowContext(ctx,"SELECT COALESCE(MAX(c.seq),0) FROM journal_change c WHERE "+where,args...).Scan(&seq);e!=nil{return Page{},e}
 if fmt.Sprintf("%s:%s:%d",j.generation,q.Kind,seq)!=version{return Page{},ErrResync}
 return p,nil
}

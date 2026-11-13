//go:build linux && sqlite_integration

package store

import (
 "context"
 "errors"
 "fmt"
 "os"
 "path/filepath"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// HistoryWithArchive resolves a bounded page outside the journal mutex.
// It only falls back for an absent local DB; a corrupt existing local DB is
// not concealed. The original catalog pointers and final range barrier
// prevent stale or unrelated remote data from entering a response.
// Also used by the authenticated ArchiveReader.
func (j *Journal) HistoryWithArchive(ctx context.Context,q Query,c *ArchiveReadCache)(Page,error){
 target,ok:=j.target.(managerJournalTarget)
 if !ok||c==nil||c.root!=filepath.Join(target.m.root,"history-cache"){return Page{},ErrUnavailable}
 j.mu.Lock()
 p,ptr,version,e:=j.planHistoryLocked(ctx,q)
 j.mu.Unlock()
 if e!=nil{return Page{},e}
 rows,e:=j.resolveArchivePointers(ctx,q.Kind,ptr,c,target)
 if e!=nil{return Page{},e}
 // RangeVersion uses an unfiltered range; use the exact same predicate
 // as the page plan to preserve asset/venue scoped cursor semantics.
 j.mu.Lock()
 defer j.mu.Unlock()
 if e=j.ready(ctx);e!=nil{return Page{},e}
 where,args:=rangeWhere(q)
 var seq int64
 if e=j.db.QueryRowContext(ctx,`SELECT COALESCE(MAX(c.seq),0) FROM journal_change c WHERE `+where,args...).Scan(&seq);e!=nil{return Page{},e}
 if fmt.Sprintf("%s:%s:%d",j.generation,q.Kind,seq)!=version{return Page{},ErrResync}
 p.Rows=rows
 return p,nil
}

// Resolve the selected page in original order, including sync pages whose
// ingestion order can interleave dates. Never lock the journal during I/O.
func (j *Journal) resolveArchivePointers(ctx context.Context,k model.Kind,ptr []readPointer,c *ArchiveReadCache,target managerJournalTarget)([]model.Row,error){
 rows:=make([]model.Row,len(ptr))
 byDay:=map[string][]int{}
 order:=[]string{}
 for i,p:=range ptr{
  day:=model.Day(p.key.T)
  if _,ok:=byDay[day];!ok{order=append(order,day)}
  byDay[day]=append(byDay[day],i)
 }
 for _,day:=range order{
  indices:=byDay[day]
  keys:=make([]JournalKey,0,len(indices))
  for _,i:=range indices{keys=append(keys,JournalKey{k,ptr[i].key})}
  got,err:=target.m.GetMany(ctx,keys)
  if err!=nil{
   if !errors.Is(err,os.ErrNotExist){return nil,fmt.Errorf("%w: local history read failed",ErrUnavailable)}
   rec,err:=j.ArchiveRecord(ctx,day,0)
   if err!=nil{return nil,fmt.Errorf("%w: sealed archive not registered",ErrArchiveUnavailable)}
   got,err=c.Read(ctx,rec,keys)
   if err!=nil{return nil,fmt.Errorf("%w: sealed archive read failed",ErrArchiveUnavailable)}
   latest,err:=j.ArchiveRecord(ctx,day,0)
   if err!=nil||latest.ManifestSHA256!=rec.ManifestSHA256{return nil,ErrResync}
  }
  if len(got)!=len(indices){return nil,ErrUnavailable}
  for n,r:=range got{
   i:=indices[n];x:=ptr[i]
   if rowNil(r)||r.Kind()!=k||r.Key()!=x.key||r.Base().Revision!=x.rev{return nil,ErrUnavailable}
   h,err:=journalHash(r)
   if err!=nil||h!=x.hash{return nil,ErrUnavailable}
   rows[i]=r
  }
 }
 return rows,nil
}

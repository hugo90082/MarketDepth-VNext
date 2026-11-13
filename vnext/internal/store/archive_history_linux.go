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
// This is not yet the full Reader implementation (Sync/Days/retention follow).
func (j *Journal) HistoryWithArchive(ctx context.Context,q Query,c *ArchiveReadCache)(Page,error){
 target,ok:=j.target.(managerJournalTarget)
 if !ok||c==nil||c.root!=filepath.Join(target.m.root,"history-cache"){return Page{},ErrUnavailable}
 j.mu.Lock()
 p,ptr,version,e:=j.planHistoryLocked(ctx,q)
 j.mu.Unlock()
 if e!=nil{return Page{},e}
 rows:=make([]model.Row,len(ptr))
 for i:=0;i<len(ptr);{
  day:=model.Day(ptr[i].key.T)
  end:=i+1
  for end<len(ptr)&&model.Day(ptr[end].key.T)==day{end++}
  keys:=make([]JournalKey,0,end-i)
  for _,v:=range ptr[i:end]{keys=append(keys,JournalKey{q.Kind,v.key})}
  // GetMany itself locks the manager. Only the missing-file condition
  // allows a remote fallback; other failures remain explicit.
  got,err:=target.m.GetMany(ctx,keys)
  if err!=nil{
   if !errors.Is(err,os.ErrNotExist){return Page{},fmt.Errorf("%w: local history read failed",ErrUnavailable)}
   rec,err:=j.ArchiveRecord(ctx,day,0)
   if err!=nil{return Page{},fmt.Errorf("%w: sealed archive not registered",ErrUnavailable)}
   got,err=c.Read(ctx,rec,keys)
   if err!=nil{return Page{},fmt.Errorf("%w: sealed archive read failed",ErrUnavailable)}
   latest,err:=j.ArchiveRecord(ctx,day,0)
   if err!=nil||latest.ManifestSHA256!=rec.ManifestSHA256{return Page{},ErrResync}
  }
  if len(got)!=end-i{return Page{},ErrUnavailable}
  for n,r:=range got{
   x:=ptr[i+n]
   if rowNil(r)||r.Kind()!=q.Kind||r.Key()!=x.key||r.Base().Revision!=x.rev{return Page{},ErrUnavailable}
   h,err:=journalHash(r)
   if err!=nil||h!=x.hash{return Page{},ErrUnavailable}
   rows[i+n]=r
  }
  i=end
 }
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

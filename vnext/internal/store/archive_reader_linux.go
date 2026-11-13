//go:build linux && sqlite_integration

package store

import (
 "context"
 "database/sql"
 "errors"
 "path/filepath"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// ArchiveReader wraps the existing journal without changing the row contract.
// Remote access is limited to registered sealed data. Latest remains local;
// a remote historical snapshot is never substituted for current live data.
type ArchiveReader struct{
 j *Journal
 c *ArchiveReadCache
 target managerJournalTarget
}
var _ Reader=(*ArchiveReader)(nil)
func NewArchiveReader(j *Journal,c *ArchiveReadCache)(*ArchiveReader,error){
 if j==nil||c==nil{return nil,errors.New("archive reader dependencies required")}
 target,ok:=j.target.(managerJournalTarget)
 if !ok||c.root!=filepath.Join(target.m.root,"history-cache"){return nil,errors.New("archive reader manager mismatch")}
 return &ArchiveReader{j:j,c:c,target:target},nil
}
func(r *ArchiveReader) History(ctx context.Context,q Query)(Page,error){return r.j.HistoryWithArchive(ctx,q,r.c)}
func(r *ArchiveReader) Latest(ctx context.Context,k model.Kind)([]model.Row,error){return r.j.Latest(ctx,k)}
func(r *ArchiveReader) RangeVersion(ctx context.Context,k []model.Kind,from,to int64)(string,error){return r.j.RangeVersion(ctx,k,from,to)}
func(r *ArchiveReader) Sync(ctx context.Context,k model.Kind,cursor string)(Page,error){
 j:=r.j
 j.mu.Lock()
 p,ptr,generation,e:=j.planSyncLocked(ctx,k,cursor)
 j.mu.Unlock()
 if e!=nil{return p,e}
 p.Rows,e=j.resolveArchivePointers(ctx,k,ptr,r.c,r.target)
 if e!=nil{return Page{},e}
 // Concurrent later commits are covered by the next sequence cursor.
 // If one changes a selected pointer before it is read, hash checks above
 // reject the page rather than mix versions.
 j.mu.Lock()
 defer j.mu.Unlock()
 if e=j.ready(ctx);e!=nil{return Page{},e}
 if j.generation!=generation{return Page{},ErrResync}
 return p,nil
}
func(r *ArchiveReader) Days(ctx context.Context,from,to string)([]Day,error){
 days,e:=r.j.Days(ctx,from,to)
 if e!=nil{return nil,e}
 for i:=range days{
  d:=&days[i]
  if d.State!="missing"&&d.State!="sealed_local"{continue}
  rec,e:=r.j.ArchiveRecord(ctx,d.Day,0)
  if errors.Is(e,sql.ErrNoRows){continue}
  if e!=nil{return nil,e}
  m:=rec.Manifest
  // Publication must agree with the local revision if it is still present.
  if d.State=="sealed_local"{
   if d.Revision!=m.Revision{continue}
   for k,n:=range d.Counts{if int64(n)!=m.RowCounts[string(k)]{return nil,ErrUnavailable}}
  }else{
   d.State="sealed_remote"
   d.Revision=m.Revision
   d.Counts=map[model.Kind]int{}
   d.Gaps=[]Gap{}
   for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{
    n:=m.RowCounts[string(k)]
    if n<0||n>47520{return nil,ErrUnavailable}
    d.Counts[k]=int(n)
   }
   // Day summary signals incompleteness without inventing exact intervals.
   // History returns the exact grid gaps from journal pointers.
   for _,n:=range m.MissingGridCounts{if n>0{d.Gaps=append(d.Gaps,Gap{d.From,d.To,"archive_has_grid_gaps_query_history"});break}}
  }
  h,etag:=m.SHA256,rec.ManifestSHA256
  d.SHA256=&h
  d.ETag=&etag
 }
 return days,nil
}

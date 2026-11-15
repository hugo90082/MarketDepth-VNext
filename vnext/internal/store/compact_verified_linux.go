//go:build linux && sqlite_integration

package store

import (
 "context"
 "crypto/rand"
 "database/sql"
 "encoding/hex"
 "encoding/json"
 "errors"
 "net/url"
 "os"
 "path/filepath"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func(j *Journal) dayPointerVersionLocked(ctx context.Context,from,to int64)(count,seq int64,e error){
 e=j.db.QueryRowContext(ctx,"SELECT COUNT(*),COALESCE(MAX(seq),0) FROM journal_change WHERE t>=? AND t<?",from,to).Scan(&count,&seq)
 return
}
func(j *Journal) newestDayLocked(ctx context.Context,day string)(bool,error){
 for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{
  var stamp sql.NullInt64
  if e:=j.db.QueryRowContext(ctx,"SELECT MAX(t) FROM journal_change WHERE kind=?",k).Scan(&stamp);e!=nil{return false,e}
  if stamp.Valid&&model.Day(stamp.Int64)==day{return true,nil}
 }
 return false,nil
}
func(r *ArchiveReader) compactDayPreflightLocked(ctx context.Context,day string)(error){
 j,m:=r.j,r.target.m
 if e:=j.ready(ctx);e!=nil{return e}
 if p,e:=j.archivePending(ctx);e!=nil{return e}else if p!=nil{return ErrArchivePending}
 for _,table:=range []string{"journal_active","journal_loss","journal_compact"}{
  var n int
  if e:=j.db.QueryRowContext(ctx,"SELECT COUNT(*) FROM "+table+" WHERE day=?",day).Scan(&n);e!=nil{return e}
  if n!=0{return errors.New("day not eligible for sealed index compaction")}
 }
 if newest,e:=j.newestDayLocked(ctx,day);e!=nil{return e}else if newest{return errors.New("latest day protected")}
 a,_,e:=dayRange(day,day);if e!=nil{return e}
 m.mu.Lock();defer m.mu.Unlock()
 if m.closed||m.now().Before(a.Add(24*time.Hour+m.grace))||(m.daily!=nil&&m.daily.day==day){return errors.New("day still active")}
 p,e:=m.path(day);if e!=nil{return e}
 for _,name:=range []string{p,p+"-wal",p+"-shm"}{if _,e=os.Lstat(name);!errors.Is(e,os.ErrNotExist){return errors.New("local day must be reclaimed before compaction")}}
 return nil
}
func(r *ArchiveReader) buildVerifiedGrid(ctx context.Context,rec archive.PublishedRecord)(*GridIndex,int64,int64,error){
 j,c:=r.j,r.c
 m:=rec.Manifest
 j.mu.Lock()
 e:=r.compactDayPreflightLocked(ctx,m.Day)
 var count,seq int64
 if e==nil{count,seq,e=j.dayPointerVersionLocked(ctx,m.From,m.To)}
 j.mu.Unlock()
 if e!=nil{return nil,0,0,e}
 if e=c.acquire(ctx);e!=nil{return nil,0,0,e}
 defer func(){<-c.slot}()
 if e=c.drop();e!=nil{return nil,0,0,e}
 if e=c.materialize(ctx,rec);e!=nil{return nil,0,0,e}
 g,e:=NewGridIndex(m.Day,m.Revision,rec.ManifestSHA256);if e!=nil{return nil,0,0,e}
 u:=url.URL{Scheme:"file",Path:c.path};q:=u.Query();q.Set("mode","ro");q.Set("immutable","1");q.Set("_query_only","1");u.RawQuery=q.Encode()
 db,e:=sql.Open("sqlite3",u.String());if e!=nil{return nil,0,0,e}
 defer db.Close()
 db.SetMaxOpenConns(1)
 for _,kind:=range []model.Kind{model.Spot,model.F10,model.F1}{
  var after *model.Key
  for{
   where:="c.kind=? AND c.t>=? AND c.t<?"
   args:=[]any{kind,m.From,m.To}
   if after!=nil{where+=" AND (c.t,c.venue,c.asset)>(?,?,?)";args=append(args,after.T,after.Venue,after.Asset)}
   j.mu.Lock()
   ptr,e:=j.readPointers(ctx,kind,where,args,256)
   j.mu.Unlock()
   if e!=nil{return nil,0,0,e}
   for _,p:=range ptr{
    row,e:=readRow(ctx,db,kind,p.key)
    if e!=nil||rowNil(row)||row.Kind()!=kind||row.Key()!=p.key||row.Base().Revision!=p.rev{return nil,0,0,ErrUnavailable}
    h,e:=journalHash(row);if e!=nil||h!=p.hash{return nil,0,0,errors.New("sealed row does not match catalog pointer")}
    if e=g.Add(kind,p.key);e!=nil{return nil,0,0,e}
   }
   if len(ptr)<256{break}
   key:=ptr[len(ptr)-1].key;after=&key
  }
 }
 if e=g.ValidateManifest(rec);e!=nil{return nil,0,0,e}
 // No more need for restored bytes; free capacity before the journal WAL
 // transaction. Closing the immutable connection must precede unlink.
 if e=db.Close();e!=nil{return nil,0,0,e}
 if e=c.drop();e!=nil{return nil,0,0,e}
 return g,count,seq,nil
}
func catalogMutationBudget(root string)(int64,error){
 var total int64
 for _,name:=range []string{"catalog.db","catalog.db-wal","catalog.db-shm"}{
  st,e:=os.Lstat(filepath.Join(root,name))
  if errors.Is(e,os.ErrNotExist)&&name!="catalog.db"{continue}
  if e!=nil||!st.Mode().IsRegular()||st.Size()<0||st.Size()>archive.HardLimit-total{return 0,ErrUnavailable}
  total+=st.Size()
 }
 if total>(archive.HardLimit-archiveSlack)/2{return 0,ErrUnavailable}
 return 2*total+archiveSlack,nil
}

// CompactVerifiedDay is an unscheduled maintenance operation. Only a day
// with durable sealed publication, no local copy, no pending work, and no
// latest-live dependence can be compacted. Every remote row is compared
// to the current latest journal hash and revision before atomic replacement
// by the immutable bitmap. Old repair audits remain intact.
func(r *ArchiveReader) CompactVerifiedDay(ctx context.Context,day string)error{
 j,m,c:=r.j,r.target.m,r.c
 j.archiveMu.Lock();defer j.archiveMu.Unlock()
 rec,e:=j.ArchiveRecord(ctx,day,0);if e!=nil{return e}
 g,count,seq,e:=r.buildVerifiedGrid(ctx,rec);if e!=nil{return e}
 budget,e:=catalogMutationBudget(m.root);if e!=nil{return e}
 release,e:=c.reserve(ctx,budget);if e!=nil{return e}
 defer release()
 j.mu.Lock();defer j.mu.Unlock()
 if e=r.compactDayPreflightLocked(ctx,day);e!=nil{return e}
 man:=rec.Manifest
 n,s,e:=j.dayPointerVersionLocked(ctx,man.From,man.To)
 if e!=nil||n!=count||s!=seq{return ErrResync}
 var latest []byte
 if e=j.db.QueryRowContext(ctx,"SELECT record_json FROM journal_archive WHERE day=? ORDER BY revision DESC LIMIT 1",day).Scan(&latest);e!=nil{return e}
 expected,e:=json.Marshal(rec);if e!=nil||string(expected)!=string(latest){return ErrResync}
 blob,e:=json.Marshal(g);if e!=nil||len(blob)>16384{return ErrUnavailable}
 var seed [16]byte
 if _,e=rand.Read(seed[:]);e!=nil{return e}
 generation:=hex.EncodeToString(seed[:])
 tx,e:=j.db.BeginTx(ctx,nil);if e!=nil{return e}
 defer tx.Rollback()
 if _,e=tx.ExecContext(ctx,"INSERT INTO journal_compact(day,from_t,to_t,grid_json) VALUES(?,?,?,?)",day,man.From,man.To,blob);e!=nil{return e}
 res,e:=tx.ExecContext(ctx,"DELETE FROM journal_change WHERE t>=? AND t<?",man.From,man.To);if e!=nil{return e}
 if removed,e:=res.RowsAffected();e!=nil||removed!=count{return ErrResync}
 if _,e=tx.ExecContext(ctx,"UPDATE journal_meta SET value=? WHERE key='generation'",generation);e!=nil{return e}
 if e=tx.Commit();e!=nil{return e}
 j.generation=generation
 return nil
}

// CatalogFreePages returns the current freelist_count when auto_vacuum is INCREMENTAL.
func(r *ArchiveReader) CatalogFreePages(ctx context.Context)(int,error){
 j:=r.j
 j.mu.Lock();defer j.mu.Unlock()
 if e:=j.ready(ctx);e!=nil{return 0,e}
 var mode,free int
 if e:=j.db.QueryRowContext(ctx,"PRAGMA auto_vacuum").Scan(&mode);e!=nil{return 0,e}
 if mode!=2{return 0,nil}
 if e:=j.db.QueryRowContext(ctx,"PRAGMA freelist_count").Scan(&free);e!=nil{return 0,e}
 return free,nil
}

// VacuumCatalogCycle returns freed pages to the filesystem on incremental
// catalogs, one bounded job. Older mode=none catalogs reuse freelist pages
// without allocating a full duplicate database. No unbudgeted full VACUUM.
func(r *ArchiveReader) VacuumCatalogCycle(ctx context.Context)(string,error){
 j,m,c:=r.j,r.target.m,r.c
 j.archiveMu.Lock();defer j.archiveMu.Unlock()
 var mode,free int
 j.mu.Lock()
 e:=j.ready(ctx)
 if e==nil{e=j.db.QueryRowContext(ctx,"PRAGMA auto_vacuum").Scan(&mode)}
 if e==nil{e=j.db.QueryRowContext(ctx,"PRAGMA freelist_count").Scan(&free)}
 j.mu.Unlock()
 if e!=nil{return "",e}
 if mode!=2||free==0{return "idle",nil}
 budget,e:=catalogMutationBudget(m.root);if e!=nil{return "",e}
 release,e:=c.reserve(ctx,budget);if e!=nil{return "",e}
 defer release()
 j.mu.Lock();defer j.mu.Unlock()
 if e=j.ready(ctx);e!=nil{return "",e}
 rows,e:=j.db.QueryContext(ctx,"PRAGMA incremental_vacuum(2048)")
 if e!=nil{return "",e}
 for rows.Next(){}
 _=rows.Close()
 var afterFree int
 _=j.db.QueryRowContext(ctx,"PRAGMA freelist_count").Scan(&afterFree)
 var busy,frames,done int
 if e=j.db.QueryRowContext(ctx,"PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy,&frames,&done);e!=nil{return "",e}
 if busy!=0||frames!=0||done!=0{return "",errors.New("catalog checkpoint incomplete")}
 if afterFree>=free{return "idle",nil}
 return "catalog_vacuum",nil
}

// CompactVerifiedCycle processes one already reclaimed, sealed day at most.
// No active/current day can be selected; no network I/O under j.mu. Limit
// candidate enumeration to a small batch and keep original chronological order.
func(r *ArchiveReader) CompactVerifiedCycle(ctx context.Context)(string,error){
 j,m:=r.j,r.target.m
 local,e:=m.archiveDays();if e!=nil{return "",e}
 present:=map[string]bool{}
 for _,day:=range local{present[day]=true}
 var days []string
 e=func()error{
  j.mu.Lock();defer j.mu.Unlock()
  if e:=j.ready(ctx);e!=nil{return e}
  if p,e:=j.archivePending(ctx);e!=nil{return e}else if p!=nil{return ErrArchivePending}
  rs,e:=j.db.QueryContext(ctx,`SELECT DISTINCT a.day FROM journal_archive a
  WHERE NOT EXISTS(SELECT 1 FROM journal_compact c WHERE c.day=a.day)
    AND NOT EXISTS(SELECT 1 FROM journal_active x WHERE x.day=a.day)
    AND NOT EXISTS(SELECT 1 FROM journal_loss l WHERE l.day=a.day)
  ORDER BY a.day LIMIT 64`)
  if e!=nil{return e}
  for rs.Next(){var day string;if e=rs.Scan(&day);e!=nil{rs.Close();return e};days=append(days,day)}
  e=rs.Err();rs.Close();return e
 }()
 if e!=nil{return "",e}
 for _,day:=range days{
  if e=ctx.Err();e!=nil{return "",e}
  if present[day]{continue}
  j.mu.Lock();newest,e:=j.newestDayLocked(ctx,day);j.mu.Unlock()
  if e!=nil{return "",e}
  if newest{continue}
  if e=r.CompactVerifiedDay(ctx,day);e!=nil{return "",e}
  return "catalog_compacted",nil
 }
 return "idle",nil
}

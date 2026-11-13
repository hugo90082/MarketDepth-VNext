//go:build linux && sqlite_integration

package store

import (
 "context"
 "crypto/sha256"
 "database/sql"
 "encoding/hex"
 "errors"
 "io"
 "net/url"
 "os"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// ArchiveReadCache is a single-day disposable cache. It is owned by the
// manager holding the exclusive writer process lock. Create exactly one per
// manager, before serving queries. Never call Read while holding journal.mu
// or manager.mu: remote verification and reservation may take time.
type ArchiveReadCache struct {
 root string
 remote archive.RemoteObjects
 reserve ArchiveReserve
 slot chan struct{}
 dir, path, digest string
}

func NewArchiveReadCache(m *Manager, remote archive.RemoteObjects, reserve ArchiveReserve) (*ArchiveReadCache,error) {
 if m == nil || remote == nil || reserve == nil { return nil, errors.New("history cache dependencies required") }
 m.mu.Lock()
 defer m.mu.Unlock()
 if m.closed || m.historyCacheOpened {return nil,errors.New("history cache already opened or manager closed")}
 root,e:=privateScratch(m.root,"history-cache")
 if e!=nil{return nil,e}
 // A new process cannot trust a cached file from a prior process. Only
 // recognized files within the owned scratch directory may be removed.
 if e=cleanScratch(root,verifyFile,".history-");e!=nil{return nil,e}
 m.historyCacheOpened=true
 return &ArchiveReadCache{root:root,remote:remote,reserve:reserve,slot:make(chan struct{},1)},nil
}
func (c *ArchiveReadCache) acquire(ctx context.Context) error {
 if e:=ctx.Err();e!=nil{return e}
 select {case c.slot<-struct{}{}:return nil; default:return ErrUnavailable}
}
func (c *ArchiveReadCache) drop() error {
 if c.dir=="" {return nil}
 if e:=cleanJob(c.root,c.dir,verifyFile);e!=nil{return e}
 c.dir,c.path,c.digest="","",""
 return nil
}
func (c *ArchiveReadCache) Clear(ctx context.Context) error {
 if e:=c.acquire(ctx);e!=nil{return e}
 defer func(){<-c.slot}()
 return c.drop()
}
func cacheIntegrity(ctx context.Context,path string,m archive.Manifest) error {
 st,e:=os.Lstat(path)
 if e!=nil || !st.Mode().IsRegular() || st.Size()!=m.RawSize {return ErrUnavailable}
 f,e:=os.Open(path)
 if e!=nil{return e}
 defer f.Close()
 h:=sha256.New()
 n,e:=io.Copy(h,io.LimitReader(&contextReader{ctx,f},m.RawSize+1))
 if e!=nil||n!=m.RawSize||hex.EncodeToString(h.Sum(nil))!=m.RawSHA256{return ErrUnavailable}
 return ctx.Err()
}
func (c *ArchiveReadCache) materialize(ctx context.Context,r archive.PublishedRecord) error {return c.materializeRecord(ctx,r,false)}
func (c *ArchiveReadCache) materializeRecord(ctx context.Context,r archive.PublishedRecord,active bool) error {
 m:=r.Manifest
 var validation error
 if active{validation=archive.ValidateActiveRecord(r)}else{validation=archive.ValidateRecord(r)}
 if validation!=nil{return validation}
 // Include both transient compressed and raw files, plus directory / block
 // rounding headroom. A large day fails closed instead of exceeding cache.
 if m.Size>archive.CacheLimit-archiveSlack || m.RawSize>archive.CacheLimit-archiveSlack-m.Size{return errors.New("sealed day exceeds history cache budget")}
 if c.digest==r.ManifestSHA256 && c.path!="" {
  if e:=cacheIntegrity(ctx,c.path,m);e==nil{return nil}
 }
 if e:=c.drop();e!=nil{return e}
 used,e:=archive.MeasureAllocated(c.root)
 if e!=nil{return e}
 budget:=m.Size+m.RawSize+archiveSlack
 if used>archive.CacheLimit-budget{return errors.New("history cache capacity unavailable")}
 release,e:=c.reserve(ctx,budget)
 if e!=nil{return e}
 defer release()
 dir,e:=os.MkdirTemp(c.root,".history-")
 if e!=nil{return e}
 c.dir=dir
 var path string
 verify:=func(ctx context.Context,man archive.Manifest,body io.Reader) error {
  var err error
  if active{path,err=RestoreVerifiedActive(ctx,man,body,dir,budget)}else{path,err=RestoreVerifiedDay(ctx,man,body,dir,budget)}
  return err
 }
 if e=archive.VerifyPublished(ctx,c.remote,r,active,verify);e!=nil{return errors.Join(e,c.drop())}
 if path=="" {return errors.Join(ErrUnavailable,c.drop())}
 used,e=archive.MeasureAllocated(c.root)
 if e!=nil||used>archive.CacheLimit{return errors.Join(ErrUnavailable,e,c.drop())}
 c.path,c.digest=path,r.ManifestSHA256
 return nil
}

// Read returns rows in requested order from one exact sealed revision.
// The caller still compares each row's revision/hash against authoritative
// journal pointers; this cache never changes the journal or daily DB.
func (c *ArchiveReadCache) Read(ctx context.Context,r archive.PublishedRecord,keys []JournalKey)([]model.Row,error){return c.readRecord(ctx,r,keys,false)}
func (c *ArchiveReadCache) ReadActive(ctx context.Context,r archive.PublishedRecord,keys []JournalKey)([]model.Row,error){return c.readRecord(ctx,r,keys,true)}
func (c *ArchiveReadCache) readRecord(ctx context.Context,r archive.PublishedRecord,keys []JournalKey,active bool)([]model.Row,error){
 if len(keys)==0||len(keys)>2000{return nil,errors.New("invalid archive read batch")}
 for _,k:=range keys {
  if !k.Kind.Valid()||model.Day(k.Key.T)!=r.Manifest.Day{return nil,errors.New("archive read key outside day")}
 }
 if e:=c.acquire(ctx);e!=nil{return nil,e}
 defer func(){<-c.slot}()
 if e:=c.materializeRecord(ctx,r,active);e!=nil{return nil,e}
 // Immutable, read-only connection: no SQLite WAL/SHM or writes.
 u:=url.URL{Scheme:"file",Path:c.path}
 q:=u.Query();q.Set("mode","ro");q.Set("immutable","1");q.Set("_query_only","1");u.RawQuery=q.Encode()
 db,e:=sql.Open("sqlite3",u.String())
 if e!=nil{return nil,e}
 defer db.Close()
 db.SetMaxOpenConns(1)
 out:=make([]model.Row,0,len(keys))
 for _,k:=range keys {
  row,e:=readRow(ctx,db,k.Kind,k.Key)
  if e!=nil||rowNil(row)||row.Kind()!=k.Kind||row.Key()!=k.Key{return nil,errors.Join(ErrUnavailable,e)}
  out=append(out,row)
 }
 return out,nil
}

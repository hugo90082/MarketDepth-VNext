//go:build linux && sqlite_integration

package store

import (
 "context"
 "errors"
 "io"
 "os"
 "sync"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
)

type downloadLease struct{
 *os.File
 once sync.Once
 release func()error
 err error
}
func (d *downloadLease) Close() error {
 d.once.Do(func(){d.err=errors.Join(d.File.Close(),d.release())})
 return d.err
}

// OpenCompressed verifies the manifest, exact compressed bytes and restored
// SQLite before returning a stream. The single cache slot and shared budget
// remain leased through response Close, so neither eviction nor a competing
// download can remove the file while a client is reading.
func(c *ArchiveReadCache) OpenCompressed(ctx context.Context,r archive.PublishedRecord)(io.ReadCloser,error){
 if e:=archive.ValidateRecord(r);e!=nil{return nil,e}
 m:=r.Manifest
 if m.Size<=0||m.RawSize<=0||m.Size>(archive.CacheLimit-archiveSlack)/2||m.RawSize>archive.CacheLimit-archiveSlack-2*m.Size{return nil,ErrArchiveUnavailable}
 if e:=c.acquire(ctx);e!=nil{return nil,e}
 var release func()
 handedOff:=false
 var f *os.File
 defer func(){
  if !handedOff{
   if f!=nil{_ = f.Close()}
   _ = c.drop()
   if release!=nil{release()}
   <-c.slot
  }
 }()
 if e:=c.drop();e!=nil{return nil,e}
 budget:=2*m.Size+m.RawSize+archiveSlack
 used,e:=archive.MeasureAllocated(c.root)
 if e!=nil||used>archive.CacheLimit-budget{return nil,ErrArchiveUnavailable}
 release,e=c.reserve(ctx,budget)
 if e!=nil{return nil,e}
 dir,e:=os.MkdirTemp(c.root,".history-download-")
 if e!=nil{return nil,e}
 c.dir=dir
 f,e=os.CreateTemp(dir,".restore-*.gz.part")
 if e!=nil{return nil,e}
 verify:=func(ctx context.Context,man archive.Manifest,b io.Reader)error{
  bw:=&budgetWriter{w:f,remaining:man.Size}
  _,e:=RestoreVerifiedDay(ctx,man,io.TeeReader(b,bw),dir,budget)
  if e!=nil{return e}
  if bw.remaining!=0{return ErrArchiveUnavailable}
  return nil
 }
 if e=archive.VerifyPublished(ctx,c.remote,r,false,verify);e!=nil{return nil,e}
 if e=f.Sync();e!=nil{return nil,e}
 if _,e=f.Seek(0,io.SeekStart);e!=nil{return nil,e}
 used,e=archive.MeasureAllocated(c.root)
 if e!=nil||used>archive.CacheLimit{return nil,ErrArchiveUnavailable}
 if e=ctx.Err();e!=nil{return nil,e}
 body:=&downloadLease{File:f,release:func()error{
  defer func(){release();<-c.slot}()
  return c.drop()
 }}
 handedOff=true
 return body,nil
}

func(r *ArchiveReader) OpenSealed(ctx context.Context,day string,rev int64)(SealedDownload,error){
 if _,_,e:=dayRange(day,day);e!=nil||rev<0{return SealedDownload{},ErrArchiveUnavailable}
 rec,e:=r.j.ArchiveRecord(ctx,day,rev)
 if e!=nil{return SealedDownload{},ErrArchiveUnavailable}
 body,e:=r.c.OpenCompressed(ctx,rec)
 if e!=nil{return SealedDownload{},ErrArchiveUnavailable}
 latest,e:=r.j.ArchiveRecord(ctx,day,rev)
 if e!=nil||latest.ManifestSHA256!=rec.ManifestSHA256{
  body.Close()
  return SealedDownload{},ErrResync
 }
 m:=rec.Manifest
 return SealedDownload{Day:day,Revision:m.Revision,Size:m.Size,SHA256:m.SHA256,ETag:rec.ManifestSHA256,Body:body},nil
}

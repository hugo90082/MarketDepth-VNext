//go:build linux && sqlite_integration

package store

import (
 "context"
 "crypto/sha256"
 "database/sql"
 "encoding/hex"
 "encoding/json"
 "errors"
 "net/url"
 "os"
 "path/filepath"
 "strings"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// sealedLogicalDigest compares all contract tables, metadata and events
// in deterministic order, independently of VACUUM/page layout. It streams
// rows, never materializes an entire day. Caller protects the sealed file
// against concurrent changes and proves no outstanding WAL.
func sealedLogicalDigest(ctx context.Context,path,day string)(string,error){
 u:=url.URL{Scheme:"file",Path:path}
 q:=u.Query();q.Set("mode","ro");q.Set("immutable","1");q.Set("_query_only","1");u.RawQuery=q.Encode()
 db,e:=sql.Open("sqlite3",u.String());if e!=nil{return "",e}
 defer db.Close()
 db.SetMaxOpenConns(1)
 if e=validateDayMetadata(ctx,db,day);e!=nil{return "",e}
 var check string
 if e=db.QueryRowContext(ctx,"PRAGMA quick_check").Scan(&check);e!=nil||check!="ok"{return "",ErrUnavailable}
 var sealed string
 if e=db.QueryRowContext(ctx,"SELECT value FROM meta WHERE key='sealed_at'").Scan(&sealed);e!=nil||sealed==""{return "",ErrUnavailable}
 h:=sha256.New()
 enc:=json.NewEncoder(h)
 scan:=func(name,cols,order string)error{
  if e:=enc.Encode(name);e!=nil{return e}
  rs,e:=db.QueryContext(ctx,"SELECT "+cols+" FROM "+name+" ORDER BY "+order)
  if e!=nil{return e}
  defer rs.Close()
  names,e:=rs.Columns();if e!=nil{return e}
  v:=make([]any,len(names));p:=make([]any,len(v))
  for i:=range p{p[i]=&v[i]}
  for rs.Next(){
   if e=rs.Scan(p...);e!=nil{return e}
   if e=enc.Encode(v);e!=nil{return e}
  }
  return rs.Err()
 }
 if e=scan("meta","key,value","key");e!=nil{return "",e}
 for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{
  if e=scan(string(k),strings.Join(columns[k],","),strings.Join(keyCols(k),","));e!=nil{return "",e}
 }
 if e=scan("events","id,t,venue,asset,code,message,from_t,to_t,quality_json","id");e!=nil{return "",e}
 return hex.EncodeToString(h.Sum(nil)),nil
}

// EvictVerifiedLocalDay is a deliberately unscheduled primitive. It may
// remove only a sealed day from this exclusive writer's isolated root, after
// fresh remote readback and exact logical equality including events.
// The journal pointers and archive record remain intact. No unverified
// day can enter this path. Never call it for an active/grace day.
func(r *ArchiveReader) EvictVerifiedLocalDay(ctx context.Context,day string)error{
 j,m,c:=r.j,r.target.m,r.c
 a,_,e:=dayRange(day,day)
 if e!=nil{return e}
 // serialize against publication/retirement; no journal or manager lock
 // during remote I/O.
 j.archiveMu.Lock()
 defer j.archiveMu.Unlock()
 if m.now().Before(a.Add(24*time.Hour+m.grace)){return errors.New("active or grace day protected")}
 rec,e:=j.ArchiveRecord(ctx,day,0);if e!=nil{return e}
 if e=c.acquire(ctx);e!=nil{return e}
 defer func(){<-c.slot}()
 // Fresh readback is required even if a prior cache is valid.
 if e=c.drop();e!=nil{return e}
 if e=c.materialize(ctx,rec);e!=nil{return e}
 remoteDigest,e:=sealedLogicalDigest(ctx,c.path,day);if e!=nil{return e}

 j.mu.Lock()
 defer j.mu.Unlock()
 if e=j.ready(ctx);e!=nil{return e}
 if pending,e:=j.archivePending(ctx);e!=nil{return e}else if pending!=nil{return ErrArchivePending}
 var b []byte
 if e=j.db.QueryRowContext(ctx,`SELECT record_json FROM journal_archive WHERE day=? ORDER BY revision DESC LIMIT 1`,day).Scan(&b);e!=nil{return e}
 expected,e:=json.Marshal(rec);if e!=nil||string(expected)!=string(b){return ErrResync}
 m.mu.Lock()
 defer m.mu.Unlock()
 if m.closed||!m.catalogOpened||m.now().Before(a.Add(24*time.Hour+m.grace))||(m.daily!=nil&&m.daily.day==day){return errors.New("day in use")}
 p,e:=m.path(day);if e!=nil{return e}
 st,e:=os.Lstat(p)
 if e!=nil{return e}
 if !st.Mode().IsRegular(){return ErrUnavailable}
 // Sealing checkpoints and closes this day. Reject any nonempty WAL
 // rather than ignoring a possible committed frame. The manager lock
 // protects all local readers and the current writer.
 for _,s:=range []string{"-wal","-shm"}{
  info,err:=os.Lstat(p+s)
  if errors.Is(err,os.ErrNotExist){continue}
  if err!=nil||!info.Mode().IsRegular()||s=="-wal"&&info.Size()!=0{return errors.New("uncheckpointed or unsafe sidecar")}
 }
 localDigest,e:=sealedLogicalDigest(ctx,p,day)
 if e!=nil{return e}
 if localDigest!=remoteDigest{return errors.New("local sealed content differs from verified remote")}
 if e=ctx.Err();e!=nil{return e}
 // Checkpointed sidecars can be removed first. A crash before the final
 // unlink still leaves a valid sealed DB; after it the durable catalog
 // points to a verified immutable archive. Never delete journal records.
 for _,s:=range []string{"-wal","-shm"}{
  if e=os.Remove(p+s);e!=nil&&!errors.Is(e,os.ErrNotExist){return e}
 }
 if e=os.Remove(p);e!=nil{return e}
 d,e:=os.Open(filepath.Dir(p));if e!=nil{return e}
 return errors.Join(d.Sync(),d.Close())
}

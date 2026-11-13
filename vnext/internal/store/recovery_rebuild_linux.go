//go:build linux && sqlite_integration

package store

import(
 "context"
 "database/sql"
 "encoding/json"
 "errors"
 "io"
 "net/url"
 "os"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// The immutable restore is already checked against both compressed and
// raw hashes. Build exact grid presence and validate every actual row.
// Only one row is materialized at a time, independent of archive size.
func recoveryGrid(ctx context.Context,path string,r archive.PublishedRecord,active bool)(*GridIndex,error){
 m:=r.Manifest
 g,e:=NewGridIndex(m.Day,m.Revision,r.ManifestSHA256);if e!=nil{return nil,e}
 u:=url.URL{Scheme:"file",Path:path};q:=u.Query();q.Set("mode","ro");q.Set("immutable","1");q.Set("_query_only","1");u.RawQuery=q.Encode()
 db,e:=sql.Open("sqlite3",u.String());if e!=nil{return nil,e}
 defer db.Close();db.SetMaxOpenConns(1)
 for _,kind:=range []model.Kind{model.Spot,model.F10,model.F1}{
  var after *model.Key
  for{
   venue:="venue";if kind!=model.Spot{venue="''"}
   query:="SELECT t,"+venue+",asset FROM "+string(kind);args:=[]any{}
   if after!=nil{
    if kind==model.Spot{query+=" WHERE (t,venue,asset)>(?,?,?)";args=append(args,after.T,after.Venue,after.Asset)}else{query+=" WHERE (t,asset)>(?,?)";args=append(args,after.T,after.Asset)}
   }
   query+=" ORDER BY t";if kind==model.Spot{query+=",venue"};query+=",asset LIMIT 256"
   rs,e:=db.QueryContext(ctx,query,args...);if e!=nil{return nil,e}
   keys:=make([]model.Key,0,256)
   for rs.Next(){var k model.Key;if e=rs.Scan(&k.T,&k.Venue,&k.Asset);e!=nil{rs.Close();return nil,e};keys=append(keys,k)}
   e=rs.Err();rs.Close();if e!=nil{return nil,e}
   for _,k:=range keys{
    row,e:=readRow(ctx,db,kind,k)
    if e!=nil||rowNil(row)||row.Key()!=k||row.Kind()!=kind||row.Validate()!=nil||validateLiveWrite(row,true)!=nil{return nil,ErrUnavailable}
    if e=g.Add(kind,k);e!=nil{return nil,e}
   }
   if len(keys)<256{break}
   k:=keys[len(keys)-1];after=&k
  }
 }
 if active{e=validateActiveGrid(g,r)}else{e=g.ValidateManifest(r)}
 if e!=nil{return nil,e}
 return g,nil
}
func verifyRecoveryGrid(ctx context.Context,remote archive.RemoteObjects,r archive.PublishedRecord,active bool,scratch string,reserve ArchiveReserve)(*GridIndex,error){
 budget,e:=restoreReserve(r.Manifest);if e!=nil{return nil,e}
 release,e:=reserve(ctx,budget);if e!=nil{return nil,e}
 defer release()
 dir,e:=os.MkdirTemp(scratch,".verify-");if e!=nil{return nil,e}
 defer cleanJob(scratch,dir,verifyFile)
 var grid *GridIndex
 verify:=func(ctx context.Context,m archive.Manifest,body io.Reader)error{
  var path string;var e error
  if active{path,e=RestoreVerifiedActive(ctx,m,body,dir,budget)}else{path,e=RestoreVerifiedDay(ctx,m,body,dir,budget)}
  if e!=nil{return e}
  grid,e=recoveryGrid(ctx,path,r,active)
  return e
 }
 if e=archive.VerifyPublished(ctx,remote,r,active,verify);e!=nil{return nil,e}
 if grid==nil{return nil,ErrUnavailable}
 if e=cleanJob(scratch,dir,verifyFile);e!=nil{return nil,e}
 return grid,nil
}
type RecoveryResult struct{
 SealedDays int `json:"sealed_days"`
 SealedRevisions int `json:"sealed_revisions"`
 FullLossDays int `json:"full_loss_days"`
 PartialLossDays int `json:"partial_loss_days"`
 SnapshotOnlyDays int `json:"snapshot_only_days"`
}
func(j *Journal) beginRecoveryLocked(ctx context.Context,m *Manager)error{
 if e:=j.ready(ctx);e!=nil{return e}
 for _,table:=range []string{"journal_intent","journal_change","journal_archive_pending","journal_loss","journal_compact","journal_loss_sync","journal_active_recovery","journal_partial_loss","journal_recovered_active","journal_active","journal_archive","journal_repair"}{
  var n int
  if e:=j.db.QueryRowContext(ctx,"SELECT COUNT(*) FROM "+table).Scan(&n);e!=nil{return e}
  if n!=0{return errors.New("recovery requires an empty new catalog")}
 }
 days,e:=m.archiveDays();if e!=nil{return e};if len(days)!=0{return errors.New("recovery cannot replace local daily files")}
 var state string
 e=j.db.QueryRowContext(ctx,"SELECT value FROM journal_meta WHERE key='recovery_state'").Scan(&state)
 if !errors.Is(e,sql.ErrNoRows){return errors.New("catalog recovery already attempted")}
 if _,e=j.db.ExecContext(ctx,"INSERT INTO journal_meta(key,value) VALUES('recovery_state','building')");e!=nil{return e}
 j.rebuilding=true
 return nil
}
func subsetGrid(a,b *GridIndex)bool{
 for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{
  x,y:=a.data(k),b.data(k);if len(x)!=len(y){return false}
  for i:=range x{if x[i]&^y[i]!=0{return false}}
 }
 return true
}
func(j *Journal) insertRecoveryDay(ctx context.Context,d RecoveryDay,grid *GridIndex)error{
 j.mu.Lock();defer j.mu.Unlock()
 if !j.rebuilding{return ErrRecoveryIncomplete}
 tx,e:=j.db.BeginTx(ctx,nil);if e!=nil{return e}
 defer tx.Rollback()
 var now=time.Now().UnixMilli()
 putRecord:=func(r archive.PublishedRecord)error{
  b,e:=json.Marshal(r);if e!=nil{return e}
  _,e=tx.ExecContext(ctx,"INSERT INTO journal_archive(day,revision,record_json,verified_at) VALUES(?,?,?,?)",r.Manifest.Day,r.Manifest.Revision,b,now);return e
 }
 switch{
 case d.Sealed!=nil:
  if grid==nil||grid.ValidateManifest(*d.Sealed)!=nil{return ErrUnavailable}
  for _,r:=range d.SealedRevisions{if e=putRecord(r);e!=nil{return e}}
  b,e:=json.Marshal(grid);if e!=nil{return e}
  m:=d.Sealed.Manifest
  if _,e=tx.ExecContext(ctx,"INSERT INTO journal_compact(day,from_t,to_t,grid_json) VALUES(?,?,?,?)",m.Day,m.From,m.To,b);e!=nil{return e}
 case d.FullLoss!=nil:
  v:=d.FullLoss;rec:=v.Record
  if v.State!="removed"||v.CompletedAt==nil||validateLossRecord(rec)!=nil||d.LossObject==nil{return ErrUnavailable}
  b,e:=json.Marshal(rec);if e!=nil{return e}
  if _,e=tx.ExecContext(ctx,"INSERT INTO journal_loss(day,from_t,to_t,record_json,state,completed_at) VALUES(?,?,?,?,'removed',?)",rec.Day,rec.From,rec.To,b,*v.CompletedAt);e!=nil{return e}
 case d.PartialLoss!=nil:
  v:=d.PartialLoss;rec:=v.Record
  if grid==nil||validateActiveGrid(grid,rec.Active)!=nil||!subsetGrid(&rec.Recoverable,grid)||v.State!="removed"||v.CompletedAt==nil||validatePartialLoss(rec)!=nil||d.LossObject==nil{return ErrUnavailable}
  b,e:=json.Marshal(rec);if e!=nil{return e}
  if _,e=tx.ExecContext(ctx,"INSERT INTO journal_partial_loss(day,from_t,to_t,record_json,state,completed_at) VALUES(?,?,?,?,'removed',?)",rec.Day,rec.From,rec.To,b,*v.CompletedAt);e!=nil{return e}
 case d.ActiveCandidate!=nil:
  rec:=*d.ActiveCandidate
  if grid==nil||validateActiveGrid(grid,rec)!=nil{return ErrUnavailable}
  rb,e:=json.Marshal(rec);if e!=nil{return e};gb,e:=json.Marshal(grid);if e!=nil{return e}
  if _,e=tx.ExecContext(ctx,"INSERT INTO journal_recovered_active(day,from_t,to_t,record_json,grid_json) VALUES(?,?,?,?,?)",d.Day,rec.Manifest.From,rec.Manifest.To,rb,gb);e!=nil{return e}
 default:return ErrUnavailable
 }
 if d.LossObject!=nil{
  b,e:=json.Marshal(d.LossObject);if e!=nil{return e}
  if _,e=tx.ExecContext(ctx,"INSERT INTO journal_loss_sync(day,object_json,verified_at) VALUES(?,?,?)",d.Day,b,now);e!=nil{return e}
 }
 return tx.Commit()
}

// RebuildVerifiedCatalog is intentionally not a startup fallback. It is an
// explicit disaster-recovery operation on a new empty isolated catalog.
// Every selected remote SQLite (including older sealed revisions) is
// independently restored and verified. The durable building flag prevents
// the incomplete catalog from serving or reopening after a crash. On any
// failure retain the isolated artifacts for review; do not delete/retry
// automatically or overwrite any existing day.
func(j *Journal) RebuildVerifiedCatalog(ctx context.Context,remote archive.RemoteObjects,objects []archive.Object,reserve ArchiveReserve)(RecoveryResult,error){
 var out RecoveryResult
 target,ok:=j.target.(managerJournalTarget);if !ok||remote==nil||reserve==nil{return out,ErrUnavailable}
 m:=target.m
 j.archiveMu.Lock();defer j.archiveMu.Unlock()
 // Do not write a building marker for an invalid remote metadata plan.
 plan,e:=InspectRecovery(ctx,remote,objects);if e!=nil{return out,e}
 if len(plan)==0{return out,errors.New("no verified recovery candidates")}
 j.mu.Lock();e=j.beginRecoveryLocked(ctx,m);j.mu.Unlock();if e!=nil{return out,e}
 scratch,e:=privateScratch(m.root,"recovery-verify");if e!=nil{return out,e}
 for _,d:=range plan{
  if e=ctx.Err();e!=nil{return out,e}
  var grid *GridIndex
  switch{
  case d.Sealed!=nil:
   for _,rec:=range d.SealedRevisions{
    g,e:=verifyRecoveryGrid(ctx,remote,rec,false,scratch,reserve);if e!=nil{return out,e}
    if rec.ManifestSHA256==d.Sealed.ManifestSHA256{grid=g}
   }
  case d.PartialLoss!=nil:
   grid,e=verifyRecoveryGrid(ctx,remote,d.PartialLoss.Record.Active,true,scratch,reserve);if e!=nil{return out,e}
  case d.ActiveCandidate!=nil:
   grid,e=verifyRecoveryGrid(ctx,remote,*d.ActiveCandidate,true,scratch,reserve);if e!=nil{return out,e}
  }
  // Small catalog mutations are budgeted separately from decompression.
  release,e:=reserve(ctx,archiveSlack);if e!=nil{return out,e}
  e=j.insertRecoveryDay(ctx,d,grid);release();if e!=nil{return out,e}
  switch{case d.Sealed!=nil:out.SealedDays++;out.SealedRevisions+=len(d.SealedRevisions);case d.FullLoss!=nil:out.FullLossDays++;case d.PartialLoss!=nil:out.PartialLossDays++;case d.ActiveCandidate!=nil:out.SnapshotOnlyDays++}
 }
 j.mu.Lock();defer j.mu.Unlock()
 var check string
 if e=j.db.QueryRowContext(ctx,"PRAGMA quick_check").Scan(&check);e!=nil||check!="ok"{return out,ErrRecoveryIncomplete}
 if _,e=j.db.ExecContext(ctx,"UPDATE journal_meta SET value='complete' WHERE key='recovery_state' AND value='building'");e!=nil{return out,e}
 j.rebuilding=false
 // Return allocated scratch bytes and checkpoint catalog WAL, without
 // modifying any original data or Drive object.
 if e=cleanScratch(scratch,verifyFile,".verify-");e!=nil{return out,e}
 var busy,frames,done int
 if e=j.db.QueryRowContext(ctx,"PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy,&frames,&done);e!=nil||busy!=0||frames!=0||done!=0{return out,ErrRecoveryIncomplete}
 return out,nil
}

// RecoveryCompleted is used by the explicit recovered-root startup path.
func(j *Journal) RecoveryCompleted(ctx context.Context)(bool,error){
 j.mu.Lock();defer j.mu.Unlock()
 var state string
 e:=j.db.QueryRowContext(ctx,"SELECT value FROM journal_meta WHERE key='recovery_state'").Scan(&state)
 if errors.Is(e,sql.ErrNoRows){return false,nil}
 if e!=nil{return false,e}
 if state!="complete"{return false,ErrRecoveryIncomplete}
 return true,nil
}

// Refuse to collect on a date occupied by immutable snapshot-only recovery.
// A same-day merge must be a separately audited operation.
func(j *Journal) CanCollectDay(ctx context.Context,day string)error{
 j.mu.Lock();defer j.mu.Unlock()
 if e:=j.ready(ctx);e!=nil{return e}
 var n int
 if e:=j.db.QueryRowContext(ctx,"SELECT EXISTS(SELECT 1 FROM journal_recovered_active WHERE day=? UNION ALL SELECT 1 FROM journal_compact WHERE day=? UNION ALL SELECT 1 FROM journal_loss WHERE day=? UNION ALL SELECT 1 FROM journal_partial_loss WHERE day=?)",day,day,day,day).Scan(&n);e!=nil{return e}
 if n!=0{return errors.New("collection day already archived or recovered; explicit cutover required")}
 return nil
}

//go:build linux && sqlite_integration

package store

import (
 "context"
 "database/sql"
 "encoding/json"
 "errors"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
)

const preserveDayKey="archive_preserve_active_day"
var ErrArchivePreservation=errors.New("same-day archive preservation mode requires explicit review")

func(j *Journal) preservationDayLocked(ctx context.Context)(string,error){
 var day string
 e:=j.db.QueryRowContext(ctx,"SELECT value FROM journal_meta WHERE key=?",preserveDayKey).Scan(&day)
 if errors.Is(e,sql.ErrNoRows){return "",nil}
 if e!=nil{return "",e}
 t,e:=time.Parse("2006-01-02",day)
 if e!=nil||t.Format("2006-01-02")!=day{return "",ErrArchivePreservation}
 return day,nil
}
func(j *Journal) ArchivePreservationDay(ctx context.Context)(string,error){
 j.mu.Lock();defer j.mu.Unlock()
 return j.preservationDayLocked(ctx)
}

// ConfigureArchivePreservation persists a one-way, same-day staging QA policy.
// A later startup cannot silently revert to ordinary remote retirement.
// This is not a production retention policy or a recovery resume mechanism.
func(j *Journal) ConfigureArchivePreservation(ctx context.Context,enabled bool,day string)error{
 j.archiveMu.Lock();defer j.archiveMu.Unlock()
 j.mu.Lock();defer j.mu.Unlock()
 old,e:=j.preservationDayLocked(ctx);if e!=nil{return e}
 if !enabled{if old!=""{return ErrArchivePreservation};return nil}
 t,e:=time.Parse("2006-01-02",day)
 if e!=nil||t.Format("2006-01-02")!=day||(old!=""&&old!=day){return ErrArchivePreservation}
 if e=j.ready(ctx);e!=nil{return e}
 if old==day{return nil}
 // Never opt into this QA policy with previous generations already
 // awaiting ordinary retirement: a previous trash may be partial.
 var n int
 if e=j.db.QueryRowContext(ctx,"SELECT COUNT(*) FROM journal_active WHERE previous_json IS NOT NULL").Scan(&n);e!=nil{return e}
 if n!=0{return ErrArchivePreservation}
 _,e=j.db.ExecContext(ctx,"INSERT INTO journal_meta(key,value) VALUES(?,?)",preserveDayKey,day)
 return e
}

// Called only after both immutable active pairs have been reverified.
// ArchiveMu is held by the caller. Atomically retain the complete older
// published record and release the rotation slot, without any remote write.
func(j *Journal) preservePreviousRecord(ctx context.Context,day string,s ActiveState)error{
 if s.Previous==nil{return ErrArchivePreservation}
 a,e:=json.Marshal(s.Current);if e!=nil{return e}
 b,e:=json.Marshal(s.Previous);if e!=nil{return e}
 if len(b)>2<<20||archive.ValidateActiveRecord(*s.Previous)!=nil{return ErrArchivePreservation}
 j.mu.Lock();defer j.mu.Unlock()
 mode,e:=j.preservationDayLocked(ctx);if e!=nil{return e}
 if mode!=day{return ErrArchivePreservation}
 tx,e:=j.db.BeginTx(ctx,nil);if e!=nil{return e};defer tx.Rollback()
 key:="archive_preserved/"+day+"/"+s.Previous.Manifest.Generation
 if _,e=tx.ExecContext(ctx,"INSERT INTO journal_meta(key,value) VALUES(?,?)",key,string(b));e!=nil{return e}
 r,e:=tx.ExecContext(ctx,"UPDATE journal_active SET previous_json=NULL WHERE day=? AND current_json=? AND previous_json=?",day,a,b)
 if e!=nil{return e}
 n,e:=r.RowsAffected();if e!=nil||n!=1{return ErrArchivePreservation}
 return tx.Commit()
}

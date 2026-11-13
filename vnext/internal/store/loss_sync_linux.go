//go:build linux && sqlite_integration

package store

import (
 "bytes"
 "context"
 "crypto/sha256"
 "database/sql"
 "encoding/hex"
 "encoding/json"
 "errors"
 "io"
 "strings"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
)

type lossEnvelope struct{
 ContractID string `json:"contract_id"`
 Type string `json:"type"`
 Loss LossState `json:"loss"`
}
func lossLedgerBytes(v LossState)(string,[]byte,string,error){
 if v.State!="removed"||v.CompletedAt==nil||*v.CompletedAt<v.Record.RecordedAt||validateLossRecord(v.Record)!=nil{return "",nil,"",ErrUnavailable}
 key:="catalog/loss/"+v.Record.Day+".json"
 b,e:=json.Marshal(lossEnvelope{ContractID:"MD-VNEXT-1",Type:"permanent_loss",Loss:v})
 if e!=nil||len(b)>65536{return "",nil,"",ErrUnavailable}
 digest:=sha256.Sum256(b)
 return key,b,hex.EncodeToString(digest[:]),nil
}
func validLossObject(o archive.Object,key string,size int64,hash string)bool{
 return o.ID!=""&&len(o.ID)<=256&&strings.Trim(o.ID,"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")==""&&o.Key==key&&o.Size==size&&o.SHA256==hash
}

// SyncLossCycle publishes at most one finalized tombstone, using the same
// immutable logical key and identical bytes on retries. This small ledger
// preserves evidence even after VM loss. No historical data or existing
// Drive object is overwritten or deleted. Pending intents are not published.
func(r *ArchiveReader) SyncLossCycle(ctx context.Context)(string,error){
 j,c:=r.j,r.c
 j.archiveMu.Lock();defer j.archiveMu.Unlock()
 var v LossState
 e:=func()error{
  j.mu.Lock();defer j.mu.Unlock()
  if e:=j.ready(ctx);e!=nil{return e}
  var day string
  e:=j.db.QueryRowContext(ctx,"SELECT day FROM journal_loss l WHERE state='removed' AND NOT EXISTS (SELECT 1 FROM journal_loss_sync s WHERE s.day=l.day) ORDER BY from_t LIMIT 1").Scan(&day)
  if e!=nil{return e}
  v,e=j.lossRecordLocked(ctx,day);return e
 }()
 if errors.Is(e,sql.ErrNoRows){return "idle",nil}
 if e!=nil{return "",e}
 key,b,hash,e:=lossLedgerBytes(v);if e!=nil{return "",e}
 release,e:=c.reserve(ctx,archiveSlack);if e!=nil{return "",e}
 defer release()
 o,e:=c.remote.PutImmutable(ctx,key,int64(len(b)),hash,bytes.NewReader(b))
 if e!=nil{return "",e}
 if !validLossObject(o,key,int64(len(b)),hash){return "",ErrUnavailable}
 got,body,e:=c.remote.OpenObject(ctx,o.ID)
 if e!=nil{if body!=nil{body.Close()};return "",e}
 if body==nil{return "",ErrUnavailable}
 defer body.Close()
 if got.ID!=o.ID||!validLossObject(got,key,int64(len(b)),hash){return "",ErrUnavailable}
 exact,e:=io.ReadAll(io.LimitReader(body,int64(len(b))+1))
 if e!=nil||!bytes.Equal(exact,b){return "",ErrUnavailable}
 j.mu.Lock();defer j.mu.Unlock()
 if e=j.ready(ctx);e!=nil{return "",e}
 latest,e:=j.lossRecordLocked(ctx,v.Record.Day);if e!=nil{return "",e}
 _,same,h,e:=lossLedgerBytes(latest)
 if e!=nil||h!=hash||!bytes.Equal(same,b){return "",ErrResync}
 object,e:=json.Marshal(o);if e!=nil{return "",e}
 if _,e=j.db.ExecContext(ctx,"INSERT INTO journal_loss_sync(day,object_json,verified_at) VALUES(?,?,?)",v.Record.Day,object,time.Now().UnixMilli());e!=nil{return "",e}
 return "loss_ledger_verified",nil
}

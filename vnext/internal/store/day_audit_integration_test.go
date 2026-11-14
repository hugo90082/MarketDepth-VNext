//go:build linux && sqlite_integration

package store

import (
 "context"
 "os"
 "path/filepath"
 "strings"
 "testing"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/contract"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func TestSealedDayAuditDistinguishesAbsenceAndMissing(t *testing.T){
 ctx:=context.Background()
 day:="2026-11-13"
 start:=time.Date(2026,11,13,0,0,0,0,time.FixedZone("UTC+8",8*3600)).UnixMilli()
 path:=filepath.Join(t.TempDir(),day+".sqlite")
 db,e:=SQLiteOpener(path,false);if e!=nil{t.Fatal(e)}
 if _,e=db.Exec(contract.Schema);e!=nil{t.Fatal(e)}
 producer:=strings.Repeat("a",40)
 for k,v:=range map[string]string{"contract_id":model.Contract,"timezone":model.Timezone,"day":day,"data_origin":"live","archive_revision":"1","producer_commit":producer,"sealed_at":"1794585900000"}{
  if _,e=db.Exec("INSERT INTO meta VALUES(?,?)",k,v);e!=nil{t.Fatal(e)}
 }
 c:=model.Common{T:start,Asset:"BTC",AvailableAt:model.Ptr(start+1000),Status:"ok",Source:model.Ptr(model.LiveSource),Revision:1}
 p:=model.Ptr(0.0)
 depth:=model.SpotRow{Common:c,Venue:"binance",Bid0100:p,Ask0100:p,Bid100200:p,Ask100200:p,Bid200300:p,Ask200300:p,Bid300500:p,Ask300500:p,Bid500750:p,Ask500750:p,ObservedBid:model.Ptr(800.0),ObservedAsk:model.Ptr(800.0),TrustedBid:model.Ptr(750.0),TrustedAsk:model.Ptr(750.0)}
 other:=depth;other.Venue="coinbase"
 incomplete:=depth;incomplete.Venue="kraken";incomplete.TrustedAsk=nil
 f:=model.Futures1Row{Common:model.Common{T:start,Asset:"BTC",Status:"missing",Source:model.Ptr(model.LiveSource),AvailableAt:model.Ptr(start+60000),Revision:1}}
 for _,row:=range []model.Row{depth,other,incomplete,f}{
  vals,e:=rowValues(row);if e!=nil{t.Fatal(e)}
  if _,e=db.Exec(insertSQL(row.Kind()),vals...);e!=nil{t.Fatal(e)}
 }
 if e=db.Close();e!=nil{t.Fatal(e)}
 h,e:=auditHash(ctx,path);if e!=nil{t.Fatal(e)}
 got,e:=AuditSealedDay(ctx,path,day,h,producer);if e!=nil{t.Fatal(e)}
 if got.Expected!=47520||got.Present!=4||got.Absent!=47516||got.GridComplete||got.ProductionReady||len(got.Streams)!=18||got.All4PairedMinutes["BTC"]!=1{t.Fatalf("%+v",got)}
 for _,s:=range got.Streams{
  if s.Kind==model.Spot&&s.Venue=="binance"&&s.Asset=="BTC"{
   if s.PairedComplete750!=1||s.Absent!=1439||len(s.MissingIntervals)!=1||s.MissingIntervals[0].From!=start+60000||s.AvailabilityLagP95MS==nil||*s.AvailabilityLagP95MS!=1000{t.Fatal(s)}
  }
  if s.Kind==model.F1&&s.Asset=="BTC"&& (s.Status["missing"]!=1||s.Present!=1||s.Absent!=1439){t.Fatal(s)}
 }
 if _,e=AuditSealedDay(ctx,path,day,strings.Repeat("b",64),producer);e==nil{t.Fatal("accepted wrong hash")}
 if e=os.WriteFile(path+"-wal",[]byte("x"),0600);e!=nil{t.Fatal(e)}
 if _,e=AuditSealedDay(ctx,path,day,h,producer);e==nil{t.Fatal("accepted sidecar")}
 if e=os.Remove(path+"-wal");e!=nil{t.Fatal(e)}
 db,e=SQLiteOpener(path,false);if e!=nil{t.Fatal(e)}
 if _,e=db.Exec("UPDATE futures_1m SET available_at=t");e!=nil{t.Fatal(e)}
 if e=db.Close();e!=nil{t.Fatal(e)}
 h,e=auditHash(ctx,path);if e!=nil{t.Fatal(e)}
 if _,e=AuditSealedDay(ctx,path,day,h,producer);e==nil{t.Fatal("accepted future leakage")}
}

//go:build sqlite_integration

package legacy

import (
 "context"
 "database/sql"
 "encoding/json"
 "os"
 "path/filepath"
 "testing"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func prepareFixtureLedger(t *testing.T,raw []byte)(*Ledger,*RawStage){
 t.Helper()
 root,source,sha:=makeRawStage(t,raw)
 ctx:=context.Background()
 s,e:=VerifyRawStage(ctx,root,source,sha,1<<20);if e!=nil{t.Fatal(e)}
 t.Cleanup(func(){s.Close()})
 l,e:=CreateLedger(filepath.Join(t.TempDir(),"ledger"));if e!=nil{t.Fatal(e)}
 t.Cleanup(func(){l.Close()})
 if _,e=l.MapVerifiedFixture(ctx,s);e!=nil{t.Fatal(e)}
 return l,s
}
func fixtureLine(t *testing.T,r model.Row)[]byte{
 return append(encoded(t,map[string]any{"kind":r.Kind(),"row":r}),'\n')
}
func TestGenerateFixtureDays(t *testing.T){
 ctx:=context.Background()
 a:=spot()
 b:=a;b.T+=86400000
 f:=model.Futures1Row{Common:a.Common,Volume:model.Ptr(0.0),TradeCount:model.Ptr(int64(9007199254740993))}
 raw:=append(fixtureLine(t,b),fixtureLine(t,a)...)
 raw=append(raw,fixtureLine(t,a)...)
 raw=append(raw,fixtureLine(t,f)...)
 l,s:=prepareFixtureLedger(t,raw)
 root:=filepath.Join(t.TempDir(),"days")
 result,e:=l.GenerateFixtureDays(ctx,s,root)
 if e!=nil||result.Days!=2||result.Plan.Occurrences!=4||result.Plan.UniqueKeys!=3||result.Plan.DuplicateOccurrences!=1{t.Fatal(result,e)}
 if _,e=os.Stat(filepath.Join(root,fixtureBuilding));!os.IsNotExist(e){t.Fatal("incomplete marker remains",e)}
 rawManifest,e:=os.ReadFile(filepath.Join(root,fixtureManifest));if e!=nil{t.Fatal(e)}
 var manifest struct{
  FixtureOnly bool `json:"fixture_only"`
  SourceSHA string `json:"source_sha256"`
  Plan FixturePlan `json:"plan"`
  Files []fixtureFile `json:"files"`
 }
 if e=json.Unmarshal(rawManifest,&manifest);e!=nil||!manifest.FixtureOnly||manifest.SourceSHA!=s.report.CompressedSHA||manifest.Plan!=result.Plan||len(manifest.Files)!=2{t.Fatal("fixture manifest",manifest,e)}
 for _,file:=range manifest.Files{
  data,e:=os.ReadFile(filepath.Join(root,file.Name));if e!=nil||hash(data)!=file.SHA256||int64(len(data))!=file.Bytes{t.Fatal("file digest",file,e)}
 }
 for _,day:=range []string{model.Day(a.T),model.Day(b.T)}{
  db,e:=sql.Open("sqlite3",filepath.Join(root,"fixture-"+day+".sqlite"));if e!=nil{t.Fatal(e)}
  var bid,ask,avail *float64
  if e=db.QueryRow("SELECT bid_0_100,ask_0_100,available_at FROM spot_depth").Scan(&bid,&ask,&avail);e!=nil||bid==nil||*bid!=0||ask!=nil||avail!=nil{t.Fatal("null/zero",e)}
  var n,version int
  if e=db.QueryRow("SELECT count(*) FROM futures_10s").Scan(&n);e!=nil||n!=0{t.Fatal("invented 10s",n,e)}
  if e=db.QueryRow("PRAGMA user_version").Scan(&version);e!=nil||version!=1{t.Fatal("schema",version,e)}
  var origin,fixture string
  if e=db.QueryRow("SELECT value FROM meta WHERE key='data_origin'").Scan(&origin);e!=nil||origin!="legacy"{t.Fatal(origin,e)}
  if e=db.QueryRow("SELECT value FROM meta WHERE key='fixture_only'").Scan(&fixture);e!=nil||fixture!="true"{t.Fatal(fixture,e)}
  if e=db.QueryRow("SELECT count(*) FROM meta WHERE key='sealed_at'").Scan(&n);e!=nil||n!=0{t.Fatal("fixture sealed")}
  if day==model.Day(a.T){
   var id int64
   if e=db.QueryRow("SELECT trade_count FROM futures_1m").Scan(&id);e!=nil||id!=9007199254740993{t.Fatal("integer precision",id,e)}
  }
  if e=db.Close();e!=nil{t.Fatal(e)}
 }
 if _,e=l.GenerateFixtureDays(ctx,s,root);!os.IsExist(e){t.Fatal("overwrite",e)}
}
func TestFixturePlanBlocksUnsafeOutput(t *testing.T){
 ctx:=context.Background()
 for _,scenario:=range []string{"conflict","quarantine","tampered","incomplete"}{
  t.Run(scenario,func(t *testing.T){
   a:=spot()
   raw:=fixtureLine(t,a)
   switch scenario{
   case "conflict":a.Bid0100=nil;raw=append(raw,fixtureLine(t,a)...)
   case "quarantine":raw=append(raw,[]byte("{\"kind\":\"futures_10s\",\"row\":{}}\n")...)
   }
   l,s:=prepareFixtureLedger(t,raw)
   switch scenario{
   case "tampered":if _,e:=l.db.Exec("UPDATE candidate SET row_json=?",[]byte("{}"));e!=nil{t.Fatal(e)}
   case "incomplete":if _,e:=l.db.Exec("UPDATE fixture_run SET state='building'");e!=nil{t.Fatal(e)}
   }
   root:=filepath.Join(t.TempDir(),"days")
   if _,e:=l.GenerateFixtureDays(ctx,s,root);e==nil{t.Fatal("unsafe output")}
   if _,e:=os.Stat(root);!os.IsNotExist(e){t.Fatal("preflight created output",e)}
  })
 }
}

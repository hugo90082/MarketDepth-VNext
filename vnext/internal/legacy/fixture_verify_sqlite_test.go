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

func TestIndependentFixtureVerification(t *testing.T){
 ctx:=context.Background()
 a:=spot()
 b:=a;b.T+=86400000
 raw:=append(fixtureLine(t,a),fixtureLine(t,b)...)
 l,s:=prepareFixtureLedger(t,raw)
 root:=filepath.Join(t.TempDir(),"days")
 want,e:=l.GenerateFixtureDays(ctx,s,root);if e!=nil{t.Fatal(e)}
 got,e:=l.VerifyFixtureDays(ctx,s,root);if e!=nil||got!=want{t.Fatal(got,want,e)}
 if e=os.WriteFile(filepath.Join(root,fixtureBuilding),[]byte("incomplete"),0600);e!=nil{t.Fatal(e)}
 if _,e=l.VerifyFixtureDays(ctx,s,root);e==nil{t.Fatal("incomplete directory accepted")}
 if e=os.Remove(filepath.Join(root,fixtureBuilding));e!=nil{t.Fatal(e)}
 if _,e=l.VerifyFixtureDays(ctx,s,root);e!=nil{t.Fatal(e)}
}

func TestFixtureVerificationRejectsChangedContentEvenWithNewHash(t *testing.T){
 ctx:=context.Background()
 for _,scenario:=range []string{"row","extra","schema","metadata","events","hash","manifest","missing"}{
  t.Run(scenario,func(t *testing.T){
   a:=spot()
   l,s:=prepareFixtureLedger(t,fixtureLine(t,a))
   root:=filepath.Join(t.TempDir(),"days")
   if _,e:=l.GenerateFixtureDays(ctx,s,root);e!=nil{t.Fatal(e)}
   m,e:=readFixtureManifest(root);if e!=nil{t.Fatal(e)}
   path:=filepath.Join(root,m.Files[0].Name)
   switch scenario{
   case "missing":
    if e=os.Remove(path);e!=nil{t.Fatal(e)}
   case "manifest":
    m.Plan.UniqueKeys++
   case "hash":
    m.Files[0].SHA256=hash([]byte("other"))
   default:
    db,e:=sql.Open("sqlite3",path);if e!=nil{t.Fatal(e)}
    var q string
    switch scenario{
    case "row":q="UPDATE spot_depth SET bid_0_100=1"
    case "extra":q="INSERT INTO spot_depth(t,venue,asset,status,revision) SELECT t,'kraken',asset,status,revision FROM spot_depth"
    case "schema":q="CREATE TABLE unexpected(x)"
    case "metadata":q="INSERT INTO meta VALUES('sealed_at','123')"
    case "events":q="INSERT INTO events(t,code) VALUES(0,'FAKE')"
    }
    if _,e=db.Exec(q);e!=nil{t.Fatal(e)}
    if e=db.Close();e!=nil{t.Fatal(e)}
    m.Files[0],e=inspectFixtureFile(root,model.Day(a.T));if e!=nil{t.Fatal(e)}
   }
   data,e:=json.Marshal(m);if e!=nil{t.Fatal(e)}
   if e=os.WriteFile(filepath.Join(root,fixtureManifest),append(data,'\n'),0600);e!=nil{t.Fatal(e)}
   if _,e=l.VerifyFixtureDays(ctx,s,root);e==nil{t.Fatal("accepted modified fixture",scenario)}
  })
 }
}

func TestReadOnlyFixtureLedgerReopen(t *testing.T){
 ctx:=context.Background()
 rawRoot,source,sha:=makeRawStage(t,fixtureLine(t,spot()))
 s,e:=VerifyRawStage(ctx,rawRoot,source,sha,1<<20);if e!=nil{t.Fatal(e)}
 defer s.Close()
 ledgerRoot:=filepath.Join(t.TempDir(),"ledger")
 l,e:=CreateLedger(ledgerRoot);if e!=nil{t.Fatal(e)}
 if _,e=l.MapVerifiedFixture(ctx,s);e!=nil{l.Close();t.Fatal(e)}
 root:=filepath.Join(t.TempDir(),"days")
 want,e:=l.GenerateFixtureDays(ctx,s,root);if e!=nil{l.Close();t.Fatal(e)}
 if e=l.Close();e!=nil{t.Fatal(e)}
 ro,e:=OpenFixtureLedgerReadOnly(ctx,ledgerRoot);if e!=nil{t.Fatal(e)}
 defer ro.Close()
 got,e:=ro.VerifyFixtureDays(ctx,s,root);if e!=nil||got!=want{t.Fatal(got,want,e)}
 if _,e=ro.db.Exec("DELETE FROM candidate");e==nil{t.Fatal("read-only ledger accepted write")}
}

//go:build linux && sqlite_integration

package store

import (
 "context"
 "os"
 "path/filepath"
 "testing"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func TestFixtureCannotEnterLiveReaderWriterOrSnapshot(t *testing.T){
 ctx:=context.Background()
 base:=liveRows()[0].(model.SpotRow)
 day:=model.Day(base.T)
 root:=filepath.Join(t.TempDir(),"live")
 m,e:=newManager(root,SQLiteOpener,func()time.Time{return time.UnixMilli(base.T+120000)},5*time.Minute);if e!=nil{t.Fatal(e)}
 defer m.Close()
 fixture,e:=NewLegacyFixtureDay(ctx,root,day);if e!=nil{t.Fatal(e)}
 legacy:=base
 legacy.Source=model.Ptr("legacy:fixture-v1");legacy.Status="legacy_unknown";legacy.AvailableAt=nil
 if e=fixture.Put(ctx,legacy);e!=nil{fixture.Abort();t.Fatal(e)}
 if e=fixture.Finish(ctx);e!=nil{t.Fatal(e)}
 path:=filepath.Join(root,day+".sqlite")
 if e=os.Rename(filepath.Join(root,"fixture-"+day+".sqlite"),path);e!=nil{t.Fatal(e)}
 stage:=filepath.Join(t.TempDir(),"stage");if e=os.Mkdir(stage,0700);e!=nil{t.Fatal(e)}
 refuse:=func(){
  t.Helper()
  if _,e:=m.Get(ctx,model.Spot,base.Key());e==nil{t.Fatal("fixture read as live")}
  if _,e:=m.GetMany(ctx,[]JournalKey{{model.Spot,base.Key()}});e==nil{t.Fatal("fixture batch read as live")}
  if e:=m.Put(ctx,[]model.Row{base});e==nil{t.Fatal("fixture opened as live writer")}
  if _,e:=m.CreateSnapshot(ctx,day,stage,"g1","test",20_000_000);e==nil{t.Fatal("fixture snapshotted as live")}
 }
 refuse()
 db,e:=SQLiteOpener(path,false);if e!=nil{t.Fatal(e)}
 if _,e=db.Exec("UPDATE meta SET value='live' WHERE key='data_origin'");e!=nil{db.Close();t.Fatal(e)}
 if e=db.Close();e!=nil{t.Fatal(e)}
 refuse()
 // Even removing the fixture flag cannot make legacy source rows publishable.
 db,e=SQLiteOpener(path,false);if e!=nil{t.Fatal(e)}
 if _,e=db.Exec("DELETE FROM meta WHERE key='fixture_only'");e!=nil{db.Close();t.Fatal(e)}
 if e=db.Close();e!=nil{t.Fatal(e)}
 if _,e=m.CreateSnapshot(ctx,day,stage,"g2","test",20_000_000);e==nil{t.Fatal("legacy source snapshotted as live")}
}

func TestLegacyPlacementReportsLocalAndCatalogCollisions(t *testing.T){
 ctx:=context.Background()
 loc:=time.FixedZone("UTC+8",8*3600)
 now:=time.Date(2026,11,14,12,0,0,0,loc)
 m,e:=newManager(filepath.Join(t.TempDir(),"live"),SQLiteOpener,func()time.Time{return now},5*time.Minute);if e!=nil{t.Fatal(e)}
 defer m.Close()
 j,e:=m.OpenCatalog(ctx);if e!=nil{t.Fatal(e)}
 defer j.Close()
 if e=os.WriteFile(filepath.Join(m.root,"2026-11-10.sqlite"),[]byte("occupied"),0600);e!=nil{t.Fatal(e)}
 if _,e=j.db.Exec("INSERT INTO journal_loss_sync VALUES('2026-11-11','{}',1)");e!=nil{t.Fatal(e)}
 stamp:=time.Date(2026,11,12,1,0,0,0,loc).UnixMilli()
 if _,e=j.db.Exec("INSERT INTO journal_change(kind,t,venue,asset,revision,hash) VALUES('spot_depth',?,'binance','BTC',1,'x')",stamp);e!=nil{t.Fatal(e)}
 cutoff:=time.Date(2026,11,13,12,0,0,0,loc).UnixMilli()
 days:=[]string{"2026-11-14","2026-11-11","2026-11-09","2026-11-13","2026-11-12","2026-11-10"}
 got,e:=j.InspectLegacyPlacement(ctx,days,cutoff);if e!=nil{t.Fatal(e)}
 want:=[][]string{{},{"local_file_or_sidecar"},{"journal_loss_sync"},{"journal_change"},{"cutover_boundary_or_after"},{"active_or_grace","cutover_boundary_or_after"}}
 if len(got)!=len(want){t.Fatal(got)}
 for i,g:=range got{
  if g.LocalClear!=(len(want[i])==0)||len(g.Reasons)!=len(want[i]){t.Fatal(g)}
  for n,r:=range g.Reasons{if r!=want[i][n]{t.Fatal(g)}}
 }
 if _,e=j.InspectLegacyPlacement(ctx,[]string{days[0],days[0]},cutoff);e==nil{t.Fatal("duplicate date")}
 if _,e=j.InspectLegacyPlacement(ctx,days,now.Add(time.Hour).UnixMilli());e==nil{t.Fatal("future cutover")}
 if _,e=j.db.Exec("INSERT INTO journal_archive_pending VALUES(1,'{}')");e!=nil{t.Fatal(e)}
 if _,e=j.InspectLegacyPlacement(ctx,days,cutoff);e==nil{t.Fatal("ambiguous pending archive")}
}

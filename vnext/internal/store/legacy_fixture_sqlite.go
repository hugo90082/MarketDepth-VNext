//go:build sqlite_integration

package store

import (
 "bytes"
 "context"
 "database/sql"
 "encoding/json"
 "errors"
 "net/url"
 "os"
 "path/filepath"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/contract"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
 _ "github.com/mattn/go-sqlite3"
)

// LegacyFixtureDay is an offline QA writer, not a Daily or Manager.
// Its file name and metadata are deliberately not a publishable day archive.
type LegacyFixtureDay struct {
 db *sql.DB
 tx *sql.Tx
 day string
 count int64
 closed bool
}

func NewLegacyFixtureDay(ctx context.Context,root,day string)(*LegacyFixtureDay,error){
 if _,e:=time.Parse("2006-01-02",day);e!=nil{return nil,e}
 path,e:=filepath.Abs(filepath.Join(root,"fixture-"+day+".sqlite"));if e!=nil{return nil,e}
 f,e:=os.OpenFile(path,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600);if e!=nil{return nil,e}
 if e=f.Close();e!=nil{return nil,e}
 uri:=url.URL{Scheme:"file",Path:path,RawQuery:"mode=rw"}
 db,e:=sql.Open("sqlite3",uri.String());if e!=nil{return nil,e}
 db.SetMaxOpenConns(1)
 fail:=func(e error)(*LegacyFixtureDay,error){db.Close();return nil,e}
 for _,q:=range []string{"PRAGMA journal_mode=DELETE","PRAGMA synchronous=FULL","PRAGMA foreign_keys=ON","PRAGMA cache_size=-8192"}{
  if _,e=db.ExecContext(ctx,q);e!=nil{return fail(e)}
 }
 tx,e:=db.BeginTx(ctx,nil);if e!=nil{return fail(e)}
 if _,e=tx.ExecContext(ctx,contract.Schema);e!=nil{tx.Rollback();return fail(e)}
 for k,v:=range map[string]string{
  "contract_id":model.Contract,"day":day,"timezone":model.Timezone,
  "data_origin":"legacy","archive_revision":"1","fixture_only":"true",
 }{if _,e=tx.ExecContext(ctx,"INSERT INTO meta VALUES(?,?)",k,v);e!=nil{tx.Rollback();return fail(e)}}
 return &LegacyFixtureDay{db:db,tx:tx,day:day},nil
}

func(d *LegacyFixtureDay)Put(ctx context.Context,r model.Row)error{
 if d.closed||rowNil(r){return errors.New("closed fixture day or nil row")}
 if e:=r.Validate();e!=nil{return e}
 b:=r.Base()
 if (r.Kind()!=model.Spot&&r.Kind()!=model.F1)||model.Day(b.T)!=d.day||
 b.Status!="legacy_unknown"||b.AvailableAt!=nil||b.Revision!=1||b.Source==nil||*b.Source!="legacy:fixture-v1"{
  return errors.New("not an admissible fixture row")
 }
 args,e:=rowValues(r);if e!=nil{return e}
 if _,e=d.tx.ExecContext(ctx,insertSQL(r.Kind()),args...);e!=nil{return e}
 got,e:=readRow(ctx,d.tx,r.Kind(),r.Key());if e!=nil{return e}
 a,e:=json.Marshal(r);if e!=nil{return e}
 z,e:=json.Marshal(got);if e!=nil{return e}
 if !bytes.Equal(a,z){return errors.New("fixture day roundtrip differs")}
 d.count++
 return nil
}

// Finish verifies counts and SQLite integrity before commit. No sealed_at
// or producer_commit is written; archive publication is intentionally absent.
func(d *LegacyFixtureDay)Finish(ctx context.Context)error{
 if d.closed{return errors.New("fixture day closed")}
 var n,total int64
 for _,k:=range []model.Kind{model.Spot,model.F1,model.F10}{
  if e:=d.tx.QueryRowContext(ctx,"SELECT count(*) FROM "+string(k)).Scan(&n);e!=nil{return e}
  if k==model.F10&&n!=0{return errors.New("unexpected 10s rows")}
  total+=n
 }
 if total!=d.count||total==0{return errors.New("fixture row count mismatch")}
 var check string
 if e:=d.tx.QueryRowContext(ctx,"PRAGMA quick_check").Scan(&check);e!=nil||check!="ok"{return errors.New("fixture integrity failure")}
 if e:=d.tx.Commit();e!=nil{return e}
 d.closed=true
 return d.db.Close()
}

func(d *LegacyFixtureDay)Abort(){
 if !d.closed{d.tx.Rollback();d.db.Close();d.closed=true}
}

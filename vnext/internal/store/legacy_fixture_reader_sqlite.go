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
)

// FixtureDayReader is a read-only QA snapshot. It cannot seal or publish.
type FixtureDayReader struct {
 db *sql.DB
 tx *sql.Tx
 day string
 total int64
}

func(f *FixtureDayReader)Close()error{
 _=f.tx.Rollback()
 return f.db.Close()
}

func schemaObjects(ctx context.Context,db interface{QueryContext(context.Context,string,...any)(*sql.Rows,error)})([]string,error){
 rows,e:=db.QueryContext(ctx,"SELECT type,name,tbl_name,coalesce(sql,'') FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")
 if e!=nil{return nil,e}
 defer rows.Close()
 var out []string
 for rows.Next(){
  var a,b,c,d string
  if e=rows.Scan(&a,&b,&c,&d);e!=nil{return nil,e}
  x,e:=json.Marshal([]string{a,b,c,d});if e!=nil{return nil,e}
  out=append(out,string(x))
 }
 return out,rows.Err()
}

// OpenFixtureDayReader verifies the exact embedded schema and metadata,
// refuses sidecars, and pins an immutable-in-practice offline snapshot.
func OpenFixtureDayReader(ctx context.Context,root,day string)(reader *FixtureDayReader,err error){
 if _,e:=time.Parse("2006-01-02",day);e!=nil{return nil,e}
 path,e:=filepath.Abs(filepath.Join(root,"fixture-"+day+".sqlite"));if e!=nil{return nil,e}
 st,e:=os.Lstat(path);if e!=nil||!st.Mode().IsRegular(){return nil,errors.New("regular fixture file required")}
 for _,suffix:=range []string{"-wal","-shm","-journal"}{
  if _,e=os.Lstat(path+suffix);!errors.Is(e,os.ErrNotExist){return nil,errors.New("fixture sidecar present")}
 }
 uri:=url.URL{Scheme:"file",Path:path,RawQuery:"mode=ro&_query_only=1"}
 db,e:=sql.Open("sqlite3",uri.String());if e!=nil{return nil,e}
 db.SetMaxOpenConns(1)
 defer func(){if err!=nil{db.Close()}}()
 tx,e:=db.BeginTx(ctx,&sql.TxOptions{ReadOnly:true});if e!=nil{return nil,e}
 defer func(){if err!=nil{tx.Rollback()}}()
 var version int
 if e=tx.QueryRowContext(ctx,"PRAGMA user_version").Scan(&version);e!=nil||version!=1{return nil,errors.New("fixture schema version mismatch")}
 expected,e:=sql.Open("sqlite3",":memory:");if e!=nil{return nil,e}
 defer expected.Close()
 expected.SetMaxOpenConns(1)
 if _,e=expected.ExecContext(ctx,contract.Schema);e!=nil{return nil,e}
 a,e:=schemaObjects(ctx,expected);if e!=nil{return nil,e}
 b,e:=schemaObjects(ctx,tx);if e!=nil{return nil,e}
 if len(a)!=len(b){return nil,errors.New("fixture schema object count mismatch")}
 for i:=range a{if a[i]!=b[i]{return nil,errors.New("fixture schema object differs")}}
 meta:=map[string]string{"contract_id":model.Contract,"day":day,"timezone":model.Timezone,"data_origin":"legacy","archive_revision":"1","fixture_only":"true"}
 var n int
 if e=tx.QueryRowContext(ctx,"SELECT count(*) FROM meta").Scan(&n);e!=nil||n!=len(meta){return nil,errors.New("fixture metadata count mismatch")}
 for k,want:=range meta{
  var got string
  if e=tx.QueryRowContext(ctx,"SELECT value FROM meta WHERE key=?",k).Scan(&got);e!=nil||got!=want{return nil,errors.New("fixture metadata differs")}
 }
 var check string
 if e=tx.QueryRowContext(ctx,"PRAGMA quick_check").Scan(&check);e!=nil||check!="ok"{return nil,errors.New("fixture SQLite integrity failure")}
 var total int64
 for _,table:=range []string{"spot_depth","futures_1m","futures_10s","events"}{
  var count int64
  if e=tx.QueryRowContext(ctx,"SELECT count(*) FROM "+table).Scan(&count);e!=nil{return nil,e}
  if (table=="futures_10s"||table=="events")&&count!=0{return nil,errors.New("unexpected fixture table contents")}
  total+=count
 }
 if total<=0||total>21600{return nil,errors.New("invalid fixture day row count")}
 return &FixtureDayReader{db,tx,day,total},nil
}

func(f *FixtureDayReader)Count()int64{return f.total}

// Match checks actual typed SQL values against an independently rederived row.
func(f *FixtureDayReader)Match(ctx context.Context,k model.Kind,key model.Key,expected []byte)error{
 if (k!=model.Spot&&k!=model.F1)||model.Day(key.T)!=f.day{return errors.New("invalid fixture key")}
 r,e:=readRow(ctx,f.tx,k,key);if e!=nil{return e}
 b,e:=json.Marshal(r);if e!=nil{return e}
 if !bytes.Equal(b,expected){return errors.New("fixture row differs from source")}
 return nil
}

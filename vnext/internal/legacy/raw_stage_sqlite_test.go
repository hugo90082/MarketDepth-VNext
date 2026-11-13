//go:build sqlite_integration

package legacy

import (
 "bytes"
 "compress/gzip"
 "context"
 "database/sql"
 "encoding/json"
 "os"
 "os/exec"
 "path/filepath"
 "testing"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func rawFixture(t *testing.T)(string,string,string,[]byte){
 t.Helper()
 root:=t.TempDir()
 source:=filepath.Join(root,"fixture.gz")
 stage:=filepath.Join(root,"raw")
 row:=spot()
 b:=encoded(t,map[string]any{"kind":model.Spot,"row":row})
 raw:=append(append([]byte{},b...),'\n')
 raw=append(raw,b...)
 raw=append(raw,'\n')
 var buf bytes.Buffer
 z:=gzip.NewWriter(&buf)
 if _,e:=z.Write(raw);e!=nil{t.Fatal(e)}
 if e:=z.Close();e!=nil{t.Fatal(e)}
 sha:=hash(buf.Bytes())
 if e:=os.WriteFile(source,buf.Bytes(),0600);e!=nil{t.Fatal(e)}
 cmd:=exec.Command("python3","../../tools/legacy_raw_stage.py",source,"--output-new-dir",stage,"--expected-sha256",sha)
 if out,e:=cmd.CombinedOutput();e!=nil{t.Fatal(e,string(out))}
 return stage,source,sha,b
}

func TestRawStageVerifiedFixture(t *testing.T){
 ctx:=context.Background()
 root,source,sha,b:=rawFixture(t)
 s,e:=VerifyRawStage(ctx,root,source,sha,1<<20);if e!=nil{t.Fatal(e)}
 defer s.Close()
 ev,raw,e:=s.Line(ctx,2,FixtureAdapter)
 if e!=nil||ev.SourceSHA256!=sha||ev.Line!=2||!bytes.Equal(bytes.TrimSpace(raw),b){t.Fatal(ev,e)}
 l,e:=CreateLedger(filepath.Join(t.TempDir(),"candidate"));if e!=nil{t.Fatal(e)}
 defer l.Close()
 a,e:=l.AddVerifiedFixture(ctx,s,1);if e!=nil||a.Replay||a.Variants!=1{t.Fatal(a,e)}
 a,e=l.AddVerifiedFixture(ctx,s,2);if e!=nil||a.Replay||a.Variants!=1{t.Fatal(a,e)}
 a,e=l.AddVerifiedFixture(ctx,s,1);if e!=nil||!a.Replay{t.Fatal(a,e)}
 if _,e=l.AddVerifiedFixture(ctx,s,3);e==nil{t.Fatal("unknown source line")}
 var stored []byte
 if e=l.db.QueryRow("SELECT row_json FROM candidate WHERE line_no=1").Scan(&stored);e!=nil{t.Fatal(e)}
 var r model.SpotRow
 if e=json.Unmarshal(stored,&r);e!=nil||r.Bid0100==nil||*r.Bid0100!=0||r.Ask0100!=nil{t.Fatal("null/zero changed",e)}
}
func TestRawStageRefusesTampering(t *testing.T){
 ctx:=context.Background()
 root,source,sha,_:=rawFixture(t)
 if _,e:=VerifyRawStage(ctx,root,source,hash([]byte("other")),1<<20);e==nil{t.Fatal("wrong source hash")}
 if e:=os.WriteFile(filepath.Join(root,".legacy-stage-building"),[]byte("incomplete"),0600);e!=nil{t.Fatal(e)}
 if _,e:=VerifyRawStage(ctx,root,source,sha,1<<20);e==nil{t.Fatal("building marker ignored")}
 if e:=os.Remove(filepath.Join(root,".legacy-stage-building"));e!=nil{t.Fatal(e)}
 db,e:=sql.Open("sqlite3",filepath.Join(root,"legacy-raw.sqlite"));if e!=nil{t.Fatal(e)}
 if _,e=db.Exec("UPDATE raw_payload SET body=?",[]byte("different"));e!=nil{t.Fatal(e)}
 if e=db.Close();e!=nil{t.Fatal(e)}
 if _,e=VerifyRawStage(ctx,root,source,sha,1<<20);e==nil{t.Fatal("tampered stage accepted")}
}
func TestFixtureEnvelopeStrict(t *testing.T){
 for _,b:=range []string{
  `{"kind":"futures_10s","row":{}}`,
  `{"kind":"spot_depth","kind":"futures_1m","row":{}}`,
  `{"kind":"spot_depth","row":{},"extra":1}`,
  `{"kind":"spot_depth"}`,
 }{if _,_,e:=MapFixture([]byte(b));e==nil{t.Fatal("bad envelope",b)}}
}

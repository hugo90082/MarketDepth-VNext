package httpapi

import (
 "bytes"
 "context"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "io"
 "net/http"
 "net/http/httptest"
 "strings"
 "strconv"
 "testing"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

type handoffReader struct{
 *store.Mock
}
func (r handoffReader) Latest(ctx context.Context,k model.Kind)([]model.Row,error){
 if k!=model.F10{return r.Mock.Latest(ctx,k)}
 return []model.Row{model.Futures10Row{Common:model.Common{T:0,Asset:"BTC",Status:"partial",Revision:1},FirstAggID:model.Ptr(int64(9007199254740993))}},nil
}
func (r handoffReader) OpenSealed(_ context.Context,day string,revision int64)(store.SealedDownload,error){
 if day!="2026-11-13"||revision!=2{return store.SealedDownload{},store.ErrArchiveUnavailable}
 // Transport fixture only: real gzip/SQLite restore is covered by store tests.
 b:=[]byte("isolated-download-transport-fixture")
 h:=sha256.Sum256(b)
 return store.SealedDownload{Day:day,Revision:2,Size:int64(len(b)),SHA256:hex.EncodeToString(h[:]),ETag:strings.Repeat("a",64),Body:io.NopCloser(bytes.NewReader(b))},nil
}

func TestFrontendHandoffWireContract(t *testing.T){
 a,e:=newAuth("https://depth.example",bytes.Repeat([]byte{9},32),func(p []byte)bool{return string(p)=="fixture-only"});if e!=nil{t.Fatal(e)}
 h:=API{Reader:handoffReader{store.Fixture()},Live:true,Auth:a}.Handler()
 req:=httptest.NewRequest("POST","/api/v2/auth/login",strings.NewReader(`{"password":"fixture-only"}`))
 req.Header.Set("Origin",a.origin);req.Header.Set("Content-Type","application/json")
 w:=httptest.NewRecorder();h.ServeHTTP(w,req)
 if w.Code!=200||len(w.Result().Cookies())!=1{t.Fatal(w.Code,w.Body.String())}
 cookie:=w.Result().Cookies()[0]
 var login map[string]json.RawMessage
 if e=json.Unmarshal(w.Body.Bytes(),&login);e!=nil||len(login)!=2||login["meta"]!=nil||cookie.Name!="__Host-md_session"{t.Fatal(login,e)}
 var data struct{Authenticated bool `json:"authenticated"`;Expires int `json:"expires_in"`}
 if e=json.Unmarshal(login["data"],&data);e!=nil||!data.Authenticated||data.Expires!=604800{t.Fatal(data,e)}
 get:=func(path string)*httptest.ResponseRecorder{
  r:=httptest.NewRequest("GET",path,nil);r.AddCookie(cookie)
  w:=httptest.NewRecorder();h.ServeHTTP(w,r)
  return w
 }
 w=get("/api/v2/latest?kind=futures_10s,spot_depth")
 if w.Code!=200||!bytes.Contains(w.Body.Bytes(),[]byte(`"first_agg_id":9007199254740993`)){t.Fatal(w.Code,w.Body.String())}
 var latest struct{Data map[string]json.RawMessage `json:"data"`;Meta map[string]any `json:"meta"`}
 if e=json.Unmarshal(w.Body.Bytes(),&latest);e!=nil||len(latest.Data)!=2||latest.Data["futures_1m"]!=nil||latest.Meta["mock"]!=false{t.Fatal(latest,e)}
 w=get("/api/v2/latest?kind=futures_10s,futures_10s")
 if w.Code!=400{t.Fatal("duplicate kinds",w.Code)}
 w=get("/api/v2/day/2026-11-13?revision=2")
 sum:=sha256.Sum256(w.Body.Bytes())
 if w.Code!=http.StatusOK||w.Header().Get("Content-Type")!="application/gzip"||w.Header().Get("X-Archive-SHA256")!=hex.EncodeToString(sum[:])||w.Header().Get("ETag")!="\""+strings.Repeat("a",64)+"\""{t.Fatal(w.Code,w.Header())}
 if w.Header().Get("Content-Disposition")!=`attachment; filename="2026-11-13.r2.sqlite.gz"`||w.Header().Get("Content-Length")!=strconv.Itoa(w.Body.Len()){
  t.Fatal(w.Header())
 }
 w=get("/api/v2/day/2026-11-13?revision=3")
 if w.Code!=503||!bytes.Contains(w.Body.Bytes(),[]byte("ARCHIVE_UNAVAILABLE")){t.Fatal(w.Code,w.Body.String())}
}

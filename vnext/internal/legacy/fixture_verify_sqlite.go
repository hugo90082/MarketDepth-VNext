//go:build sqlite_integration

package legacy

import (
 "bytes"
 "context"
 "encoding/json"
 "errors"
 "io"
 "os"
 "path/filepath"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

type fixtureManifestData struct {
 FixtureOnly bool `json:"fixture_only"`
 SourceSHA string `json:"source_sha256"`
 Plan FixturePlan `json:"plan"`
 Files []fixtureFile `json:"files"`
}

func readFixtureManifest(root string)(fixtureManifestData,error){
 var m fixtureManifestData
 path:=filepath.Join(root,fixtureManifest)
 st,e:=os.Lstat(path);if e!=nil||!st.Mode().IsRegular()||st.Size()>4<<20{return m,errors.New("invalid fixture manifest file")}
 f,e:=os.Open(path);if e!=nil{return m,e}
 defer f.Close()
 b,e:=io.ReadAll(io.LimitReader(f,(4<<20)+1));if e!=nil{return m,e}
 if len(b)>4<<20{return m,errors.New("fixture manifest size limit")}
 if e=json.Unmarshal(b,&m);e!=nil{return m,e}
 canonical,e:=json.Marshal(m);if e!=nil{return m,e}
 if !bytes.Equal(b,append(canonical,'\n')){return m,errors.New("noncanonical fixture manifest")}
 if !m.FixtureOnly||!validHash(m.SourceSHA)||len(m.Files)==0||len(m.Files)>maxFixtureDays{return m,errors.New("invalid fixture manifest identity")}
 for i,x:=range m.Files{
  if _,e=time.Parse("2006-01-02",x.Day);e!=nil{return m,e}
  if x.Name!="fixture-"+x.Day+".sqlite"||x.Bytes<=0||!validHash(x.SHA256)||(i>0&&m.Files[i-1].Day>=x.Day){return m,errors.New("invalid fixture manifest entry")}
 }
 return m,nil
}

func fixtureDirectory(root string,m fixtureManifestData)error{
 entries,e:=os.ReadDir(root);if e!=nil{return e}
 expected:=map[string]bool{fixtureManifest:true}
 for _,x:=range m.Files{expected[x.Name]=true}
 if len(entries)!=len(expected){return errors.New("unexpected or missing fixture output file")}
 for _,x:=range entries{
  if !expected[x.Name()]{return errors.New("unrecognized fixture output")}
  st,e:=x.Info();if e!=nil||!st.Mode().IsRegular(){return errors.New("nonregular fixture output")}
 }
 return nil
}

func checkFixtureDigest(root string,x fixtureFile)error{
 st,e:=os.Lstat(filepath.Join(root,x.Name));if e!=nil||!st.Mode().IsRegular()||st.Size()!=x.Bytes{return errors.New("fixture file size or type mismatch")}
 actual,e:=inspectFixtureFile(root,x.Day);if e!=nil{return e}
 if actual!=x{return errors.New("fixture file digest mismatch")}
 return nil
}

// VerifyFixtureDays independently reopens the finished QA output. It does
// not trust the manifest alone: every exact key and typed row is rederived
// from the original source and checked against SQLite, including extra rows.
// The input and output directories must remain offline and immutable.
func(l *Ledger)VerifyFixtureDays(ctx context.Context,s *RawStage,root string)(FixtureDays,error){
 var out FixtureDays
 if s==nil{return out,errors.New("verified raw stage required")}
 m,e:=readFixtureManifest(root);if e!=nil{return out,e}
 if m.SourceSHA!=s.report.CompressedSHA{return out,errors.New("fixture source hash mismatch")}
 if e=fixtureDirectory(root,m);e!=nil{return out,e}
 var reader *store.FixtureDayReader
 defer func(){if reader!=nil{reader.Close()}}()
 idx:=-1
 var seen int64
 finish:=func()error{
  if seen!=reader.Count(){return errors.New("fixture extra or missing row")}
  e:=reader.Close();reader=nil
  if e!=nil{return e}
  return checkFixtureDigest(root,m.Files[idx])
 }
 plan,e:=l.WalkFixturePlan(ctx,s,func(c Candidate)error{
  if reader==nil||m.Files[idx].Day!=c.Day{
   if reader!=nil{if e:=finish();e!=nil{return e}}
   idx++
   if idx>=len(m.Files)||m.Files[idx].Day!=c.Day{return errors.New("fixture manifest day mismatch")}
   if e:=checkFixtureDigest(root,m.Files[idx]);e!=nil{return e}
   var e error
   reader,e=store.OpenFixtureDayReader(ctx,root,c.Day);if e!=nil{return e}
   seen=0
  }
  if e:=reader.Match(ctx,c.Kind,c.Key,c.CanonicalJSON);e!=nil{return e}
  seen++
  return nil
 })
 if e!=nil{return out,e}
 if reader==nil||idx+1!=len(m.Files)||plan!=m.Plan{return out,errors.New("fixture manifest plan mismatch")}
 if e=finish();e!=nil{return out,e}
 if e=fixtureDirectory(root,m);e!=nil{return out,e}
 again,e:=readFixtureManifest(root);if e!=nil{return out,e}
 a,_:=json.Marshal(m);b,_:=json.Marshal(again)
 if !bytes.Equal(a,b){return out,errors.New("fixture manifest changed")}
 return FixtureDays{Plan:plan,Days:int64(len(m.Files))},nil
}

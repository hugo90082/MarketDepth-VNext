//go:build linux && sqlite_integration

package store

import (
 "context"
 "crypto/sha256"
 "database/sql"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "net/url"
 "os"
 "path/filepath"
 "sort"
 "strconv"
 "strings"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/contract"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

type DayAuditStream struct {
 Kind model.Kind `json:"kind"`
 Venue string `json:"venue,omitempty"`
 Asset string `json:"asset"`
 Expected int `json:"expected"`
 Present int `json:"present"`
 Absent int `json:"absent"`
 Status map[string]int `json:"status_counts"`
 MissingIntervals []Gap `json:"missing_intervals"`
 AvailabilityLagP50MS *int64 `json:"availability_lag_p50_ms"`
 AvailabilityLagP95MS *int64 `json:"availability_lag_p95_ms"`
 AvailabilityLagMaxMS *int64 `json:"availability_lag_max_ms"`
 BidObserved750 int `json:"bid_observed_750"`
 AskObserved750 int `json:"ask_observed_750"`
 BidTrusted750 int `json:"bid_trusted_750"`
 AskTrusted750 int `json:"ask_trusted_750"`
 PairedTrusted750 int `json:"paired_trusted_750"`
 PairedComplete750 int `json:"paired_complete_750"`
 PairedTrustedBins map[string]int `json:"paired_trusted_bins"`
}
type DayAudit struct {
 ContractID string `json:"contract_id"`
 Day string `json:"day"`
 RawSHA256 string `json:"raw_sha256"`
 ProducerCommit string `json:"producer_commit"`
 Revision int64 `json:"revision"`
 SealedAt int64 `json:"sealed_at"`
 Expected int `json:"expected"`
 Present int `json:"present"`
 Absent int `json:"absent"`
 Events int64 `json:"events"`
 Streams []DayAuditStream `json:"streams"`
 All4PairedMinutes map[string]int `json:"all4_paired_minutes_750"`
 GridComplete bool `json:"grid_complete"`
 ProductionReady bool `json:"production_ready"`
}
type streamAudit struct{
 DayAuditStream
 seen []bool
 lag []int64
}
func auditHash(ctx context.Context,path string)(string,error){
 st,e:=os.Lstat(path);if e!=nil||!st.Mode().IsRegular()||st.Size()<=0||st.Size()>1_000_000_000{return "",errors.New("bounded regular offline SQLite required")}
 for _,suffix:=range []string{"-wal","-shm","-journal"}{
  if _,e=os.Lstat(path+suffix);!errors.Is(e,os.ErrNotExist){return "",errors.New("offline SQLite sidecar present")}
 }
 f,e:=os.Open(path);if e!=nil{return "",e}
 defer f.Close()
 h:=sha256.New()
 n,e:=io.Copy(h,&contextReader{ctx:ctx,r:io.LimitReader(f,1_000_000_001)});if e!=nil{return "",e}
 end,e:=f.Stat();if e!=nil||!os.SameFile(st,end)||n!=st.Size()||end.Size()!=st.Size()||!end.ModTime().Equal(st.ModTime()){return "",errors.New("offline SQLite changed")}
 return hex.EncodeToString(h.Sum(nil)),nil
}
func auditLag(s *streamAudit){
 if len(s.lag)==0{return}
 sort.Slice(s.lag,func(i,j int)bool{return s.lag[i]<s.lag[j]})
 s.AvailabilityLagP50MS=model.Ptr(s.lag[(len(s.lag)*50+99)/100-1])
 s.AvailabilityLagP95MS=model.Ptr(s.lag[(len(s.lag)*95+99)/100-1])
 s.AvailabilityLagMaxMS=model.Ptr(s.lag[len(s.lag)-1])
}
func at750(p *float64)bool{return p!=nil&&*p>=750}
func complete750(r *model.SpotRow)bool{
 for _,p:=range []*float64{r.Bid0100,r.Ask0100,r.Bid100200,r.Ask100200,r.Bid200300,r.Ask200300,r.Bid300500,r.Ask300500,r.Bid500750,r.Ask500750}{if p==nil{return false}}
 return true
}

// AuditSealedDay is a read-only, offline audit of a previously verified raw
// SQLite copy. The expected digest must come from an independent manifest.
// It never opens an active writer, touches a catalog, or claims live origin
// merely because a synthetic file satisfies the same structural contract.
func AuditSealedDay(ctx context.Context,path,day,expectedSHA,producer string)(DayAudit,error){
 var zero DayAudit
 if !validSHA(expectedSHA)||len(producer)!=40||strings.Trim(producer,"0123456789abcdef")!=""{return zero,errors.New("expected raw SHA256 and producer commit required")}
 a,e:=time.ParseInLocation("2006-01-02",day,time.FixedZone("UTC+8",8*3600))
 if e!=nil||a.Format("2006-01-02")!=day||a.UnixMilli()<0{return zero,errors.New("invalid audit date")}
 from,to:=a.UnixMilli(),a.Add(24*time.Hour).UnixMilli()
 path,e=filepath.Abs(path);if e!=nil{return zero,e}
 real,e:=filepath.EvalSymlinks(path);if e!=nil||real!=path{return zero,errors.New("offline non-symlink path required")}
 actual,e:=auditHash(ctx,path);if e!=nil||actual!=expectedSHA{return zero,errors.New("raw SQLite digest mismatch or unsafe input")}
 uri:=url.URL{Scheme:"file",Path:path,RawQuery:"mode=ro&immutable=1&_query_only=1"}
 db,e:=sql.Open("sqlite3",uri.String());if e!=nil{return zero,e}
 defer db.Close()
 db.SetMaxOpenConns(1)
 if e=validateDayMetadata(ctx,db,day);e!=nil{return zero,e}
 ref,e:=sql.Open("sqlite3",":memory:");if e!=nil{return zero,e}
 defer ref.Close()
 ref.SetMaxOpenConns(1)
 if _,e=ref.ExecContext(ctx,contract.Schema);e!=nil{return zero,e}
 x,e:=schemaObjects(ctx,ref);if e!=nil{return zero,e}
 y,e:=schemaObjects(ctx,db);if e!=nil{return zero,e}
 if len(x)!=len(y){return zero,errors.New("schema mismatch")}
 for i:=range x{if x[i]!=y[i]{return zero,errors.New("schema mismatch")}}
 var integrity string
 if e=db.QueryRowContext(ctx,"PRAGMA quick_check").Scan(&integrity);e!=nil||integrity!="ok"{return zero,errors.New("SQLite integrity failure")}
 readMeta:=func(key string)(string,error){var v string;e:=db.QueryRowContext(ctx,"SELECT value FROM meta WHERE key=?",key).Scan(&v);return v,e}
 seal,e:=readMeta("sealed_at");if e!=nil{return zero,e}
 sealed,e:=strconv.ParseInt(seal,10,64);if e!=nil||sealed<to{return zero,errors.New("unsealed or invalid day")}
 rev,e:=readMeta("archive_revision");if e!=nil{return zero,e}
 revision,e:=strconv.ParseInt(rev,10,64);if e!=nil||revision<1{return zero,errors.New("invalid revision")}
 pc,e:=readMeta("producer_commit");if e!=nil||pc!=producer{return zero,errors.New("producer mismatch")}
 out:=DayAudit{ContractID:model.Contract,Day:day,RawSHA256:actual,ProducerCommit:pc,Revision:revision,SealedAt:sealed,All4PairedMinutes:map[string]int{}}
 paired:=map[string][]int{}
 for _,asset:=range gridAssets{paired[asset]=make([]int,1440)}
 for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{
  width:=gridWidth(k)
  n:=int(86400000/k.Interval())
  ss:=make([]streamAudit,width)
  for slot:=range ss{
   key:=gridKey(k,from,slot)
   ss[slot]=streamAudit{DayAuditStream:DayAuditStream{Kind:k,Venue:key.Venue,Asset:key.Asset,Expected:n,Status:map[string]int{},MissingIntervals:[]Gap{}},seen:make([]bool,n)}
   if k==model.Spot{ss[slot].PairedTrustedBins=map[string]int{"0_100":0,"100_200":0,"200_300":0,"300_500":0,"500_750":0}}
  }
  rows,e:=db.QueryContext(ctx,"SELECT "+strings.Join(columns[k],",")+" FROM "+string(k)+" ORDER BY "+strings.Join(keyCols(k),","));if e!=nil{return zero,e}
  err:=func()error{
   defer rows.Close()
   for rows.Next(){
    raw:=make([]any,len(columns[k]));ptr:=make([]any,len(raw))
    for i:=range raw{ptr[i]=&raw[i]}
    if e:=rows.Scan(ptr...);e!=nil{return e}
    m:=map[string]any{}
    for i,name:=range columns[k]{v:=raw[i];if text,ok:=v.([]byte);ok{v=string(text)};m[name]=v}
    b,e:=json.Marshal(m);if e!=nil{return e}
    row,e:=model.Decode(k,b);if e!=nil{return fmt.Errorf("%s invalid row: %w",k,e)}
    if e=validateLiveWrite(row,true);e!=nil{return e}
    c:=row.Base()
    if *c.AvailableAt>sealed{return errors.New("availability after seal")}
    off,e:=gridOffset(k,from,to,row.Key());if e!=nil{return e}
    stream:=&ss[off%width];idx:=off/width
    if stream.seen[idx]{return errors.New("duplicate grid key")}
    stream.seen[idx]=true;stream.Present++;stream.Status[c.Status]++
    min:=c.T;if k!=model.Spot{min+=k.Interval()}
    stream.lag=append(stream.lag,*c.AvailableAt-min)
    if r,ok:=row.(*model.SpotRow);ok{
     if at750(r.ObservedBid){stream.BidObserved750++}
     if at750(r.ObservedAsk){stream.AskObserved750++}
     if at750(r.TrustedBid){stream.BidTrusted750++}
     if at750(r.TrustedAsk){stream.AskTrusted750++}
     if c.Status!="missing"&&r.TrustedBid!=nil&&r.TrustedAsk!=nil{
      for _,z:=range []struct{name string;upper float64;bid,ask *float64}{
       {"0_100",100,r.Bid0100,r.Ask0100},{"100_200",200,r.Bid100200,r.Ask100200},{"200_300",300,r.Bid200300,r.Ask200300},{"300_500",500,r.Bid300500,r.Ask300500},{"500_750",750,r.Bid500750,r.Ask500750},
      }{if z.bid!=nil&&z.ask!=nil&&*r.TrustedBid>=z.upper&&*r.TrustedAsk>=z.upper{stream.PairedTrustedBins[z.name]++}}
     }
     if c.Status!="missing"&&at750(r.TrustedBid)&&at750(r.TrustedAsk){
      stream.PairedTrusted750++
      if complete750(r){stream.PairedComplete750++;paired[r.Asset][idx]++}
     }
    }
   }
   return rows.Err()
  }()
  if err!=nil{return zero,err}
  for i:=range ss{
   s:=&ss[i]
   s.Absent=s.Expected-s.Present
   for j,present:=range s.seen{
    if present{continue}
    start:=from+int64(j)*k.Interval();end:=start+k.Interval()
    if l:=len(s.MissingIntervals);l>0&&s.MissingIntervals[l-1].To==start{s.MissingIntervals[l-1].To=end}else{s.MissingIntervals=append(s.MissingIntervals,Gap{start,end,"grid_missing"})}
   }
   auditLag(s)
   out.Expected+=s.Expected;out.Present+=s.Present;out.Absent+=s.Absent
   out.Streams=append(out.Streams,s.DayAuditStream)
  }
 }
 for asset,counts:=range paired{
  out.All4PairedMinutes[asset]=0
  for _,n:=range counts{if n>=2{out.All4PairedMinutes[asset]++}}
 }
 if e=db.QueryRowContext(ctx,"SELECT count(*) FROM events").Scan(&out.Events);e!=nil{return zero,e}
 if out.Expected!=47520||out.Present+out.Absent!=out.Expected{return zero,errors.New("audit grid accounting mismatch")}
 out.GridComplete=out.Absent==0
 if e=db.Close();e!=nil{return zero,e}
 after,e:=auditHash(ctx,path);if e!=nil||after!=actual{return zero,errors.New("offline input changed during audit")}
 return out,nil
}

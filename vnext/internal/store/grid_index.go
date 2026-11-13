package store

import(
 "errors"
 "math/bits"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// GridIndex is a compact, exact presence bitmap for a single sealed live
// day. Missing rows are distinct from rows with NULL fields. Order is
// contract-fixed, lexicographic (t, venue, asset). The manifest digest
// binds this index to one immutable archive revision, not a filename.
// Total payload is 5,940 bytes for 47,520 possible row keys per day.
type GridIndex struct{
 Day string `json:"day"`
 Revision int64 `json:"revision"`
 ManifestSHA256 string `json:"manifest_sha256"`
 Spot []byte `json:"spot"`
 F10 []byte `json:"f10"`
 F1 []byte `json:"f1"`
}

var gridAssets=[3]string{"BTC","ETH","SOL"}
var gridVenues=[4]string{"binance","bitfinex","coinbase","kraken"}

func gridWidth(k model.Kind)int{
 if k==model.Spot{return 12}
 if k==model.F10||k==model.F1{return 3}
 return 0
}
func gridCapacity(k model.Kind)int{
 if !k.Valid(){return 0}
 return int(86400000/k.Interval())*gridWidth(k)
}
func(g *GridIndex) data(k model.Kind)[]byte{
 switch k{case model.Spot:return g.Spot;case model.F10:return g.F10;case model.F1:return g.F1}
 return nil
}
func NewGridIndex(day string,revision int64,manifestSHA string)(*GridIndex,error){
 if _,_,e:=dayRange(day,day);e!=nil||revision<1||!validSHA(manifestSHA){return nil,errors.New("invalid grid index identity")}
 return &GridIndex{Day:day,Revision:revision,ManifestSHA256:manifestSHA,Spot:make([]byte,gridCapacity(model.Spot)/8),F10:make([]byte,gridCapacity(model.F10)/8),F1:make([]byte,gridCapacity(model.F1)/8)},nil
}
func(g *GridIndex) bounds()(int64,int64,error){
 a,b,e:=dayRange(g.Day,g.Day)
 if e!=nil||g.Revision<1||!validSHA(g.ManifestSHA256)||len(g.Spot)!=gridCapacity(model.Spot)/8||len(g.F10)!=gridCapacity(model.F10)/8||len(g.F1)!=gridCapacity(model.F1)/8{return 0,0,errors.New("invalid grid index")}
 return a.UnixMilli(),b.UnixMilli()+86400000,nil
}
func gridOffset(k model.Kind,from,to int64,key model.Key)(int,error){
 width:=gridWidth(k)
 if width==0||key.T<from||key.T>=to||(key.T-from)%k.Interval()!=0{return 0,errors.New("off-grid index key")}
 a,v:=-1,-1
 for i,x:=range gridAssets{if x==key.Asset{a=i}}
 if a<0{return 0,errors.New("invalid grid asset")}
 if k==model.Spot{
  for i,x:=range gridVenues{if x==key.Venue{v=i}}
  if v<0{return 0,errors.New("invalid grid venue")}
 }else{
  if key.Venue!=""{return 0,errors.New("unexpected futures venue")}
  v=0
 }
 return int((key.T-from)/k.Interval())*width+v*3+a,nil
}
func(g *GridIndex) Add(k model.Kind,key model.Key)error{
 from,to,e:=g.bounds();if e!=nil{return e}
 n,e:=gridOffset(k,from,to,key);if e!=nil{return e}
 d:=g.data(k);mask:=byte(1<<uint(n%8))
 if d[n/8]&mask!=0{return errors.New("duplicate grid key")}
 d[n/8]|=mask
 return nil
}
func(g *GridIndex) Count(k model.Kind)int64{
 var n int64
 for _,b:=range g.data(k){n+=int64(bits.OnesCount8(b))}
 return n
}
func(g *GridIndex) ValidateManifest(r archive.PublishedRecord)error{
 from,to,e:=g.bounds();if e!=nil{return e}
 if e=archive.ValidateRecord(r);e!=nil{return e}
 m:=r.Manifest
 if g.Day!=m.Day||g.Revision!=m.Revision||g.ManifestSHA256!=r.ManifestSHA256||m.From!=from||m.To!=to||m.SealedAt==nil{return errors.New("grid/archive identity mismatch")}
 for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{
  n,ok:=m.RowCounts[string(k)]
  if !ok||g.Count(k)!=n{return errors.New("grid/archive row count mismatch")}
 }
 return nil
}
func gridSelected(k model.Kind,slot int,q Query)bool{
 a:=gridAssets[slot%3]
 if q.Asset!=""&&q.Asset!=a{return false}
 if k==model.Spot&&q.Venue!=""&&q.Venue!=gridVenues[slot/3]{return false}
 return true
}
func gridKey(k model.Kind,t int64,slot int)model.Key{
 v:=""
 if k==model.Spot{v=gridVenues[slot/3]}
 return model.Key{T:t,Venue:v,Asset:gridAssets[slot%3]}
}
func(g *GridIndex) scanBounds(q Query)(int64,int64,int64,error){
 from,to,e:=g.bounds()
 if e!=nil||!validQuery(q){return 0,0,0,errors.New("invalid grid query")}
 first:=q.From
 if first<from{first=from}
 step:=q.Kind.Interval()
 if first%step!=0{first+=step-first%step}
 end:=q.To
 if end>to{end=to}
 return from,first,end,nil
}
// Keys returns exact selected keys, not data rows. Only the sealed SQLite
// matching this manifest may supply their values. Limit can include one
// lookahead item to determine whether another page exists.
func(g *GridIndex) Keys(q Query,after *model.Key,limit int)([]model.Key,error){
 if limit<1||limit>2001{return nil,errors.New("invalid grid page size")}
 from,first,end,e:=g.scanBounds(q);if e!=nil{return nil,e}
 width,step:=gridWidth(q.Kind),q.Kind.Interval()
 d:=g.data(q.Kind)
 out:=make([]model.Key,0,limit)
 if after!=nil&&after.T>first{first=after.T}
 for t:=first;t<end;t+=step{
  if (t-from)%step!=0{return nil,errors.New("invalid grid cursor")}
  base:=int((t-from)/step)*width
  for s:=0;s<width;s++{
   if !gridSelected(q.Kind,s,q){continue}
   n:=base+s
   if d[n/8]&(1<<uint(n%8))==0{continue}
   key:=gridKey(q.Kind,t,s)
   if after!=nil&&!after.Less(key){continue}
   out=append(out,key)
   if len(out)==limit{return out,nil}
  }
 }
 return out,nil
}
// Gaps reproduces the existing grid_missing semantics for the selected
// asset/venue filters. A present missing-status row is present, not a gap.
func(g *GridIndex) Gaps(q Query)([]Gap,error){
 from,first,end,e:=g.scanBounds(q);if e!=nil{return nil,e}
 width,step:=gridWidth(q.Kind),q.Kind.Interval()
 d:=g.data(q.Kind)
 out:=[]Gap{}
 for t:=first;t<end;t+=step{
  base:=int((t-from)/step)*width
  missing:=false
  for s:=0;s<width;s++{
   if !gridSelected(q.Kind,s,q){continue}
   n:=base+s
   if d[n/8]&(1<<uint(n%8))==0{missing=true;break}
  }
  if !missing{continue}
  stop:=t+step;if stop>end{stop=end}
  if n:=len(out);n>0&&out[n-1].To==t{out[n-1].To=stop}else{out=append(out,Gap{t,stop,"grid_missing"})}
  if len(out)>4096{return nil,errors.New("too many gap intervals; query smaller range")}
 }
 return out,nil
}

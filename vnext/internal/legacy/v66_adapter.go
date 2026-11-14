package legacy

import (
 "encoding/json"
 "errors"
 "fmt"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// V66Adapter maps the browser export only. It never assigns live availability
// or treats historical coverage numbers as the new exact-book proof.
const V66Adapter = "v66-browser-jsonl-v1"
const v66Format = "MARKET_DEPTH_USD_NOTIONAL_TRUSTED_COVERAGE_V2"
var v66Venues = []string{"binance","coinbase","kraken","bitfinex"}
var v66Assets = []string{"BTC","ETH","SOL"}
type V66Block struct { ID string `json:"id"`; Base int64 `json:"base"`; Revision int64 `json:"revision"`; ReadAt int64 `json:"readAt"` }
type v66Depth struct {
 Type string `json:"type"`; T int64 `json:"t"`; A *int64 `json:"a"`; Cadence int64 `json:"cadence"`; D [][][][]*float64 `json:"d"`
 Source string `json:"source"`; Format string `json:"format"`; FinalVersion json.RawMessage `json:"finalVersion"`; Captured [][]*bool `json:"captured"`; Issues []string `json:"issues"`; Quality *struct{ Version string `json:"version"`; Books [][]json.RawMessage `json:"books"` } `json:"quality"`; Ratios json.RawMessage `json:"ratios"`
}
type v66Candle struct {
 Type string `json:"type"`; Asset string `json:"asset"`; Interval int64 `json:"interval"`; T int64 `json:"t"`; O,H,L,C,V *float64; Closed *bool `json:"closed"`; Complete *bool `json:"complete"`; ObservedAt *int64 `json:"observedAt"`; Source *string `json:"source"`
}
func v66Fields(raw []byte,keys ...string)error{m:=map[string]json.RawMessage{};for _,k:=range keys{m[k]=nil};return strictFields(raw,m)}
func v66Quality(v any)(*string,error){b,e:=json.Marshal(v);if e!=nil{return nil,e};s:=string(b);return &s,nil}
func v66Common(t int64, asset string,q *string) model.Common{return model.Common{T:t,Asset:asset,Status:"legacy_unknown",Source:model.Ptr("legacy:"+V66Adapter),Quality:q,Revision:1}}
// MapV66Rows expects the exact raw data record and its enclosing verified
// block. It returns 12 depth candidates or one one-minute candle. Metadata
// records are handled by the export reader; ratios remain in original bytes.
func MapV66Rows(raw []byte, block V66Block)([]model.Row,error){
 if len(raw)==0||len(raw)>MaxRowBytes||block.ID==""||block.Revision<1||block.Base<0||block.ReadAt<0{return nil,errors.New("invalid V66 evidence")}
 var typ struct{Type string `json:"type"`};if e:=json.Unmarshal(raw,&typ);e!=nil{return nil,e}
 switch typ.Type{
 case "depth":
  if e:=v66Fields(raw,"type","t","a","cadence","d","source","format","finalVersion","captured","issues","quality","ratios");e!=nil{return nil,e}
  var d v66Depth;if e:=json.Unmarshal(raw,&d);e!=nil{return nil,e}
  if d.Cadence!=60000||d.Format!=v66Format||d.T<0||d.T%60000!=0||d.A==nil||*d.A<d.T||d.Source!="railway"&&d.Source!="browser"&&d.Source!="recent"||len(d.D)!=4{return nil,errors.New("invalid V66 depth header")}
  if d.Captured!=nil&&len(d.Captured)!=4||d.Quality!=nil&&(len(d.Quality.Books)!=4||d.Quality.Version!="FORMAL_AVAILABLE_V1"&&d.Quality.Version!="FORMAL_AVAILABLE_V2"){return nil,errors.New("invalid V66 quality matrix")}
  out:=make([]model.Row,0,12)
  for vi,venue:=range v66Venues{
   if len(d.D[vi])!=3||d.Captured!=nil&&len(d.Captured[vi])!=3||d.Quality!=nil&&len(d.Quality.Books[vi])!=3{return nil,errors.New("invalid V66 asset matrix")}
   for ai,asset:=range v66Assets{
    z:=d.D[vi][ai];if len(z)!=5{return nil,errors.New("invalid V66 zones")};for _,pair:=range z{if len(pair)!=2{return nil,errors.New("invalid V66 bid/ask pair")}}
    var book json.RawMessage=json.RawMessage("null");var version *string;var captured *bool;var capAt *int64
    if d.Captured!=nil{captured=d.Captured[vi][ai]}
    if d.Quality!=nil{version=&d.Quality.Version;book=d.Quality.Books[vi][ai];var q *struct{CapturedAt *int64 `json:"capturedAt"`};if e:=json.Unmarshal(book,&q);e!=nil{return nil,e};if q!=nil{if q.CapturedAt==nil||*q.CapturedAt<0{return nil,errors.New("invalid V66 capture metadata")};capAt=q.CapturedAt}}
    q,e:=v66Quality(map[string]any{"legacy_source":d.Source,"legacy_format":d.Format,"legacy_a":d.A,"legacy_cadence_ms":d.Cadence,"legacy_final_version":d.FinalVersion,"legacy_captured":captured,"legacy_issues":d.Issues,"legacy_quality_version":version,"legacy_book":book,"legacy_block":block,"availability_evidence":"unverified_historical","coverage_evidence":"legacy_only"});if e!=nil{return nil,e}
    r:=model.SpotRow{Common:v66Common(d.T,asset,q),Venue:venue,CapturedAt:capAt,Bid0100:z[0][0],Ask0100:z[0][1],Bid100200:z[1][0],Ask100200:z[1][1],Bid200300:z[2][0],Ask200300:z[2][1],Bid300500:z[3][0],Ask300500:z[3][1],Bid500750:z[4][0],Ask500750:z[4][1]}
    if e=r.Validate();e!=nil{return nil,e};out=append(out,r)
   }
  }
  return out,nil
 case "candle":
  if e:=v66Fields(raw,"type","asset","interval","t","o","h","l","c","v","closed","complete","observedAt","source");e!=nil{return nil,e}
  var d v66Candle;if e:=json.Unmarshal(raw,&d);e!=nil{return nil,e}
  if d.Interval!=60000||d.Closed==nil||d.Complete==nil||d.O==nil||d.H==nil||d.L==nil||d.C==nil||d.V==nil{return nil,errors.New("invalid V66 candle header")}
  q,e:=v66Quality(map[string]any{"legacy_source":d.Source,"legacy_interval_ms":d.Interval,"legacy_observed_at":d.ObservedAt,"legacy_closed":d.Closed,"legacy_complete":d.Complete,"legacy_block":block,"availability_evidence":"unverified_historical"});if e!=nil{return nil,e}
  r:=model.Futures1Row{Common:v66Common(d.T,d.Asset,q),OHLC:model.OHLC{Open:d.O,High:d.H,Low:d.L,Close:d.C},Volume:d.V};if e=r.Validate();e!=nil{return nil,e};return []model.Row{r},nil
 default:return nil,fmt.Errorf("unsupported V66 data type %q",typ.Type)
 }
}

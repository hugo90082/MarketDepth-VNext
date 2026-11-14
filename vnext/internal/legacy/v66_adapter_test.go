package legacy

import (
 "encoding/json"
 "strings"
 "testing"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)
func TestV66ConservativeMapping(t *testing.T){
 block:=V66Block{ID:"depth:1",Base:60000,Revision:7,ReadAt:240000}
 d:=make([][][][]*float64,4)
 for i:=range d{d[i]=make([][][]*float64,3);for j:=range d[i]{d[i][j]=make([][]*float64,5);for k:=range d[i][j]{d[i][j][k]=[]*float64{model.Ptr(float64(100*i+10*j+k)),nil}}}}
 raw,e:=json.Marshal(map[string]any{"type":"depth","t":60000,"a":90000,"cadence":60000,"d":d,"source":"railway","format":v66Format,"finalVersion":nil,"captured":nil,"issues":[]string{},"quality":nil,"ratios":nil});if e!=nil{t.Fatal(e)}
 rows,e:=MapV66Rows(raw,block);if e!=nil||len(rows)!=12{t.Fatal(len(rows),e)}
 for i,r:=range rows{s:=r.(model.SpotRow);if s.Venue!=v66Venues[i/3]||s.Asset!=v66Assets[i%3]||s.Bid0100==nil||*s.Bid0100!=float64(100*(i/3)+10*(i%3))||s.Ask0100!=nil||s.AvailableAt!=nil||s.TrustedBid!=nil||s.ObservedBid!=nil||s.Status!="legacy_unknown"||!strings.Contains(*s.Quality,`"legacy_a":90000`){t.Fatal(s)};b,_:=json.Marshal(s);if _,e=ValidateCandidate(Evidence{strings.Repeat("a",64),strings.Repeat("b",64),1,V66Adapter},model.Spot,b);e!=nil{t.Fatal(e)}}
 k:=[]byte(`{"type":"candle","asset":"BTC","interval":60000,"t":60000,"o":2,"h":3,"l":1,"c":2,"v":0,"closed":true,"complete":true,"observedAt":60000,"source":null}`)
 rows,e=MapV66Rows(k,block);if e!=nil||len(rows)!=1{t.Fatal(e)};f:=rows[0].(model.Futures1Row);if f.AvailableAt!=nil||f.Status!="legacy_unknown"||f.Volume==nil||*f.Volume!=0||f.QuoteVolume!=nil||!strings.Contains(*f.Quality,`"legacy_source":null`){t.Fatal(f)}
 for _,bad:=range []string{strings.Replace(string(k),`"interval":60000`,`"interval":10000`,1),strings.Replace(string(k),`"h":3`,`"h":0`,1),strings.Replace(string(k),`"o":2`,`"o":2,"o":3`,1)}{if _,e=MapV66Rows([]byte(bad),block);e==nil{t.Fatal("accepted malformed candle")}}
}

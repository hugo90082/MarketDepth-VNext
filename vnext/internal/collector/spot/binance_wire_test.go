package spot
import (
 "strings"
 "testing"
)
func TestBinanceRealShapeDiff(t *testing.T){
 raw:=`{"e":"depthUpdate","E":1794647280000,"s":"BTCUSDT","U":9007199254740993,"u":9007199254740994,"b":[["100","0"]],"a":[["101","2"]]}`
 d,e:=decodeBinanceDelta([]byte(raw),"BTC")
 if e!=nil||d.First!=9007199254740993||d.Last!=9007199254740994||len(d.Bids)!=1||d.Bids[0].Qty!=0||d.Asks[0].Qty!=2{t.Fatal(d,e)}
 for _,bad:=range []string{
  strings.Replace(raw,`"e":"depthUpdate",`,"",1),
  strings.Replace(raw,`"U":9007199254740993,`,"",1),
  strings.Replace(raw,`"b":[["100","0"]]`,`"B":[["100","0"]]`,1),
  strings.Replace(raw,`"a":[["101","2"]]`,`"a":null`,1),
  strings.Replace(raw,"BTCUSDT","ETHUSDT",1),
 }{if _,e:=decodeBinanceDelta([]byte(bad),"BTC");e==nil{t.Fatal("accepted",bad)}}
}

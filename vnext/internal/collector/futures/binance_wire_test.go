package futures
import (
 "encoding/json"
 "errors"
 "fmt"
 "strings"
 "testing"
)
func TestBinanceRealShapeAggAndKline(t *testing.T){
 raw:=fmt.Sprintf(`{"e":"aggTrade","E":%d,"s":"BTCUSDT","a":9007199254740993,"p":"100","q":"2","nq":"1","f":9007199254740994,"l":9007199254740995,"T":%d,"m":false,"M":true}`,t0+1,t0)
 x,e:=ParseWSAgg([]byte(raw),t0+2)
 if e!=nil||x.ID!=9007199254740993||x.BuyerMaker||x.Qty!=2||x.T!=t0{t.Fatal(x,e)}
 for _,bad:=range []string{strings.Replace(raw,`"e":"aggTrade",`,"",1),strings.Replace(raw,`"m":false,`,"",1),strings.Replace(raw,`"T":`,`"t":`,1)}{
  if _,e:=ParseWSAgg([]byte(bad),t0+2);e==nil{t.Fatal("accepted",bad)}
 }
 var w tradeWire
 if e:=json.Unmarshal([]byte(fmt.Sprintf(`{"a":1,"p":"100","q":"2","f":2,"l":3,"T":%d,"m":true,"M":false}`,t0)),&w);e!=nil||w.Maker==nil||!*w.Maker{t.Fatal(w,e)}
 k:=fmt.Sprintf(`{"e":"kline","E":%d,"s":"BTCUSDT","k":{"t":%d,"T":%d,"s":"BTCUSDT","i":"1m","f":1,"L":200,"o":"100","h":"101","l":"99","c":"100","v":"10","n":23,"x":true,"q":"1000","V":"4","Q":"400","B":"0"}}`,t0+60000,t0,t0+59999)
 r,e:=ParseWSKline([]byte(k),t0+60001)
 if e!=nil||r.Low==nil||*r.Low!=99||*r.TakerBuyQty!=4||*r.TradeCount!=23{t.Fatal(r,e)}
 if _,e:=ParseWSKline([]byte(strings.Replace(k,`"x":true`,`"x":false`,1)),t0+60001);!errors.Is(e,ErrOpenKline){t.Fatal(e)}
 if _,e:=ParseWSKline([]byte(strings.Replace(k,`"l":"99",`,"",1)),t0+60001);e==nil{t.Fatal("uppercase L supplied missing low")}
 if _,e:=ParseWSKline([]byte(k),t0+59999);e==nil{t.Fatal("accepted early closed kline")}
}

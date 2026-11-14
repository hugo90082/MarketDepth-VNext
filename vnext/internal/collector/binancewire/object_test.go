package binancewire
import "testing"
func TestExactKeys(t *testing.T){
 var e string
 var l string
 if err:=Object([]byte(`{"E":123,"e":"kline","L":23,"l":"99"}`),map[string]any{"e":&e,"l":&l},nil);err!=nil||e!="kline"||l!="99"{t.Fatal(e,l,err)}
 for _,raw:=range []string{`{"E":"kline","l":"99"}`,`{"e":"kline","l":null}`,`{"e":"kline","e":"trade","l":"99"}`,`{"e":"kline","l":"99","E":1,"E":2}`,`{"e":"kline","l":"99"}{}`,`[]`}{
  if err:=Object([]byte(raw),map[string]any{"e":&e,"l":&l},nil);err==nil{t.Fatal("accepted",raw)}
 }
}

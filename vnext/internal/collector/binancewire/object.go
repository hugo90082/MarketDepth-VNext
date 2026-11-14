// Package binancewire decodes Binance's case-sensitive compact JSON keys.
// encoding/json struct matching falls back to case-insensitive matching:
// e (event type) and E (event time), l (low) and L (last trade ID) differ.
package binancewire

import (
 "bytes"
 "encoding/json"
 "errors"
 "fmt"
 "io"
)

// Object requires the exact spelling and non-null value of each required
// field. Additional fields are permitted but cannot overwrite a known field.
// Duplicate keys (even unknown ones) and trailing JSON are rejected.
func Object(raw []byte, required, optional map[string]any) error {
 d:=json.NewDecoder(bytes.NewReader(raw))
 tok,e:=d.Token()
 if e!=nil||tok!=json.Delim('{'){return errors.New("expected Binance JSON object")}
 seen:=map[string]bool{}
 for d.More(){
  key,e:=d.Token();if e!=nil{return e}
  name,ok:=key.(string);if !ok||seen[name]{return errors.New("duplicate or invalid Binance JSON key")}
  seen[name]=true
  var value json.RawMessage
  if e=d.Decode(&value);e!=nil{return e}
  dst,ok:=required[name]
  if !ok{dst,ok=optional[name]}
  if !ok{continue}
  if bytes.Equal(bytes.TrimSpace(value),[]byte("null")){return fmt.Errorf("null Binance field %s",name)}
  if e=json.Unmarshal(value,dst);e!=nil{return fmt.Errorf("Binance field %s: %w",name,e)}
 }
 tok,e=d.Token()
 if e!=nil||tok!=json.Delim('}'){return errors.New("invalid Binance JSON object ending")}
 if _,e=d.Token();e!=io.EOF{return errors.New("trailing Binance JSON")}
 for name:=range required{if !seen[name]{return fmt.Errorf("missing Binance field %s",name)}}
 return nil
}

//go:build sqlite_integration

// This command is exclusively for synthetic, offline historical-import QA.
// It does not accept a real historical source format or publish any archive.
package main

import (
 "context"
 "encoding/json"
 "errors"
 "flag"
 "fmt"
 "os"
 "os/signal"
 "path/filepath"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/legacy"
)

func run(ctx context.Context)error{
 mode:=flag.String("mode","","build-fixture or verify-fixture")
 source:=flag.String("source","","original synthetic gzip")
 sha:=flag.String("source-sha256","","expected SHA256 of original gzip")
 raw:=flag.String("raw-stage","","completed synthetic raw staging directory")
 ledger:=flag.String("ledger","","isolated candidate ledger directory")
 days:=flag.String("days","","isolated fixture output directory")
 maxBytes:=flag.Int64("max-uncompressed-bytes",1<<30,"bounded gzip expansion for offline QA")
 flag.Parse()
 if flag.NArg()!=0||(*mode!="build-fixture"&&*mode!="verify-fixture")||*source==""||*sha==""||*raw==""||*ledger==""||*days==""{return errors.New("explicit mode, source, source-sha256, raw-stage, ledger and days required")}
 paths:=map[string]bool{}
 for _,p:=range []string{*source,*raw,*ledger,*days}{
  a,e:=filepath.Abs(p);if e!=nil{return e}
  if paths[a]{return errors.New("source and output paths must be distinct")}
  paths[a]=true
 }
 s,e:=legacy.VerifyRawStage(ctx,*raw,*source,*sha,*maxBytes);if e!=nil{return e}
 defer s.Close()
 var l *legacy.Ledger
 if *mode=="build-fixture"{
  l,e=legacy.CreateLedger(*ledger)
 }else{l,e=legacy.OpenFixtureLedgerReadOnly(ctx,*ledger)}
 if e!=nil{return e}
 defer l.Close()
 if *mode=="build-fixture"{
  mapped,e:=l.MapVerifiedFixture(ctx,s);if e!=nil{return e}
  if mapped.Quarantined!=0{return errors.New("fixture contains quarantined records; inspect offline audit")}
  if _,e=l.GenerateFixtureDays(ctx,s,*days);e!=nil{return e}
 }
 verified,e:=l.VerifyFixtureDays(ctx,s,*days);if e!=nil{return e}
 return json.NewEncoder(os.Stdout).Encode(struct{
  FixtureOnly bool `json:"fixture_only"`
  Verified bool `json:"verified"`
  Result legacy.FixtureDays `json:"result"`
 }{true,true,verified})
}

func main(){
 ctx,cancel:=signal.NotifyContext(context.Background(),os.Interrupt)
 defer cancel()
 if e:=run(ctx);e!=nil{fmt.Fprintln(os.Stderr,"fixture QA failed:",e);os.Exit(1)}
}

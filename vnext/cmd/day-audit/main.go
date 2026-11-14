//go:build linux && sqlite_integration

// Offline audit only. No collector, credentials, archive upload or live root.
package main

import (
 "context"
 "encoding/json"
 "flag"
 "fmt"
 "os"
 "os/signal"
 "syscall"
 "time"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

func main(){
 file:=flag.String("sqlite","","immutable raw SQLite copy from verified sealed archive")
 day:=flag.String("day","","UTC+8 day YYYY-MM-DD")
 sha:=flag.String("raw-sha256","","expected raw digest from independent verified manifest")
 producer:=flag.String("producer-commit","","expected exact producer commit")
 flag.Parse()
 if flag.NArg()!=0||*file==""||*day==""||*sha==""||*producer==""{fmt.Fprintln(os.Stderr,"all four flags are required");os.Exit(2)}
 ctx,stop:=signal.NotifyContext(context.Background(),os.Interrupt,syscall.SIGTERM);defer stop()
 ctx,cancel:=context.WithTimeout(ctx,5*time.Minute);defer cancel()
 result,e:=store.AuditSealedDay(ctx,*file,*day,*sha,*producer)
 if e!=nil{fmt.Fprintln(os.Stderr,"day audit failed:",e);os.Exit(1)}
 enc:=json.NewEncoder(os.Stdout);enc.SetIndent("","  ")
 if e=enc.Encode(result);e!=nil{fmt.Fprintln(os.Stderr,"cannot write report");os.Exit(1)}
}

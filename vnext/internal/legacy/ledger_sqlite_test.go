//go:build sqlite_integration

package legacy

import (
 "context"
 "os"
 "path/filepath"
 "testing"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func TestLedgerKeepsConflictsAndReplay(t *testing.T){
 root:=filepath.Join(t.TempDir(),"candidate")
 l,e:=CreateLedger(root);if e!=nil{t.Fatal(e)}
 defer l.Close()
 ctx:=context.Background()
 row:=spot()
 ev:=evidence()
 b:=encoded(t,row)
 a,e:=l.Add(ctx,ev,model.Spot,b)
 if e!=nil||a.Replay||a.Variants!=1||a.Relation!=Identical{t.Fatal(a,e)}
 a,e=l.Add(ctx,ev,model.Spot,b)
 if e!=nil||!a.Replay||a.Variants!=1{t.Fatal(a,e)}
 ev.Line=2
 a,e=l.Add(ctx,ev,model.Spot,b)
 if e!=nil||a.Replay||a.Variants!=1{t.Fatal(a,e)}
 row.Bid0100=nil
 if _,e=l.Add(ctx,ev,model.Spot,encoded(t,row));e==nil{t.Fatal("conflicting replay accepted")}
 ev.Line=3
 a,e=l.Add(ctx,ev,model.Spot,encoded(t,row))
 if e!=nil||a.Relation!=Conflict||a.Variants!=2{t.Fatal(a,e)}
 var n int
 if e=l.db.QueryRow("SELECT count(*) FROM candidate").Scan(&n);e!=nil||n!=3{t.Fatal(n,e)}
 if _,e=CreateLedger(root);!os.IsExist(e){t.Fatal("overwrite guard",e)}
}

//go:build linux && sqlite_integration

package store

import (
 "context"
 "path/filepath"
 "strings"
 "testing"

 "github.com/hugo90082/MarketDepth-VNext/vnext/contract"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// A candidate stays blocked even if accidentally renamed and relabeled live.
func TestCandidateOnlyMetadataBlocksLiveStorage(t *testing.T) {
 ctx:=context.Background()
 const day="2026-09-20"
 db,e:=SQLiteOpener(filepath.Join(t.TempDir(),day+".sqlite"),false)
 if e!=nil {t.Fatal(e)}
 defer db.Close()
 if _,e=db.ExecContext(ctx,contract.Schema);e!=nil {t.Fatal(e)}
 for k,v:=range map[string]string{"contract_id":model.Contract,"day":day,"timezone":model.Timezone,"data_origin":"live","archive_revision":"1","candidate_only":"true"} {
  if _,e=db.ExecContext(ctx,"INSERT INTO meta VALUES(?,?)",k,v);e!=nil {t.Fatal(e)}
 }
 for _,e:=range []error{rejectFixtureMeta(ctx,db),validateDayMetadata(ctx,db,day)} {
  if e==nil||!strings.Contains(e.Error(),"candidate-only") {t.Fatal("candidate metadata not rejected",e)}
 }
 if _,e=OpenDaily(ctx,db,day);e==nil||!strings.Contains(e.Error(),"candidate-only") {t.Fatal("candidate opened for live writing",e)}
}

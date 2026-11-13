//go:build sqlite_integration

package legacy

import (
 "bufio"
 "bytes"
 "compress/gzip"
 "context"
 "crypto/sha256"
 "database/sql"
 "encoding/hex"
 "encoding/json"
 "errors"
 "fmt"
 "io"
 "net/url"
 "os"
 "path/filepath"
)

const MaxRawLine = 4 << 20

type rawReport struct {
 Status string `json:"status"`
 MappingApproved bool `json:"mapping_approved"`
 CompressedSHA string `json:"compressed_sha256"`
 UncompressedSHA string `json:"uncompressed_sha256"`
 Records int64 `json:"records"`
 Bytes int64 `json:"uncompressed_bytes"`
}

// RawStage pins a read-only SQLite transaction. A verified stage is not an
// approved mapping. Close releases the snapshot; it never writes the input.
type RawStage struct {
 db *sql.DB
 tx *sql.Tx
 report rawReport
}

func(s *RawStage)Close()error{
 _=s.tx.Rollback()
 return s.db.Close()
}

// VerifyRawStage rechecks EVERY stored occurrence against the original gzip,
// not merely the untrusted report. expectedSHA is externally supplied.
// It requires offline, immutable input files and a completed raw stage.
func VerifyRawStage(ctx context.Context,root,source,expectedSHA string,maxBytes int64)(stage *RawStage,err error){
 if !validHash(expectedSHA)||maxBytes<=0{return nil,errors.New("invalid expected hash or expansion limit")}
 if _,e:=os.Lstat(filepath.Join(root,".legacy-stage-building"));!errors.Is(e,os.ErrNotExist){return nil,errors.New("raw stage incomplete")}
 path,e:=filepath.Abs(filepath.Join(root,"legacy-raw.sqlite"));if e!=nil{return nil,e}
 st,e:=os.Lstat(path);if e!=nil||!st.Mode().IsRegular(){return nil,errors.New("regular raw stage required")}
 for _,suffix:=range []string{"-wal","-shm","-journal"}{
  if _,e=os.Lstat(path+suffix);!errors.Is(e,os.ErrNotExist){return nil,errors.New("raw stage sidecar present")}
 }
 uri:=url.URL{Scheme:"file",Path:path,RawQuery:"mode=ro&_query_only=1"}
 db,e:=sql.Open("sqlite3",uri.String());if e!=nil{return nil,e}
 defer func(){if err!=nil{db.Close()}}()
 db.SetMaxOpenConns(1)
 tx,e:=db.BeginTx(ctx,&sql.TxOptions{ReadOnly:true});if e!=nil{return nil,e}
 defer func(){if err!=nil{tx.Rollback()}}()
 var state string
 if e=tx.QueryRowContext(ctx,"SELECT value FROM stage_meta WHERE key='state'").Scan(&state);e!=nil||state!="complete"{return nil,errors.New("raw stage not complete")}
 var reportText string
 if e=tx.QueryRowContext(ctx,"SELECT value FROM stage_meta WHERE key='report' AND length(value)<=1048576").Scan(&reportText);e!=nil{return nil,e}
 var report rawReport
 if e=json.Unmarshal([]byte(reportText),&report);e!=nil{return nil,e}
 if report.Status!="raw_stage_only"||report.MappingApproved||report.CompressedSHA!=expectedSHA||!validHash(report.UncompressedSHA)||report.Records<=0||report.Bytes<=0||report.Bytes>maxBytes{return nil,errors.New("raw stage report mismatch")}
 var check string
 if e=tx.QueryRowContext(ctx,"PRAGMA quick_check").Scan(&check);e!=nil||check!="ok"{return nil,errors.New("raw stage integrity failure")}
 f,e:=os.Open(source);if e!=nil{return nil,e};defer f.Close()
 before,e:=f.Stat();if e!=nil||!before.Mode().IsRegular(){return nil,errors.New("regular gzip required")}
 compressed:=sha256.New()
 gz,e:=gzip.NewReader(io.TeeReader(f,compressed));if e!=nil{return nil,e}
 defer gz.Close()
 reader:=bufio.NewReaderSize(gz,MaxRawLine+1)
 plain:=sha256.New()
 rows,e:=tx.QueryContext(ctx,`SELECT o.line_no,o.sha256,p.body FROM occurrence o LEFT JOIN raw_payload p USING(sha256) ORDER BY o.line_no`);if e!=nil{return nil,e}
 defer rows.Close()
 var line,total int64
 for rows.Next(){
  if e=ctx.Err();e!=nil{return nil,e}
  var n int64
  var digest string
  var raw []byte
  if e=rows.Scan(&n,&digest,&raw);e!=nil{return nil,e}
  line++
  if n!=line||len(raw)==0||len(raw)>MaxRawLine||hash(raw)!=digest{return nil,fmt.Errorf("raw evidence mismatch at line %d",line)}
  actual,readErr:=reader.ReadSlice('\n')
  if readErr!=nil&&readErr!=io.EOF{return nil,readErr}
  if !bytes.Equal(raw,actual){return nil,fmt.Errorf("original gzip differs at line %d",line)}
  total+=int64(len(actual))
  if total>maxBytes{return nil,errors.New("expansion limit")}
  plain.Write(actual)
 }
 if e=rows.Err();e!=nil{return nil,e}
 if e=rows.Close();e!=nil{return nil,e}
 if _,e=reader.ReadByte();e!=io.EOF{return nil,errors.New("extra source bytes or gzip failure")}
 after,e:=f.Stat();if e!=nil||!os.SameFile(before,after)||before.Size()!=after.Size()||!before.ModTime().Equal(after.ModTime()){return nil,errors.New("source changed")}
 if line!=report.Records||total!=report.Bytes||hex.EncodeToString(plain.Sum(nil))!=report.UncompressedSHA||hex.EncodeToString(compressed.Sum(nil))!=expectedSHA{return nil,errors.New("raw stage counts or hashes differ")}
 var orphans int64
 if e=tx.QueryRowContext(ctx,`SELECT count(*) FROM raw_payload p WHERE NOT EXISTS (SELECT 1 FROM occurrence o WHERE o.sha256=p.sha256)`).Scan(&orphans);e!=nil||orphans!=0{return nil,errors.New("unreferenced raw payload")}
 return &RawStage{db,tx,report},nil
}

// Line returns evidence from the already verified read-only snapshot.
func(s *RawStage)Line(ctx context.Context,line int64,adapter string)(Evidence,[]byte,error){
 var ev Evidence
 var raw []byte
 var digest string
 if line<1||line>s.report.Records{return ev,nil,errors.New("line outside verified source")}
 if e:=s.tx.QueryRowContext(ctx,`SELECT o.sha256,p.body FROM occurrence o JOIN raw_payload p USING(sha256) WHERE o.line_no=?`,line).Scan(&digest,&raw);e!=nil{return ev,nil,e}
 if hash(raw)!=digest{return ev,nil,errors.New("raw row hash mismatch")}
 return Evidence{s.report.CompressedSHA,digest,line,adapter},raw,nil
}

//go:build sqlite_integration

package legacy

import (
 "bytes"
 "context"
 "database/sql"
 "errors"
 "os"
 "net/url"
 "path/filepath"

 _ "github.com/mattn/go-sqlite3"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

const LedgerName="legacy-candidates.sqlite"
const ledgerSchema=`
CREATE TABLE candidate(
 source_sha TEXT NOT NULL, raw_sha TEXT NOT NULL, line_no INTEGER NOT NULL,
 adapter TEXT NOT NULL, kind TEXT NOT NULL, t INTEGER NOT NULL,
 venue TEXT NOT NULL, asset TEXT NOT NULL, day TEXT NOT NULL,
 row_sha TEXT NOT NULL, row_json BLOB NOT NULL,
 PRIMARY KEY(source_sha,line_no,adapter,kind,t,venue,asset)
) WITHOUT ROWID;
CREATE INDEX candidate_key ON candidate(kind,t,venue,asset,row_sha);
`

// Ledger is an offline candidate-only database. It never opens a live daily
// file or assigns canonical winners. A fresh directory is required.
type Ledger struct{ db *sql.DB }

func CreateLedger(root string)(*Ledger,error){
 if err:=os.Mkdir(root,0700);err!=nil{return nil,err}
 path,e:=filepath.Abs(filepath.Join(root,LedgerName));if e!=nil{return nil,e}
 f,e:=os.OpenFile(path,os.O_WRONLY|os.O_CREATE|os.O_EXCL,0600);if e!=nil{return nil,e}
 if e=f.Close();e!=nil{return nil,e}
 uri:=url.URL{Scheme:"file",Path:path}
 db,e:=sql.Open("sqlite3",uri.String());if e!=nil{return nil,e}
 db.SetMaxOpenConns(1)
 for _,q:=range []string{"PRAGMA journal_mode=DELETE","PRAGMA synchronous=FULL","PRAGMA cache_size=-8192",ledgerSchema}{
  if _,e=db.Exec(q);e!=nil{db.Close();return nil,e}
 }
 return &Ledger{db},nil
}

func(l *Ledger)Close()error{return l.db.Close()}

type Admission struct{
 Replay bool
 Relation Relation
 Variants int64
}

// Add validates mapped rows again and persists one occurrence per evidence/key.
// A repeated evidence/key with differing bytes is rejected. Distinct evidence
// can disagree and all candidates remain queryable. This does not verify the
// source SHA/line against the raw staging database; that gate is separate.
func(l *Ledger)Add(ctx context.Context,ev Evidence,k model.Kind,b []byte)(Admission,error){
 var out Admission
 c,e:=ValidateCandidate(ev,k,b);if e!=nil{return out,e}
 tx,e:=l.db.BeginTx(ctx,nil);if e!=nil{return out,e}
 defer tx.Rollback()
 args:=[]any{ev.SourceSHA256,ev.Line,ev.Adapter,k,c.Key.T,c.Key.Venue,c.Key.Asset}
 var raw,sha string
 var old []byte
 e=tx.QueryRowContext(ctx,`SELECT raw_sha,row_sha,row_json FROM candidate
 WHERE source_sha=? AND line_no=? AND adapter=? AND kind=? AND t=? AND venue=? AND asset=?`,args...).Scan(&raw,&sha,&old)
 switch{
 case e==nil:
  if raw!=ev.RawSHA256||sha!=c.SHA256||!bytes.Equal(old,c.CanonicalJSON){return out,errors.New("conflicting replay of same evidence")}
  out.Replay=true
 case errors.Is(e,sql.ErrNoRows):
  _,e=tx.ExecContext(ctx,`INSERT INTO candidate VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
   ev.SourceSHA256,ev.RawSHA256,ev.Line,ev.Adapter,k,c.Key.T,c.Key.Venue,c.Key.Asset,c.Day,c.SHA256,c.CanonicalJSON)
  if e!=nil{return out,e}
 default:return out,e
 }
 // Count exact byte variants, not only hash identity.
 e=tx.QueryRowContext(ctx,`SELECT count(*) FROM (SELECT row_sha,row_json FROM candidate
 WHERE kind=? AND t=? AND venue=? AND asset=? GROUP BY row_sha,row_json)`,k,c.Key.T,c.Key.Venue,c.Key.Asset).Scan(&out.Variants)
 if e!=nil{return out,e}
 out.Relation=Identical
 if out.Variants>1{out.Relation=Conflict}
 if e=tx.Commit();e!=nil{return Admission{},e}
 return out,nil
}

//go:build linux && sqlite_integration

package store

import(
 "context"
 "crypto/sha256"
 "database/sql"
 "encoding/hex"
 "encoding/json"
 "errors"
 "net/url"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// ActiveRecoveryIndex captures exact row hashes in a remotely verified
// hourly generation. It distinguishes an absent key and a stale repaired
// version, without assuming timestamp coverage means full grid coverage.
// Fixed dense hash slots are bounded at 1,520,640 bytes per active day.
type ActiveRecoveryIndex struct{
 Grid GridIndex `json:"grid"`
 Spot []byte `json:"spot_hashes"`
 F10 []byte `json:"f10_hashes"`
 F1 []byte `json:"f1_hashes"`
}
func newActiveRecovery(m archive.Manifest)(*ActiveRecoveryIndex,error){
 if _,_,e:=archive.ActiveKeys(m);e!=nil{return nil,e}
 b,e:=json.Marshal(m);if e!=nil{return nil,e}
 h:=sha256.Sum256(b)
 g,e:=NewGridIndex(m.Day,m.Revision,hex.EncodeToString(h[:]));if e!=nil{return nil,e}
 return &ActiveRecoveryIndex{Grid:*g,Spot:make([]byte,32*gridCapacity(model.Spot)),F10:make([]byte,32*gridCapacity(model.F10)),F1:make([]byte,32*gridCapacity(model.F1))},nil
}
func(x *ActiveRecoveryIndex) hashes(k model.Kind)[]byte{
 switch k{case model.Spot:return x.Spot;case model.F10:return x.F10;case model.F1:return x.F1}
 return nil
}
func(x *ActiveRecoveryIndex) add(row model.Row)error{
 if rowNil(row)||row.Validate()!=nil{return ErrUnavailable}
 from,to,e:=x.Grid.bounds();if e!=nil{return e}
 k,key:=row.Kind(),row.Key()
 n,e:=gridOffset(k,from,to,key);if e!=nil{return e}
 h:=x.hashes(k)
 if len(h)!=32*gridCapacity(k){return ErrUnavailable}
 digest,e:=journalHash(row);if e!=nil{return e}
 b,e:=hex.DecodeString(digest);if e!=nil||len(b)!=32{return ErrUnavailable}
 if e=x.Grid.Add(k,key);e!=nil{return e}
 copy(h[n*32:(n+1)*32],b)
 return nil
}
func(x *ActiveRecoveryIndex) HashAt(k model.Kind,key model.Key)(string,error){
 from,to,e:=x.Grid.bounds();if e!=nil{return "",e}
 n,e:=gridOffset(k,from,to,key);if e!=nil{return "",e}
 h:=x.hashes(k)
 if len(h)!=32*gridCapacity(k){return "",ErrUnavailable}
 if x.Grid.data(k)[n/8]&(1<<uint(n%8))==0{return "",nil}
 return hex.EncodeToString(h[n*32:(n+1)*32]),nil
}
func(x *ActiveRecoveryIndex) validate(r archive.PublishedRecord)error{
 if x==nil||archive.ValidateActiveRecord(r)!=nil{return ErrUnavailable}
 g:=&x.Grid;m:=r.Manifest
 from,to,e:=g.bounds();if e!=nil{return e}
 if g.Day!=m.Day||g.Revision!=m.Revision||g.ManifestSHA256!=r.ManifestSHA256||from!=m.From||to!=m.To{return ErrUnavailable}
 for _,k:=range []model.Kind{model.Spot,model.F10,model.F1}{
  n,ok:=m.RowCounts[string(k)]
  through,has:=m.GridThrough[string(k)]
  if !ok||!has||through<from||through>to||(through-from)%k.Interval()!=0||g.Count(k)!=n||len(x.hashes(k))!=32*gridCapacity(k){return ErrUnavailable}
  slots:=int((through-from)/k.Interval())*gridWidth(k)
  for i:=slots;i<gridCapacity(k);i++{if g.data(k)[i/8]&(1<<uint(i%8))!=0{return ErrUnavailable}}
 }
 return nil
}
func buildActiveRecovery(ctx context.Context,path string,m archive.Manifest)(*ActiveRecoveryIndex,error){
 x,e:=newActiveRecovery(m);if e!=nil{return nil,e}
 u:=url.URL{Scheme:"file",Path:path};q:=u.Query();q.Set("mode","ro");q.Set("immutable","1");q.Set("_query_only","1");u.RawQuery=q.Encode()
 db,e:=sql.Open("sqlite3",u.String());if e!=nil{return nil,e}
 defer db.Close();db.SetMaxOpenConns(1)
 for _,kind:=range []model.Kind{model.Spot,model.F10,model.F1}{
  var after *model.Key
  for{
   venue:="venue";if kind!=model.Spot{venue="''"}
   query:="SELECT t,"+venue+",asset FROM "+string(kind)
   args:=[]any{}
   if after!=nil{
    if kind==model.Spot{query+=" WHERE (t,venue,asset)>(?,?,?)";args=append(args,after.T,after.Venue,after.Asset)}else{query+=" WHERE (t,asset)>(?,?)";args=append(args,after.T,after.Asset)}
   }
   query+=" ORDER BY t";if kind==model.Spot{query+=",venue"};query+=",asset LIMIT 256"
   rs,e:=db.QueryContext(ctx,query,args...);if e!=nil{return nil,e}
   keys:=make([]model.Key,0,256)
   for rs.Next(){var k model.Key;if e=rs.Scan(&k.T,&k.Venue,&k.Asset);e!=nil{rs.Close();return nil,e};keys=append(keys,k)}
   e=rs.Err();rs.Close();if e!=nil{return nil,e}
   for _,k:=range keys{
    row,e:=readRow(ctx,db,kind,k)
    if e!=nil||rowNil(row)||row.Key()!=k||row.Kind()!=kind{return nil,ErrUnavailable}
    if e=x.add(row);e!=nil{return nil,e}
   }
   if len(keys)<256{break}
   k:=keys[len(keys)-1];after=&k
  }
 }
 return x,nil
}

// The publication intent is still durable until this exact index commits.
// If the process crashes after registerActive and before this write, retry
// re-verifies the same immutable generation; partial loss remains refused.
func(j *Journal) registerActiveRecovery(ctx context.Context,r archive.PublishedRecord,x *ActiveRecoveryIndex)error{
 if e:=x.validate(r);e!=nil{return e}
 b,e:=json.Marshal(x);if e!=nil||len(b)>3<<20{return ErrUnavailable}
 j.mu.Lock();defer j.mu.Unlock()
 if e=j.ready(ctx);e!=nil{return e}
 s,e:=j.activeState(ctx,r.Manifest.Day);if e!=nil||s.Current.ManifestSHA256!=r.ManifestSHA256{return ErrResync}
 var oldHash string;var old []byte
 e=j.db.QueryRowContext(ctx,"SELECT manifest_sha256,index_json FROM journal_active_recovery WHERE day=?",r.Manifest.Day).Scan(&oldHash,&old)
 if e==nil&&oldHash==r.ManifestSHA256{
  if string(old)!=string(b){return ErrUnavailable};return nil
 }
 if e!=nil&&!errors.Is(e,sql.ErrNoRows){return e}
 _,e=j.db.ExecContext(ctx,"INSERT INTO journal_active_recovery(day,manifest_sha256,index_json) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET manifest_sha256=excluded.manifest_sha256,index_json=excluded.index_json",r.Manifest.Day,r.ManifestSHA256,b)
 return e
}
func(j *Journal) ActiveRecovery(ctx context.Context,day string)(*ActiveRecoveryIndex,error){
 j.mu.Lock();defer j.mu.Unlock()
 s,e:=j.activeState(ctx,day);if e!=nil{return nil,e}
 return j.activeRecoveryForLocked(ctx,s.Current)
}
func(j *Journal) activeRecoveryForLocked(ctx context.Context,rec archive.PublishedRecord)(*ActiveRecoveryIndex,error){
 day:=rec.Manifest.Day
 var b []byte;var h string
 if e:=j.db.QueryRowContext(ctx,"SELECT manifest_sha256,index_json FROM journal_active_recovery WHERE day=?",day).Scan(&h,&b);e!=nil{return nil,e}
 var x ActiveRecoveryIndex
 if h!=rec.ManifestSHA256||len(b)>3<<20||json.Unmarshal(b,&x)!=nil||x.validate(rec)!=nil{return nil,ErrUnavailable}
 return &x,nil
}

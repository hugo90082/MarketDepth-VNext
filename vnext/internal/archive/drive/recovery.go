package drive

import(
 "context"
 "errors"
 "fmt"
 "io"
 "net/url"
 "regexp"
 "sort"
 "strconv"
 "strings"

 "github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
)

var recoveryKey=regexp.MustCompile(`^(historical/[0-9]{4}/[0-9]{2}/[0-9]{4}-[0-9]{2}-[0-9]{2}\.r[1-9][0-9]*\.(manifest\.json|sqlite\.gz)|active/[0-9]{4}-[0-9]{2}-[0-9]{2}\.h[0-9]{13}\.(manifest\.json|sqlite\.gz)|catalog/loss/[0-9]{4}-[0-9]{2}-[0-9]{2}(\.partial)?\.json)$`)

// RecoveryReader is a read-only capability for a stopped-writer recovery
// procedure. It does not trust or require local reservation files. Every
// object is looked up in its exact namespace, logical key and folder chain.
// Neither discovery nor OpenObject creates folders, uploads, or reservations.
type RecoveryReader struct{c *Client}
func(c *Client) RecoveryReader()*RecoveryReader{return &RecoveryReader{c:c}}
var _ archive.RemoteObjects=(*RecoveryReader)(nil)
func(r *RecoveryReader) PutImmutable(context.Context,string,int64,string,io.Reader)(archive.Object,error){
 return archive.Object{},errors.New("read-only recovery transport")
}
func(c *Client) recoveryParent(ctx context.Context,key string)(string,error){
 if !validKey(key)||!recoveryKey.MatchString(key){return "",errors.New("invalid recovery key")}
 root,e:=c.get(ctx,"root")
 if e!=nil||!identifier(root.ID)||root.MIME!=folderType||root.Trashed{return "",errors.New("cannot resolve recovery My Drive root")}
 parent:=root.ID
 p:=strings.Split(key,"/")
 for i:=-1;i<len(p)-1;i++{
  k,name:="root",c.namespace
  if i>=0{k="dir/"+strings.Join(p[:i+1],"/");name=p[i]}
  f,e:=c.list(ctx,parent,k);if e!=nil{return "",e}
  if f==nil||!identifier(f.ID){return "",errors.New("recovery folder missing")}
  want:=reservation{ID:f.ID,Key:k,Parent:parent,MIME:folderType}
  if e=c.check(*f,want,name);e!=nil{return "",e}
  parent=f.ID
 }
 return parent,nil
}
func(c *Client) recoveryMetadata(ctx context.Context,f file)(reservation,error){
 var z reservation
 key:=f.Props["md_key"]
 if !validKey(key)||!recoveryKey.MatchString(key)||!identifier(f.ID)||f.Props["md_ns"]!=c.namespace{return z,errors.New("object outside recovery namespace")}
 n,e:=strconv.ParseInt(f.Size,10,64);h:=f.Props["md_sha256"]
 if e!=nil||n<=0||n>archive.HardLimit||!digestOK(h){return z,errors.New("invalid recovery object metadata")}
 mime:="application/octet-stream";if strings.HasSuffix(key,".json"){mime="application/json"}
 parent,e:=c.recoveryParent(ctx,key);if e!=nil{return z,e}
 found,e:=c.list(ctx,parent,key);if e!=nil{return z,e}
 if found==nil||found.ID!=f.ID{return z,errors.New("recovery object key mismatch")}
 p:=strings.Split(key,"/")
 want:=reservation{ID:f.ID,Key:key,Parent:parent,MIME:mime,Size:n,SHA:h}
 if e=c.check(f,want,p[len(p)-1]);e!=nil{return z,e}
 if e=c.check(*found,want,p[len(p)-1]);e!=nil{return z,e}
 return want,nil
}
func(r *RecoveryReader) OpenObject(ctx context.Context,id string)(archive.Object,io.ReadCloser,error){
 var z archive.Object
 if r==nil||r.c==nil{return z,nil,errors.New("recovery client required")}
 c:=r.c
 f,e:=c.get(ctx,id);if e!=nil{return z,nil,e}
 if f.ID!=id{return z,nil,errors.New("recovery ID mismatch")}
 want,e:=c.recoveryMetadata(ctx,f);if e!=nil{return z,nil,e}
 res,e:=c.request(ctx,"GET",c.base+"/drive/v3/files/"+id+"?alt=media",nil,0,nil)
 if e!=nil{return z,nil,e}
 if res.StatusCode!=200{res.Body.Close();return z,nil,responseStatus(res)}
 if res.ContentLength>=0&&res.ContentLength!=want.Size{res.Body.Close();return z,nil,errors.New("recovery download length mismatch")}
 return c.object(f,want),res.Body,nil
}

// Discover lists only manifest and loss metadata, not bulk data. Complete
// pagination is mandatory; a repeated token, duplicate key/ID, incomplete
// search or bound breach is an error. A returned object is a candidate,
// NOT proof of valid bytes. OpenObject rechecks exact membership.
func(r *RecoveryReader) Discover(ctx context.Context)([]archive.Object,error){
 if r==nil||r.c==nil{return nil,errors.New("recovery client required")}
 c:=r.c
 q:=fmt.Sprintf("trashed = false and mimeType = 'application/json' and appProperties has { key='md_ns' and value='%s' }",c.namespace)
 v:=url.Values{"q":{q},"fields":{"nextPageToken,incompleteSearch,files("+fields+")"},"pageSize":{"100"},"spaces":{"drive"},"corpora":{"user"}}
 seen,ids,tokens:=map[string]bool{},map[string]bool{},map[string]bool{}
 out:=[]archive.Object{}
 for i:=0;i<500;i++{
  var page struct{Next string `json:"nextPageToken"`;Incomplete bool `json:"incompleteSearch"`;Files []file `json:"files"`}
  if e:=c.json(ctx,"GET","/drive/v3/files",v,nil,&page);e!=nil{return nil,e}
  if page.Incomplete||len(page.Files)>100{return nil,errors.New("incomplete or invalid recovery listing")}
  for _,f:=range page.Files{
   if f.Trashed||f.MIME!="application/json"||f.Props["md_ns"]!=c.namespace{return nil,errors.New("foreign recovery listing result")}
   key:=f.Props["md_key"]
   if !validKey(key)||!recoveryKey.MatchString(key)||!strings.HasSuffix(key,".json"){continue}
   n,e:=strconv.ParseInt(f.Size,10,64);h:=f.Props["md_sha256"]
   if e!=nil||n<=0||n>2<<20||!identifier(f.ID)||!digestOK(h)||seen[key]||ids[f.ID]{return nil,errors.New("invalid or duplicate recovery candidate")}
   if f.SHA!=""&&f.SHA!=h{return nil,errors.New("recovery candidate hash mismatch")}
   seen[key],ids[f.ID]=true,true
   out=append(out,archive.Object{ID:f.ID,Key:key,Size:n,SHA256:h})
  }
  if page.Next==""{sort.Slice(out,func(i,j int)bool{return out[i].Key<out[j].Key});return out,nil}
  if tokens[page.Next]||len(page.Next)>4096{return nil,errors.New("invalid recovery page token")}
  tokens[page.Next]=true;v.Set("pageToken",page.Next)
 }
 return nil,errors.New("recovery listing page limit")
}

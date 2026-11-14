package drive

import (
 "context"
 "errors"
 "net/url"
)

// The drive.file grant can create app-owned items in My Drive without
// granting files.get access to the My Drive root itself. Never GET root.
// Use both the global exact app key and root-parent search: a moved or
// duplicate namespace root is a collision, not permission to create another.
func(c *Client) findNamespaceRoot(ctx context.Context)(*file,error){
 global,e:=c.list(ctx,"","root");if e!=nil{return nil,e}
 top,e:=c.list(ctx,"root","root");if e!=nil{return nil,e}
 if global==nil&&top==nil{return nil,nil}
 if global==nil||top==nil||global.ID!=top.ID{return nil,errors.New("Drive namespace root missing from top-level search or duplicated")}
 if !identifier(global.ID)||len(global.Parents)!=1||!identifier(global.Parents[0])||global.Parents[0]==global.ID{return nil,errors.New("invalid Drive namespace root parent")}
 want:=reservation{ID:global.ID,Key:"root",Parent:global.Parents[0],MIME:folderType}
 if e=c.check(*global,want,c.namespace);e!=nil{return nil,e}
 if e=c.check(*top,want,c.namespace);e!=nil{return nil,e}
 direct,e:=c.get(ctx,global.ID);if e!=nil{return nil,e}
 if e=c.check(direct,want,c.namespace);e!=nil{return nil,e}
 return &direct,nil
}

func(c *Client) checkRootReservation(r reservation,f file)error{
 if r.Key!="root"||r.MIME!=folderType||r.Size!=0||r.SHA!=""||len(f.Parents)!=1||!identifier(f.Parents[0])||r.ID!=f.ID{return errors.New("invalid Drive namespace root reservation")}
 // "root" is a durable creation sentinel. Old reservations with the
 // concrete parent ID remain valid only if that exact parent matches.
 if r.Parent!="root"&&r.Parent!=f.Parents[0]{return errors.New("Drive namespace root parent conflict")}
 return c.check(f,reservation{ID:r.ID,Key:"root",Parent:f.Parents[0],MIME:folderType},c.namespace)
}

// Caller holds the client mutex. The reserved ID survives a lost POST
// response; never allocate a second ID or adopt an unverified root.
func(c *Client) ensureNamespaceRoot(ctx context.Context)(string,error){
 r,ok,e:=c.load("root");if e!=nil{return "",e}
 if ok&&(r.MIME!=folderType||r.Size!=0||r.SHA!=""||!identifier(r.Parent)){return "",errors.New("invalid Drive root reservation")}
 f,e:=c.findNamespaceRoot(ctx);if e!=nil{return "",e}
 if f!=nil{
  if !ok{r=reservation{ID:f.ID,Key:"root",Parent:f.Parents[0],MIME:folderType}}
  if e=c.checkRootReservation(r,*f);e!=nil{return "",e}
  if !ok{if e=c.reserve(r);e!=nil{return "",e}}
  return f.ID,nil
 }
 if ok{
  // If the reserved ID exists but search cannot prove its root placement,
  // stop, including when it was moved, trashed, or indexing is delayed.
  if _,e=c.get(ctx,r.ID);e==nil{return "",errors.New("reserved Drive root not visible in exact top-level search")}
  if !status(e,404){return "",e}
  if r.Parent!="root"{return "",errors.New("previously bound Drive root missing")}
 }else{
  id,e:=c.generate(ctx);if e!=nil{return "",e}
  r=reservation{ID:id,Key:"root",Parent:"root",MIME:folderType}
  if e=c.reserve(r);e!=nil{return "",e}
 }
 // Omitting parents is documented to create directly in My Drive. Avoid
 // sending either an inaccessible concrete root ID or a fake parent.
 body:=map[string]any{"id":r.ID,"name":c.namespace,"mimeType":folderType,"appProperties":map[string]string{"md_ns":c.namespace,"md_key":"root"}}
 var created file
 e=c.json(ctx,"POST","/drive/v3/files",url.Values{"fields":{fields}},body,&created)
 if status(e,409){created,e=c.get(ctx,r.ID)}
 if e!=nil{return "",e}
 if e=c.checkRootReservation(r,created);e!=nil{return "",e}
 f,e=c.findNamespaceRoot(ctx);if e!=nil{return "",e}
 if f==nil{return "",errors.New("created Drive root not yet visible; retry with same reservation")}
 if e=c.checkRootReservation(r,*f);e!=nil{return "",e}
 return f.ID,nil
}
func(c *Client) verifyNamespaceRoot(ctx context.Context)(string,error){
 r,ok,e:=c.load("root");if e!=nil||!ok{return "",errors.New("Drive namespace root reservation missing or invalid")}
 f,e:=c.findNamespaceRoot(ctx);if e!=nil{return "",e}
 if f==nil{return "",errors.New("Drive namespace root missing")}
 if e=c.checkRootReservation(r,*f);e!=nil{return "",e}
 return f.ID,nil
}

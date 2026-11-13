package archive

import(
 "bytes"
 "context"
 "crypto/sha256"
 "encoding/hex"
 "encoding/json"
 "errors"
 "io"
 "strings"
)

// ReadRecoveryMetadata verifies the discovered object identity and exact
// content hash, not just Drive metadata. It is bounded independently of
// the much larger snapshot. No write or deletion is permitted here.
func ReadRecoveryMetadata(ctx context.Context,remote RemoteObjects,want Object,limit int64)([]byte,error){
 if remote==nil||!safeID(want.ID)||!validDigest(want.SHA256)||want.Size<=0||want.Size>limit||limit>2<<20{return nil,errors.New("invalid recovery metadata candidate")}
 got,body,e:=remote.OpenObject(ctx,want.ID)
 if e!=nil{closeObject(body);return nil,e}
 if body==nil{return nil,errors.New("missing recovery metadata body")}
 defer body.Close()
 if got!=want{return nil,errors.New("recovery metadata identity changed")}
 b,e:=io.ReadAll(io.LimitReader(body,want.Size+1))
 if e!=nil||int64(len(b))!=want.Size{return nil,errors.New("recovery metadata length mismatch")}
 h:=sha256.Sum256(b)
 if hex.EncodeToString(h[:])!=want.SHA256{return nil,errors.New("recovery metadata hash mismatch")}
 return b,ctx.Err()
}
// ReadRecoveryManifest accepts only the exact canonical manifest bytes
// produced by this contract. It is not proof that the data file exists;
// VerifyPublished must still verify the snapshot before indexing it.
func ReadRecoveryManifest(ctx context.Context,remote RemoteObjects,o Object)(PublishedRecord,bool,error){
 var zero PublishedRecord
 b,e:=ReadRecoveryMetadata(ctx,remote,o,1<<20)
 if e!=nil{return zero,false,e}
 var m Manifest
 if e=json.Unmarshal(b,&m);e!=nil{return zero,false,e}
 canonical,e:=json.Marshal(m)
 if e!=nil||!bytes.Equal(canonical,b){return zero,false,errors.New("noncanonical recovery manifest")}
 active:=strings.HasPrefix(o.Key,"active/")
 r:=PublishedRecord{Manifest:m,ManifestID:o.ID,ManifestSHA256:o.SHA256}
 if e=validateRecord(r,active);e!=nil{return zero,false,e}
 _,key,e:=manifestKeys(m,active)
 if e!=nil||key!=o.Key{return zero,false,errors.New("recovery manifest key mismatch")}
 return r,active,nil
}

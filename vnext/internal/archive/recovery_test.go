package archive
import("bytes";"context";"crypto/sha256";"encoding/hex";"io";"testing")
type recoveryMetaRemote struct{o Object;b []byte}
func(r recoveryMetaRemote)PutImmutable(context.Context,string,int64,string,io.Reader)(Object,error){panic("unexpected write")}
func(r recoveryMetaRemote)OpenObject(context.Context,string)(Object,io.ReadCloser,error){return r.o,io.NopCloser(bytes.NewReader(r.b)),nil}
func TestRecoveryMetadataChecksActualBytes(t *testing.T){
 b:=[]byte("metadata");h:=sha256.Sum256(b)
 o:=Object{ID:"obj1",Key:"catalog/loss/2026-11-13.json",Size:int64(len(b)),SHA256:hex.EncodeToString(h[:])}
 r:=recoveryMetaRemote{o:o,b:b}
 got,e:=ReadRecoveryMetadata(context.Background(),r,o,65536);if e!=nil||!bytes.Equal(got,b){t.Fatal(got,e)}
 r.b=[]byte("modified")
 if _,e=ReadRecoveryMetadata(context.Background(),r,o,65536);e==nil{t.Fatal("corrupt content accepted")}
 r.b=b;r.o.Key="catalog/loss/2026-11-14.json"
 if _,e=ReadRecoveryMetadata(context.Background(),r,o,65536);e==nil{t.Fatal("changed identity accepted")}
}

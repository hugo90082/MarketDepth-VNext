// Offline mixed-day proposal CLI. No publication or production activation.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/mixedday"
)
type sources []string
func(s *sources) String()string{return fmt.Sprint([]string(*s))}
func(s *sources) Set(v string)error{
	if len(*s)>=8{return errors.New("at most eight sources")}
	*s=append(*s,v);return nil
}
func hash(b []byte)string{h:=sha256.Sum256(b);return hex.EncodeToString(h[:])}
func canonical(p string)bool{return filepath.IsAbs(p)&&p!="/"&&filepath.Clean(p)==p}
func read(p,want string,limit int64)([]byte,error){
	if !canonical(p)||limit<=0||len(want)!=64||strings.Trim(want,"0123456789abcdef")!=""{return nil,errors.New("absolute canonical input and exact SHA256 required")}
	real,e:=filepath.EvalSymlinks(p);if e!=nil||real!=p{return nil,errors.New("symlink input refused")}
	st,e:=os.Lstat(p);if e!=nil||!st.Mode().IsRegular()||st.Size()<=0||st.Size()>limit{return nil,errors.New("invalid input size/type")}
	f,e:=os.Open(p);if e!=nil{return nil,e};defer f.Close()
	s,e:=f.Stat();if e!=nil||!os.SameFile(st,s){return nil,errors.New("input changed")}
	b,e:=io.ReadAll(io.LimitReader(f,limit+1))
	if e!=nil||int64(len(b))!=st.Size()||hash(b)!=want{return nil,errors.New("input digest or length mismatch")}
	last,e:=os.Lstat(p);if e!=nil||!os.SameFile(st,last)||last.Size()!=st.Size()||last.ModTime()!=st.ModTime(){return nil,errors.New("input changed")}
	return b,nil
}
func write(p string,b []byte)error{
	f,e:=os.OpenFile(p,os.O_WRONLY|os.O_CREATE|os.O_EXCL,0600);if e!=nil{return e}
	n,e:=f.Write(b);if e==nil&&n!=len(b){e=io.ErrShortWrite}
	if e==nil{e=f.Sync()}
	ce:=f.Close();if e!=nil{return e};return ce
}
func syncDir(p string)error{f,e:=os.Open(p);if e!=nil{return e};defer f.Close();return f.Sync()}
func run(args []string,out io.Writer)error{
	fs:=flag.NewFlagSet("mixed-day-plan",flag.ContinueOnError)
	var req mixedday.Request
	var specs sources
	var placement,root string
	fs.StringVar(&req.Day,"day","","UTC+8 mixed day")
	fs.Int64Var(&req.CutoverMS,"cutover-ms",0,"reviewed minute-aligned cutover")
	fs.StringVar(&req.LegacySHA256,"legacy-sha256","","authoritative legacy day JSONL digest")
	fs.StringVar(&req.LiveSHA256,"live-sha256","","authoritative live day JSONL digest")
	fs.StringVar(&req.PlacementSHA256,"placement-sha256","","independent reviewed placement file digest")
	fs.StringVar(&placement,"placement","","reviewed placement file (digest binding only)")
	fs.StringVar(&root,"output","","new private offline output directory")
	fs.Var(&specs,"source","role:sha256:/absolute/path (repeat)")
	if e:=fs.Parse(args);e!=nil{return e}
	if fs.NArg()!=0||!canonical(root)||len(specs)<2{return errors.New("explicit output and source inputs required")}
	parent:=filepath.Dir(root)
	real,e:=filepath.EvalSymlinks(parent);if e!=nil||real!=parent{return errors.New("canonical existing output parent required")}
	if _,e=os.Lstat(root);!errors.Is(e,os.ErrNotExist){return errors.New("output must not exist")}
	if _,e=read(placement,req.PlacementSHA256,16<<20);e!=nil{return e}
	ins:=make([]mixedday.Input,0,len(specs));remaining:=int64(128<<20)
	for _,spec:=range specs{
		p:=strings.SplitN(spec,":",3)
		if len(p)!=3||(p[0]!=mixedday.Legacy&&p[0]!=mixedday.Live){return errors.New("invalid source specification")}
		limit:=remaining;if limit>64<<20{limit=64<<20}
		b,e:=read(p[2],p[1],limit);if e!=nil{return e};remaining-=int64(len(b))
		ins=append(ins,mixedday.Input{Role:p[0],SHA256:p[1],JSONL:b})
	}
	r,selected,e:=mixedday.Plan(req,ins);if e!=nil{return e}
	report,e:=json.Marshal(r);if e!=nil{return e};report=append(report,'\n')
	// No write until all input checks and planning succeed. Fresh root, exclusive
	// files; no overwrite/removal even after interruption.
	if e=os.Mkdir(root,0700);e!=nil{return e}
	rowPath:=filepath.Join(root,"selected.jsonl")
	// An empty selected stream is valid as an all-gap proposal, not a day archive.
	if e=write(rowPath,selected);e!=nil{return e}
	check,e:=os.ReadFile(rowPath);if e!=nil||!bytes.Equal(check,selected){return errors.New("selected readback differs")}
	reportPath:=filepath.Join(root,"report.json")
	if e=write(reportPath,report);e!=nil{return e}
	check,e=os.ReadFile(reportPath);if e!=nil||!bytes.Equal(check,report){return errors.New("report readback differs")}
	if e=syncDir(root);e!=nil{return e};if e=syncDir(parent);e!=nil{return e}
	return json.NewEncoder(out).Encode(map[string]any{"status":"offline_proposal_only","report_sha256":hash(report),"selected_jsonl_sha256":r.SelectedJSONLSHA256,"publication_approved":false,"production_ready":false,"counts":r.Counts})
}
func main(){if e:=run(os.Args[1:],os.Stdout);e!=nil{log.Fatal(e)}}

package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/mixedday"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func TestOfflineCLI(t *testing.T){
	base:=t.TempDir()
	day:=time.Date(2026,11,15,0,0,0,0,time.FixedZone("UTC+8",8*3600))
	from:=day.UnixMilli()
	cut:=from+60000
	l:=model.SpotRow{Common:model.Common{T:from,Asset:"BTC",Status:"legacy_unknown",Source:model.Ptr("legacy:v66-browser-jsonl-v1"),Quality:model.Ptr("{}"),Revision:1},Venue:"binance"}
	v:=model.SpotRow{Common:model.Common{T:cut,Asset:"BTC",Status:"partial",Source:model.Ptr(model.LiveSource),AvailableAt:model.Ptr(cut+1000),Revision:1},Venue:"binance"}
	put:=func(name string,b []byte)(string,string){
		p:=filepath.Join(base,name)
		if e:=os.WriteFile(p,b,0600);e!=nil{t.Fatal(e)}
		return p,hash(b)
	}
	line:=func(r model.Row)[]byte{
		b,e:=json.Marshal(r);if e!=nil{t.Fatal(e)}
		b,e=json.Marshal(mixedday.Envelope{Kind:r.Kind(),Row:b});if e!=nil{t.Fatal(e)}
		return append(b,'\n')
	}
	lp,lh:=put("old.jsonl",line(l));vp,vh:=put("new.jsonl",line(v))
	pp,ph:=put("placement.json",[]byte("{\"synthetic\":true}\n"))
	root:=filepath.Join(base,"out")
	args:=[]string{"--day","2026-11-15","--cutover-ms",strconv.FormatInt(cut,10),"--legacy-sha256",lh,"--live-sha256",vh,"--placement",pp,"--placement-sha256",ph,"--output",root,"--source","legacy:"+lh+":"+lp,"--source","live:"+vh+":"+vp}
	var out bytes.Buffer
	if e:=run(args,&out);e!=nil{t.Fatal(e)}
	var result struct{Status string;ReportSHA string `json:"report_sha256"`;Publication bool `json:"publication_approved"`}
	if e:=json.Unmarshal(out.Bytes(),&result);e!=nil||result.Status!="offline_proposal_only"||result.Publication{t.Fatal("invalid output",e)}
	rb,e:=os.ReadFile(filepath.Join(root,"report.json"));if e!=nil||hash(rb)!=result.ReportSHA{t.Fatal("bad report hash")}
	var report mixedday.Report
	if e=json.Unmarshal(rb,&report);e!=nil||report.Counts[model.Spot].Selected!=2||report.ProductionReady{t.Fatal("bad report",e)}
	sb,e:=os.ReadFile(filepath.Join(root,"selected.jsonl"));if e!=nil||!bytes.Equal(sb,append(line(l),line(v)...)){t.Fatal("selected bytes differ")}
	if e=run(args,&out);e==nil{t.Fatal("overwrote output")}
	bad:=append([]string(nil),args...)
	badRoot:=filepath.Join(base,"bad")
	for i,x:=range bad{
		if x=="--output"{bad[i+1]=badRoot}
		if x=="--placement-sha256"{bad[i+1]=hash([]byte("wrong"))}
	}
	if e=run(bad,&out);e==nil{t.Fatal("invalid placement accepted")}
	if _,e=os.Stat(badRoot);!os.IsNotExist(e){t.Fatal("failed input created output")}
}

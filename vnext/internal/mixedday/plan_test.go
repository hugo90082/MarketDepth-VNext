package mixedday

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

func common(t int64, role string) model.Common {
	if role==Legacy {
		return model.Common{T:t,Asset:"BTC",Status:"legacy_unknown",Source:model.Ptr("legacy:v66-browser-jsonl-v1"),Quality:model.Ptr("{}"),Revision:1}
	}
	return model.Common{T:t,Asset:"BTC",Status:"partial",Source:model.Ptr(model.LiveSource),AvailableAt:model.Ptr(t+60000),Revision:1}
}
func spot(t int64, role string, value float64) model.SpotRow {
	return model.SpotRow{Common:common(t,role),Venue:"binance",Bid0100:model.Ptr(value)}
}
func input(t *testing.T, role string, rows ...model.Row) Input {
	t.Helper()
	var b bytes.Buffer
	for _,r:=range rows {
		raw,e:=json.Marshal(r);if e!=nil {t.Fatal(e)}
		line,e:=json.Marshal(Envelope{r.Kind(),raw});if e!=nil {t.Fatal(e)}
		b.Write(line);b.WriteByte('\n')
	}
	return Input{Role:role,SHA256:digest(b.Bytes()),JSONL:b.Bytes()}
}
func fixture(t *testing.T)(Request,[]Input,int64) {
	t.Helper()
	from,_,e:=dayBounds("2026-11-15");if e!=nil {t.Fatal(e)}
	cut:=from+120000
	missing:=spot(cut+60000,Live,0)
	missing.Status="missing";missing.Bid0100=nil
	a:=input(t,Legacy,spot(from,Legacy,0),spot(cut,Legacy,10),spot(cut+120000,Legacy,40))
	b:=input(t,Live,spot(from,Live,30),spot(cut,Live,20),missing,model.Futures10Row{Common:common(from,Live)},model.Futures10Row{Common:common(cut,Live)})
	alt:=input(t,Legacy,spot(from,Legacy,99),spot(from+60000,Legacy,99))
	return Request{"2026-11-15",cut,a.SHA256,b.SHA256,digest([]byte("synthetic placement"))},[]Input{a,b,alt},from
}
func TestPlanBoundaryAndNoFallback(t *testing.T){
	req,ins,from:=fixture(t)
	r,b,e:=Plan(req,ins);if e!=nil {t.Fatal(e)}
	if r.ProductionReady||r.PublicationApproved||len(r.Decisions)!=47520||digest(b)!=r.SelectedJSONLSHA256 {t.Fatal("invalid report")}
	s:=r.Counts[model.Spot];if s.Expected!=17280||s.Selected!=3||s.Absent!=17277||s.MissingStatus!=1||s.LegacyUnknown!=1||s.DifferingKeys!=2 {t.Fatalf("spot counts: %+v",s)}
	f:=r.Counts[model.F10];if f.Expected!=25884||f.Unsupported!=36||f.Selected!=1||f.ExcludedOccurrences!=1 {t.Fatalf("F10 counts: %+v",f)}
	for _,d:=range r.Decisions{
		if d.Key.Kind!=model.Spot||d.Key.Venue!="binance"||d.Key.Asset!="BTC"{continue}
		switch d.Key.T{
		case from:
			if d.SelectedSourceSHA256!=req.LegacySHA256||len(d.Evidence)!=3||!d.DifferingEvidence {t.Fatal("wrong pre-cutover choice")}
		case from+60000,req.CutoverMS+120000:
			if d.State!="absent"||len(d.Evidence)!=1||d.SelectedSourceSHA256!="" {t.Fatal("fallback occurred")}
		case req.CutoverMS:
			if d.SelectedSourceSHA256!=req.LiveSHA256||len(d.Evidence)!=2 {t.Fatal("wrong cutover choice")}
		case req.CutoverMS+60000:
			if d.State!="selected_missing_status"{t.Fatal("placeholder not accounted")}
		}
	}
	// Deterministic regardless of source input ordering.
	rr,bb,e:=Plan(req,[]Input{ins[2],ins[1],ins[0]})
	if e!=nil||!reflect.DeepEqual(r,rr)||!bytes.Equal(b,bb){t.Fatal("non-deterministic plan")}
}
func TestPlanRejectsBadEvidence(t *testing.T){
	req,ins,from:=fixture(t)
	for _,mut:=range []func(*Request,[]Input){
		func(r *Request,i []Input){r.CutoverMS++},
		func(r *Request,i []Input){r.CutoverMS=from},
		func(r *Request,i []Input){r.PlacementSHA256="" },
		func(r *Request,i []Input){r.LiveSHA256=r.LegacySHA256},
		func(r *Request,i []Input){i[0].SHA256=digest([]byte("wrong"))},
		func(r *Request,i []Input){i[0].Role=Live},
		func(r *Request,i []Input){i[2]=i[0]},
		func(r *Request,i []Input){i[2]=input(t,Legacy,spot(from,Legacy,1),spot(from,Legacy,2))},
		func(r *Request,i []Input){i[2]=input(t,Legacy,spot(from-60000,Legacy,1))},
		func(r *Request,i []Input){x:=spot(from,Legacy,1);x.AvailableAt=model.Ptr(from);i[2]=input(t,Legacy,x)},
		func(r *Request,i []Input){x:=spot(from,Legacy,1);x.TrustedBid=model.Ptr(750.0);i[2]=input(t,Legacy,x)},
		func(r *Request,i []Input){i[2]=input(t,Legacy,model.Futures10Row{Common:common(from,Legacy)})},
		func(r *Request,i []Input){i[2].JSONL=bytes.Replace(i[2].JSONL,[]byte("\"revision\":1"),[]byte("\"revision\":1,\"revision\":1"),1);i[2].SHA256=digest(i[2].JSONL)},
		func(r *Request,i []Input){i[2].JSONL=bytes.TrimSuffix(i[2].JSONL,[]byte("\n"));i[2].SHA256=digest(i[2].JSONL)},
	}{
		r:=req;i:=append([]Input(nil),ins...);mut(&r,i)
		if _,_,e:=Plan(r,i);e==nil {t.Fatal("bad input accepted")}
	}
}

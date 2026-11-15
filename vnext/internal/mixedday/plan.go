// Package mixedday plans a single mixed UTC+8 day offline. It cannot publish,
// modify SQLite, authorize cutover, or treat QA data as production evidence.
package mixedday

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

const (
	Legacy = "legacy"
	Live = "live"
	maxSource = 64 << 20
	maxLine = 1 << 20
	maxSources = 8
)

// Input is one independently reviewed day export in canonical Go JSONL format:
// {"kind":"spot_depth","row":{...}} followed by LF. Its digest binds exact
// bytes, not the authenticity of the external source or placement report.
type Input struct {
	Role string
	SHA256 string
	JSONL []byte
}
type Request struct {
	Day string
	CutoverMS int64
	LegacySHA256 string
	LiveSHA256 string
	PlacementSHA256 string
}
type RowKey struct {
	Kind model.Kind `json:"kind"`
	model.Key
}
type Envelope struct {
	Kind model.Kind `json:"kind"`
	Row json.RawMessage `json:"row"`
}
type Evidence struct {
	SourceSHA256 string `json:"source_sha256"`
	Role string `json:"role"`
	RowSHA256 string `json:"row_sha256"`
	Status string `json:"status"`
	Selected bool `json:"selected"`
}
type Decision struct {
	Key RowKey `json:"key"`
	RequiredRole string `json:"required_role"`
	SelectedSourceSHA256 string `json:"selected_source_sha256,omitempty"`
	SelectedRowSHA256 string `json:"selected_row_sha256,omitempty"`
	State string `json:"state"`
	DifferingEvidence bool `json:"differing_evidence"`
	Evidence []Evidence `json:"evidence"`
}
type Counts struct {
	Expected int `json:"expected"`
	Selected int `json:"selected"`
	Absent int `json:"absent"`
	MissingStatus int `json:"missing_status"`
	LegacyUnknown int `json:"legacy_unknown"`
	Unsupported int `json:"unsupported"`
	ExcludedOccurrences int `json:"excluded_occurrences"`
	DifferingKeys int `json:"differing_keys"`
}
type Report struct {
	Contract string `json:"contract"`
	Day string `json:"day"`
	CutoverMS int64 `json:"cutover_ms"`
	LegacySHA256 string `json:"legacy_sha256"`
	LiveSHA256 string `json:"live_sha256"`
	PlacementSHA256 string `json:"placement_sha256"`
	PublicationApproved bool `json:"publication_approved"`
	ProductionReady bool `json:"production_ready"`
	SelectedJSONLSHA256 string `json:"selected_jsonl_sha256"`
	Counts map[model.Kind]Counts `json:"counts"`
	Decisions []Decision `json:"decisions"`
}
type occurrence struct {
	e Evidence
	line []byte
}
func digest(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func validHash(h string) bool {
	return len(h)==64 && strings.Trim(h,"0123456789abcdef")==""
}
func dayBounds(day string) (int64,int64,error) {
	d,e:=time.ParseInLocation("2006-01-02",day,time.FixedZone("UTC+8",8*3600))
	if e!=nil || d.Format("2006-01-02")!=day || d.UnixMilli()<0 {
		return 0,0,errors.New("invalid day")
	}
	return d.UnixMilli(),d.Add(24*time.Hour).UnixMilli(),nil
}
func decode(line []byte, role string, from,to int64) (RowKey, occurrence,error) {
	var key RowKey
	var out occurrence
	var env Envelope
	if e:=json.Unmarshal(line,&env); e!=nil || !env.Kind.Valid() {
		return key,out,errors.New("invalid envelope")
	}
	r,e:=model.Decode(env.Kind,env.Row)
	if e!=nil {return key,out,e}
	// Exact canonical bytes reject omitted/unknown/duplicate fields, alternate
	// numeric encodings and noncanonical envelopes, preserving integer IDs.
	raw,e:=json.Marshal(r)
	if e!=nil {return key,out,e}
	canonical,e:=json.Marshal(Envelope{env.Kind,raw})
	if e!=nil || !bytes.Equal(line,canonical) {
		return key,out,errors.New("noncanonical row or envelope")
	}
	c:=r.Base()
	if c.T<from || c.T>=to || c.Source==nil {
		return key,out,errors.New("row outside day or source missing")
	}
	switch role {
	case Legacy:
		if env.Kind==model.F10 || *c.Source!="legacy:v66-browser-jsonl-v1" || c.Status!="legacy_unknown" || c.AvailableAt!=nil || c.Revision!=1 || c.Quality==nil {
			return key,out,errors.New("legacy provenance or availability violation")
		}
		if s,ok:=r.(*model.SpotRow);ok {
			if s.ObservedBid!=nil || s.ObservedAsk!=nil || s.TrustedBid!=nil || s.TrustedAsk!=nil {
				return key,out,errors.New("legacy coverage promoted")
			}
		}
	case Live:
		if *c.Source!=model.LiveSource || c.AvailableAt==nil || c.Status=="legacy_unknown" {
			return key,out,errors.New("live provenance required")
		}
	default:
		return key,out,errors.New("invalid role")
	}
	return RowKey{env.Kind,r.Key()},occurrence{e:Evidence{Role:role,RowSHA256:digest(raw),Status:c.Status},line:canonical},nil
}

// Plan requires exactly one explicitly selected input hash per side. Other
// inputs are evidence only; no fallback, field merge, or latest-wins heuristic.
// The caller must independently review placement, source hashes and conflicts.
// Rows are unchanged; archive revision is deliberately NOT assigned here.
func Plan(req Request, inputs []Input) (Report,[]byte,error) {
	var zero Report
	from,to,e:=dayBounds(req.Day)
	if e!=nil || req.CutoverMS<=from || req.CutoverMS>=to || req.CutoverMS%60000!=0 ||
		!validHash(req.LegacySHA256) || !validHash(req.LiveSHA256) || req.LegacySHA256==req.LiveSHA256 ||
		!validHash(req.PlacementSHA256) || len(inputs)<2 || len(inputs)>maxSources {
		return zero,nil,errors.New("explicit mixed day, minute-aligned cutover and source/placement digests required")
	}
	byKey:=map[RowKey][]occurrence{}
	seen:=map[string]string{}
	totalBytes:=0
	for _,in:=range inputs {
		totalBytes+=len(in.JSONL)
		if len(in.JSONL)==0 || len(in.JSONL)>maxSource || totalBytes>maxSource*2 ||
			!validHash(in.SHA256) || digest(in.JSONL)!=in.SHA256 ||
			seen[in.SHA256]!="" || (in.Role!=Legacy && in.Role!=Live) ||
			bytes.ContainsRune(in.JSONL,'\r') || in.JSONL[len(in.JSONL)-1]!='\n' {
			return zero,nil,errors.New("invalid, duplicate, oversized or incomplete source")
		}
		seen[in.SHA256]=in.Role
		perSource:=map[RowKey]bool{}
		sc:=bufio.NewScanner(bytes.NewReader(in.JSONL))
		sc.Buffer(make([]byte,4096),maxLine)
		for sc.Scan() {
			k,o,e:=decode(sc.Bytes(),in.Role,from,to)
			if e!=nil {return zero,nil,e}
			if perSource[k] || len(perSource)>=47520 {
				return zero,nil,errors.New("duplicate key inside source; explicit revision review required")
			}
			perSource[k]=true
			o.e.SourceSHA256=in.SHA256
			byKey[k]=append(byKey[k],o)
		}
		if e=sc.Err();e!=nil {return zero,nil,e}
	}
	if seen[req.LegacySHA256]!=Legacy || seen[req.LiveSHA256]!=Live {
		return zero,nil,errors.New("authoritative inputs missing or wrong role")
	}
	report:=Report{Contract:"MD-MIXED-DAY-PLAN-1",Day:req.Day,CutoverMS:req.CutoverMS,
		LegacySHA256:req.LegacySHA256,LiveSHA256:req.LiveSHA256,PlacementSHA256:req.PlacementSHA256,
		Counts:map[model.Kind]Counts{},Decisions:make([]Decision,0,47520)}
	var selected bytes.Buffer
	assets:=[]string{"BTC","ETH","SOL"}
	venues:=[]string{"binance","bitfinex","coinbase","kraken"}
	for _,kind:=range []model.Kind{model.Spot,model.F10,model.F1} {
		count:=Counts{}
		for t:=from;t<to;t+=kind.Interval() {
			vv:=[]string{""}
			if kind==model.Spot {vv=venues}
			for _,v:=range vv {for _,asset:=range assets {
				k:=RowKey{kind,model.Key{T:t,Venue:v,Asset:asset}}
				rows:=byKey[k]
				delete(byKey,k)
				sort.Slice(rows,func(i,j int)bool{return rows[i].e.SourceSHA256<rows[j].e.SourceSHA256})
				d:=Decision{Key:k,Evidence:[]Evidence{}}
				want:=req.LiveSHA256
				d.RequiredRole=Live
				if t<req.CutoverMS {want=req.LegacySHA256;d.RequiredRole=Legacy}
				if kind==model.F10 && t<req.CutoverMS {
					want="";d.RequiredRole="unsupported_legacy";d.State="unsupported";count.Unsupported++
				}else{
					count.Expected++;d.State="absent"
				}
				first:=""
				for _,o:=range rows{
					ev:=o.e
					if first=="" {first=ev.RowSHA256} else if first!=ev.RowSHA256 {d.DifferingEvidence=true}
					if ev.SourceSHA256==want {
						ev.Selected=true
						d.SelectedSourceSHA256=ev.SourceSHA256;d.SelectedRowSHA256=ev.RowSHA256
						d.State="selected"
						count.Selected++
						if ev.Status=="missing" {d.State="selected_missing_status";count.MissingStatus++}
						if ev.Status=="legacy_unknown" {d.State="selected_legacy_unknown";count.LegacyUnknown++}
						selected.Write(o.line);selected.WriteByte('\n')
					}else{count.ExcludedOccurrences++}
					d.Evidence=append(d.Evidence,ev)
				}
				if d.State=="absent" {count.Absent++}
				if d.DifferingEvidence {count.DifferingKeys++}
				report.Decisions=append(report.Decisions,d)
			}}
		}
		if count.Selected+count.Absent!=count.Expected {
			return zero,nil,fmt.Errorf("grid accounting failed for %s",kind)
		}
		report.Counts[kind]=count
	}
	if len(byKey)!=0 {return zero,nil,errors.New("unexpected keys outside grid")}
	report.SelectedJSONLSHA256=digest(selected.Bytes())
	return report,selected.Bytes(),nil
}

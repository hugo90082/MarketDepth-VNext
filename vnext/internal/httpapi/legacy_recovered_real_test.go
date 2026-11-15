//go:build linux && sqlite_integration && secure_auth

package httpapi

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
	"golang.org/x/crypto/bcrypt"
)

// Explicit opt-in only. The real source stays offline, never in CI or git.
func TestRealRecoveredLegacyAPI(t *testing.T) {
	root, want := os.Getenv("MD_RECOVERED_QA_CANDIDATE_ROOT"), os.Getenv("MD_RECOVERED_QA_MANIFEST_SHA256")
	if root == "" {
		t.Skip("offline real-source QA only")
	}
	if len(want) != 64 {
		t.Fatal("manifest hash required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	stage := os.Getenv("MD_RECOVERED_QA_STAGE")
	if stage == "" {
		t.Fatal("synthetic prepared stage required")
	}
	// Reconstruct exact mock objects from prior successful immutable progress;
	// no PUT path exists in this test and no credentials are accepted.
	planBytes, e := os.ReadFile(filepath.Join(stage, "plan.json"))
	if e != nil {
		t.Fatal(e)
	}
	if qaSHA(planBytes) != "75918607114f70736d751d9763f6beb2e53001d4f11a94e5d9eab09fb746d788" {
		t.Fatal("unexpected plan")
	}
	var plan struct {
		Days []struct {
			Day      string
			Manifest archive.Manifest
		}
		HeldDays            []string `json:"held_days"`
		PublicationApproved bool     `json:"publication_approved"`
	}
	if e = json.Unmarshal(planBytes, &plan); e != nil || len(plan.Days) != 55 || plan.PublicationApproved || len(plan.HeldDays) != 2 {
		t.Fatal("invalid synthetic plan", e)
	}
	remote := &recoveryQAObjects{objects: map[string]qaObject{}}
	candidates := []archive.Object{}
	records := map[string]archive.PublishedRecord{}
	for _, d := range plan.Days {
		raw, e := os.ReadFile(filepath.Join(stage, "progress", d.Day+".json"))
		if e != nil {
			t.Fatal(e)
		}
		var r archive.PublishedRecord
		if e = json.Unmarshal(raw, &r); e != nil || archive.ValidateRecord(r) != nil || r.Manifest.Day != d.Day {
			t.Fatal("invalid progress", d.Day, e)
		}
		expected := d.Manifest
		expected.FileID = r.Manifest.FileID
		x, _ := json.Marshal(expected)
		y, _ := json.Marshal(r.Manifest)
		if !bytes.Equal(x, y) || qaSHA(y) != r.ManifestSHA256 {
			t.Fatal("progress/plan mismatch", d.Day)
		}
		path := filepath.Join(stage, "prepared", d.Day, d.Day+".legacy-r1.sqlite.gz")
		f, e := os.Open(path)
		if e != nil {
			t.Fatal(e)
		}
		h := sha256.New()
		n, e := io.Copy(h, f)
		f.Close()
		if e != nil || n != r.Manifest.Size || hex.EncodeToString(h.Sum(nil)) != r.Manifest.SHA256 {
			t.Fatal("prepared bytes mismatch", d.Day, e)
		}
		base := "historical/" + d.Day[:4] + "/" + d.Day[5:7] + "/" + d.Day + ".r1"
		data := archive.Object{ID: r.Manifest.FileID, Key: base + ".sqlite.gz", SHA256: r.Manifest.SHA256, Size: r.Manifest.Size}
		meta := archive.Object{ID: r.ManifestID, Key: base + ".manifest.json", SHA256: r.ManifestSHA256, Size: int64(len(y))}
		for _, o := range []qaObject{{meta, "", y}, {data, path, nil}} {
			if _, ok := remote.objects[o.obj.ID]; ok {
				t.Fatal("duplicate id")
			}
			remote.objects[o.obj.ID] = o
		}
		records[d.Day] = r
		candidates = append(candidates, meta)
	}
	if len(remote.objects) != 110 {
		t.Fatal("object count")
	}
	reserve := func(context.Context, int64) (func(), error) { return func() {}, nil }
	dataRoot := filepath.Join(t.TempDir(), "recovered")
	manager, e := store.NewManager(dataRoot, store.SQLiteOpener)
	if e != nil {
		t.Fatal(e)
	}
	journal, e := manager.OpenCatalog(ctx)
	if e != nil {
		manager.Close()
		t.Fatal(e)
	}
	startRecovery := time.Now()
	result, e := journal.RebuildVerifiedCatalog(ctx, remote, candidates, reserve)
	if e != nil || result.SealedDays != 55 || result.SealedRevisions != 55 || result.SnapshotOnlyDays != 0 || result.FullLossDays != 0 || result.PartialLossDays != 0 {
		t.Fatal("recovery", result, e)
	}
	if e = journal.Close(); e != nil {
		t.Fatal(e)
	}
	if e = manager.Close(); e != nil {
		t.Fatal(e)
	}
	manager, e = store.NewManager(dataRoot, store.SQLiteOpener)
	if e != nil {
		t.Fatal(e)
	}
	defer manager.Close()
	journal, e = manager.OpenCatalog(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer journal.Close()
	if ok, e := journal.RecoveryCompleted(ctx); e != nil || !ok {
		t.Fatal("incomplete recovery", e)
	}
	for _, d := range plan.Days {
		if journal.CanCollectDay(ctx, d.Day) == nil {
			t.Fatal("sealed day writable", d.Day)
		}
	}
	cache, e := store.NewArchiveReadCache(manager, remote, reserve)
	if e != nil {
		t.Fatal(e)
	}
	r, e := store.NewArchiveReader(journal, cache)
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("RECOVERY_PASS days=55 objects=110 GET=%d elapsed=%s", remote.gets, time.Since(startRecovery))
	b, e := os.ReadFile(filepath.Join(root, "manifest.json"))
	if e != nil {
		t.Fatal(e)
	}
	var m struct {
		Unique int `json:"unique_keys"`
		Ledger struct{ Name, SHA256 string }
		Files  []struct {
			Day    string
			Counts map[string]int
		}
	}
	if qaSHA(b) != want {
		t.Fatal("candidate manifest hash mismatch")
	}
	if e = json.Unmarshal(b, &m); e != nil {
		t.Fatal(e)
	}
	if m.Ledger.Name != "candidate-ledger.sqlite" || len(m.Ledger.SHA256) != 64 {
		t.Fatal("bad ledger reference")
	}
	lp := filepath.Join(root, m.Ledger.Name)
	f, e := os.Open(lp)
	if e != nil {
		t.Fatal(e)
	}
	h := sha256.New()
	_, e = io.Copy(h, f)
	f.Close()
	if e != nil || hex.EncodeToString(h.Sum(nil)) != m.Ledger.SHA256 {
		t.Fatal("ledger hash mismatch")
	}
	u := url.URL{Scheme: "file", Path: lp, RawQuery: "mode=ro&_query_only=1"}
	ledger, e := sql.Open("sqlite3", u.String())
	if e != nil {
		t.Fatal(e)
	}
	defer ledger.Close()
	ledger.SetMaxOpenConns(1)
	if len(m.Files) != 57 || m.Unique != 1065393 {
		t.Fatal("candidate input differs")
	}
	m.Files = m.Files[:55]
	m.Unique = 1042893
	pass := []byte("isolated-test-only")
	hash, e := bcrypt.GenerateFromPassword(pass, 10)
	if e != nil {
		t.Fatal(e)
	}
	a, e := NewBcryptAuth("https://candidate.invalid", bytes.Repeat([]byte{7}, 32), hash)
	if e != nil {
		t.Fatal(e)
	}
	srv := httptest.NewTLSServer(API{Reader: r, Live: true, Auth: a}.Handler())
	defer srv.Close()
	c := srv.Client()
	c.Timeout = 125 * time.Second
	jar, _ := cookiejar.New(nil)
	c.Jar = jar
	request := func(method, path, body, origin string, want int) *http.Response {
		t.Helper()
		q, e := http.NewRequestWithContext(ctx, method, srv.URL+path, strings.NewReader(body))
		if e != nil {
			t.Fatal(e)
		}
		if origin != "" {
			q.Header.Set("Origin", origin)
		}
		if body != "" {
			q.Header.Set("Content-Type", "application/json")
		}
		resp, e := c.Do(q)
		if e != nil {
			t.Fatal(e)
		}
		if resp.StatusCode != want {
			b, _ := io.ReadAll(io.LimitReader(resp.Body, 1000))
			resp.Body.Close()
			t.Fatalf("%s %d want %d: %s", path, resp.StatusCode, want, b)
		}
		if resp.Header.Get("X-MarketDepth-Mode") != "live-local" || resp.Header.Get("Cache-Control") != "no-store" {
			t.Fatal("candidate mode/cache missing")
		}
		return resp
	}
	get := func(path string, want int) map[string]json.RawMessage {
		t.Helper()
		z := request("GET", path, "", "", want)
		defer z.Body.Close()
		var o map[string]json.RawMessage
		if e := json.NewDecoder(z.Body).Decode(&o); e != nil {
			t.Fatal(e)
		}
		if want == 200 {
			var meta map[string]any
			if json.Unmarshal(o["meta"], &meta) != nil || meta["mock"] != false {
				t.Fatal("invalid candidate metadata")
			}
		}
		return o
	}
	closeResp := func(resp *http.Response) { io.Copy(io.Discard, resp.Body); resp.Body.Close() }
	get("/api/v2/meta", 401)
	closeResp(request("POST", "/api/v2/auth/login", `{"password":"isolated-test-only"}`, "https://wrong.invalid", 403))
	login := request("POST", "/api/v2/auth/login", `{"password":"isolated-test-only"}`, a.origin, 200)
	cs := login.Cookies()
	if len(cs) != 1 || !cs[0].Secure || !cs[0].HttpOnly || cs[0].Name != "__Host-md_session" {
		t.Fatal("cookie flags")
	}
	closeResp(login)
	get("/api/v2/meta", 200)
	get("/api/v2/health", 200)
	closeResp(request("GET", "/api/v2/meta", "", "https://wrong.invalid", 403))
	get("/api/v2/history?kind=bad", 400)
	oSync := get("/api/v2/sync?kind=spot_depth", 200)
	var syncRows []json.RawMessage
	var sm struct{ Gaps []store.Gap }
	if json.Unmarshal(oSync["data"], &syncRows) != nil || len(syncRows) != 0 || json.Unmarshal(oSync["meta"], &sm) != nil || len(sm.Gaps) == 0 || sm.Gaps[0].Reason != "sealed_history_query_history" {
		t.Fatal("sync fabricated live rows or missing sealed gap")
	}
	dayMS := func(s string) int64 {
		v, e := time.ParseInLocation("2006-01-02", s, time.FixedZone("UTC+8", 28800))
		if e != nil {
			t.Fatal(e)
		}
		return v.UnixMilli()
	}
	o := get("/api/v2/days?from="+m.Files[0].Day+"&to="+m.Files[len(m.Files)-1].Day, 200)
	var days []store.Day
	if e = json.Unmarshal(o["data"], &days); e != nil || len(days) != len(m.Files) {
		t.Fatal("days", e)
	}
	for i, d := range days {
		if d.Day != m.Files[i].Day || d.State != "sealed_remote" || d.SHA256 == nil || d.ETag == nil || *d.SHA256 != records[d.Day].Manifest.SHA256 || *d.ETag != records[d.Day].ManifestSHA256 || d.Counts[model.Spot] != m.Files[i].Counts["spot_depth"] || d.Counts[model.F1] != m.Files[i].Counts["futures_1m"] || d.Counts[model.F10] != 0 {
			t.Fatal("day counts", d)
		}
	}
	o = get("/api/v2/latest", 200)
	var latest map[string][]json.RawMessage
	if e = json.Unmarshal(o["data"], &latest); e != nil || len(latest["spot_depth"]) != 0 || len(latest["futures_1m"]) != 0 || len(latest["futures_10s"]) != 0 {
		t.Fatal("latest", e)
	}
	// Filtered keyset pagination across midnight, compared to independent ledger.
	from, to := dayMS("2026-11-13")-5*60000, dayMS("2026-11-13")+5*60000
	path := fmt.Sprintf("/api/v2/history?kind=spot_depth&from=%d&to=%d&asset=BTC&venue=binance&limit=3", from, to)
	refs, e := ledger.QueryContext(ctx, "SELECT row_json FROM provenance WHERE kind='spot_depth' AND t>=? AND t<? AND asset='BTC' AND venue='binance' ORDER BY t,venue,asset", from, to)
	if e != nil {
		t.Fatal(e)
	}
	n := 0
	cur := ""
	for {
		q := path
		if cur != "" {
			q += "&cursor=" + url.QueryEscape(cur)
		}
		o = get(q, 200)
		var rows []json.RawMessage
		var meta struct {
			Next     *string `json:"next_cursor"`
			Complete bool
			Gaps     []store.Gap
		}
		if json.Unmarshal(o["data"], &rows) != nil || json.Unmarshal(o["meta"], &meta) != nil {
			t.Fatal("page decode")
		}
		for _, row := range rows {
			var ref []byte
			if !refs.Next() || refs.Scan(&ref) != nil || !bytes.Equal(row, ref) {
				t.Fatal("cross-day page differs")
			}
			n++
		}
		if meta.Next == nil {
			if !meta.Complete {
				t.Fatal("incomplete last page")
			}
			break
		}
		if meta.Complete || len(rows) != 3 {
			t.Fatal("bad continuation")
		}
		if cur == "" {
			get(strings.Replace(path, "asset=BTC", "asset=ETH", 1)+"&cursor="+url.QueryEscape(*meta.Next), 409)
			get(path+"&cursor=bad", 409)
		}
		cur = *meta.Next
	}
	if refs.Next() || refs.Err() != nil || n != 10 {
		t.Fatal("page count", n)
	}
	refs.Close()
	t.Logf("cross-midnight filtered pagination %d rows passed", n)
	// Verify every actual API export row against the source-derived ledger;
	// exactly one complete manifest and exact CRC/EOF for each calendar day.
	total := 0
	totalByKind := map[string]int{}
	for i, d := range m.Files {
		start := dayMS(d.Day)
		end := start + 86400000
		query := fmt.Sprintf("/api/v2/export?from=%d&to=%d&format=jsonl.gz", start, end)
		resp := request("GET", query, "", "", 200)
		if resp.Header.Get("Content-Type") != "application/gzip" || !strings.Contains(resp.Header.Get("Content-Disposition"), "marketdepth-history") {
			t.Fatal("export headers")
		}
		gz, e := gzip.NewReader(resp.Body)
		if e != nil {
			t.Fatal(e)
		}
		scan := bufio.NewScanner(gz)
		scan.Buffer(make([]byte, 64<<10), 1<<20)
		rs, e := ledger.QueryContext(ctx, "SELECT kind,row_json FROM provenance WHERE day=? ORDER BY CASE kind WHEN 'spot_depth' THEN 0 WHEN 'futures_10s' THEN 1 ELSE 2 END,t,venue,asset", d.Day)
		if e != nil {
			t.Fatal(e)
		}
		counts := map[string]int{}
		finished := false
		for scan.Scan() {
			var x struct {
				Type, Kind string
				Row        json.RawMessage
				Complete   bool
				Candidate  bool           `json:"candidate_only"`
				Ready      bool           `json:"production_ready"`
				Counts     map[string]int `json:"row_counts"`
				Gaps       map[string][]store.Gap
			}
			if e = json.Unmarshal(scan.Bytes(), &x); e != nil || finished {
				t.Fatal("invalid export record", d.Day, e)
			}
			if x.Type == "manifest" {
				if !x.Complete || x.Candidate || x.Ready {
					t.Fatal("bad manifest")
				}
				for _, k := range []string{"spot_depth", "futures_10s", "futures_1m"} {
					if x.Counts[k] != counts[k] || counts[k] != d.Counts[k] {
						t.Fatal("manifest count", d.Day, k, counts[k], d.Counts[k])
					}
					step, width := int64(60000), 12
					if k == "futures_1m" {
						width = 3
					}
					if k == "futures_10s" {
						step = 10000
						width = 3
					}
					missing := 0
					prev := start
					for _, g := range x.Gaps[k] {
						if g.From < prev || g.To <= g.From || g.To > end || (g.To-g.From)%step != 0 || g.Reason != "grid_missing" {
							t.Fatal("bad gap", g)
						}
						missing += int((g.To - g.From) / step)
						prev = g.To
					}
					if missing*width != int(86400000/step)*width-counts[k] {
						t.Fatal("gap accounting", d.Day, k, missing, counts[k])
					}
				}
				finished = true
				continue
			}
			var k string
			var row []byte
			if !rs.Next() || rs.Scan(&k, &row) != nil || k != x.Kind || !bytes.Equal(x.Row, row) {
				t.Fatalf("API export row differs day=%s kind=%s index=%d", d.Day, x.Kind, total)
			}
			counts[k]++
			totalByKind[k]++
			total++
		}
		if scan.Err() != nil || !finished || rs.Next() || rs.Err() != nil {
			t.Fatal("export EOF/ledger mismatch", d.Day, scan.Err())
		}
		rs.Close()
		gz.Close()
		resp.Body.Close()
		t.Logf("day %02d/%d %s export verified %d cumulative %d", i+1, len(m.Files), d.Day, counts["spot_depth"]+counts["futures_1m"], total)
	}
	if total != m.Unique {
		t.Fatal("total mismatch", total, m.Unique)
	}
	// Exact downloaded archives; three representative days.
	for _, day := range []string{m.Files[0].Day, "2026-11-03", m.Files[54].Day} {
		rec := records[day]
		resp := request("GET", "/api/v2/day/"+day, "", "", 200)
		h := sha256.New()
		n, e := io.Copy(h, resp.Body)
		resp.Body.Close()
		if e != nil || n != rec.Manifest.Size || hex.EncodeToString(h.Sum(nil)) != rec.Manifest.SHA256 || resp.Header.Get("X-Archive-SHA256") != rec.Manifest.SHA256 || resp.Header.Get("ETag") != `"`+rec.ManifestSHA256+`"` || resp.ContentLength != n {
			t.Fatal("download mismatch", day, e)
		}
	}
	o = get("/api/v2/days?from=2026-11-14&to=2026-11-15", 200)
	var held []store.Day
	if json.Unmarshal(o["data"], &held) != nil || len(held) != 2 || held[0].State != "missing" || held[1].State != "missing" {
		t.Fatal("held date exposed")
	}
	if remote.puts != 0 || len(remote.objects) != 110 {
		t.Fatal("remote mutated")
	}
	if e = r.ClearHistoryCache(ctx); e != nil {
		t.Fatal(e)
	}
	t.Logf("SEALED_DOWNLOADS_PASS 3/3; remote GET=%d PUT=0", remote.gets)
	closeResp(request("POST", "/api/v2/auth/logout", "", a.origin, 200))
	get("/api/v2/meta", 401)
	t.Logf("REAL_RECOVERED_LEGACY_API_PASS days=%d rows=%d counts=%v manifest=%s", len(days), total, totalByKind, want)
}

// Mock remote deliberately read-only; files are exact prior prepared gzip bytes.
type qaObject struct {
	obj  archive.Object
	path string
	body []byte
}
type recoveryQAObjects struct {
	objects    map[string]qaObject
	gets, puts int
}

func (r *recoveryQAObjects) PutImmutable(context.Context, string, int64, string, io.Reader) (archive.Object, error) {
	r.puts++
	return archive.Object{}, errors.New("read-only mock")
}
func (r *recoveryQAObjects) OpenObject(ctx context.Context, id string) (archive.Object, io.ReadCloser, error) {
	r.gets++
	if e := ctx.Err(); e != nil {
		return archive.Object{}, nil, e
	}
	o, ok := r.objects[id]
	if !ok {
		return archive.Object{}, nil, errors.New("not found")
	}
	if o.path != "" {
		f, e := os.Open(o.path)
		return o.obj, f, e
	}
	return o.obj, io.NopCloser(bytes.NewReader(o.body)), nil
}
func qaSHA(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

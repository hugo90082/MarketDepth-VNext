package drive

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

type staticToken string

func (t staticToken) AccessToken(context.Context) (string, error) { return string(t), nil }

type fakeDrive struct {
	files                                     map[string]file
	data                                      map[string][]byte
	pending                                   map[string]file
	seq, uploads, rootGETs, folderCreates     int
	failRootAfterCommit                       bool
	gzipMIME                                  string
	failAfterCommit, foreign, duplicate       bool
	server                                    *httptest.Server
	listIncomplete, repeatToken, quotaMissing bool
}

func (f *fakeDrive) serve(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer fake-token" {
		w.WriteHeader(401)
		return
	}
	respond := func(v any) { w.Header().Set("Content-Type", "application/json"); json.NewEncoder(w).Encode(v) }
	p := r.URL.Path
	q := r.URL.Query()
	switch {
	case p == "/drive/v3/about":
		if f.quotaMissing {
			respond(map[string]any{"storageQuota": map[string]string{"usage": "1000000"}})
			return
		}
		respond(map[string]any{"storageQuota": map[string]string{"limit": "1000000000", "usage": "1000000"}})
	case p == "/drive/v3/files/root":
		f.rootGETs++
		w.WriteHeader(404)
	case p == "/drive/v3/files/generateIds":
		f.seq++
		respond(map[string]any{"ids": []string{fmt.Sprintf("file_%d", f.seq)}})
	case p == "/drive/v3/files" && r.Method == "GET":
		out := []file{}
		query := q.Get("q")
		for _, x := range f.files {
			parentMatch := !strings.Contains(query, " in parents") || (len(x.Parents) == 1 && (strings.Contains(query, "'"+x.Parents[0]+"' in parents") || (x.Parents[0] == "my_root" && strings.Contains(query, "'root' in parents"))))
			keyMatch := !strings.Contains(query, "key='md_key'") || strings.Contains(query, "key='md_key' and value='"+x.Props["md_key"]+"'")
			mimeMatch := !strings.Contains(query, "mimeType =") || (strings.Contains(query, "mimeType = 'application/json'") && x.MIME == "application/json")
			nsMatch := !strings.Contains(query, "key='md_ns'") || strings.Contains(query, "key='md_ns' and value='"+x.Props["md_ns"]+"'")
			nameMatch := !strings.Contains(query, "name = ") || strings.Contains(query, "name = '"+x.Name+"'")
			if !x.Trashed && nsMatch && nameMatch && parentMatch && keyMatch && mimeMatch {
				out = append(out, x)
				if f.duplicate && x.MIME != folderType {
					out = append(out, x)
				}
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
		offset := 0
		if q.Get("pageToken") != "" {
			var e error
			offset, e = strconv.Atoi(q.Get("pageToken"))
			if e != nil || offset < 0 || offset > len(out) {
				w.WriteHeader(400)
				return
			}
		}
		end := offset + 100
		if end > len(out) {
			end = len(out)
		}
		next := ""
		if end < len(out) {
			next = strconv.Itoa(end)
		}
		if f.repeatToken && q.Get("pageToken") != "" {
			next = q.Get("pageToken")
		}
		respond(map[string]any{"files": out[offset:end], "nextPageToken": next, "incompleteSearch": f.listIncomplete})
	case p == "/drive/v3/files" && r.Method == "POST":
		var x file
		if json.NewDecoder(r.Body).Decode(&x) != nil {
			w.WriteHeader(400)
			return
		}
		if _, ok := f.files[x.ID]; ok {
			w.WriteHeader(409)
			return
		}
		if x.Props["md_key"] == "root" {
			if x.Parents != nil {
				w.WriteHeader(400)
				return
			}
			x.Parents = []string{"my_root"}
		}
		f.files[x.ID] = x
		f.folderCreates++
		if x.Props["md_key"] == "root" && f.failRootAfterCommit {
			f.failRootAfterCommit = false
			w.WriteHeader(503)
			return
		}
		respond(x)
	case p == "/upload/drive/v3/files" && r.Method == "POST":
		var x file
		if json.NewDecoder(r.Body).Decode(&x) != nil {
			w.WriteHeader(400)
			return
		}
		if _, ok := f.files[x.ID]; ok {
			w.WriteHeader(409)
			return
		}
		f.pending[x.ID] = x
		loc := f.server.URL + "/upload/drive/v3/files?upload_id=" + x.ID
		if f.foreign {
			loc = "https://example.invalid/upload/drive/v3/files?upload_id=bad"
		}
		w.Header().Set("Location", loc)
		w.WriteHeader(200)
	case p == "/upload/drive/v3/files" && r.Method == "PUT":
		id := q.Get("upload_id")
		x, ok := f.pending[id]
		if !ok {
			w.WriteHeader(404)
			return
		}
		b, e := io.ReadAll(r.Body)
		if e != nil {
			w.WriteHeader(400)
			return
		}
		h := sha256.Sum256(b)
		x.SHA = hex.EncodeToString(h[:])
		x.Size = fmt.Sprint(len(b))
		if f.gzipMIME != "" && strings.HasSuffix(x.Name, ".sqlite.gz") {
			x.MIME = f.gzipMIME
		}
		f.files[id] = x
		f.data[id] = b
		f.uploads++
		if f.failAfterCommit {
			f.failAfterCommit = false
			w.WriteHeader(503)
			return
		}
		respond(x)
	case strings.HasPrefix(p, "/drive/v3/files/"):
		id := strings.TrimPrefix(p, "/drive/v3/files/")
		x, ok := f.files[id]
		if !ok {
			w.WriteHeader(404)
			return
		}
		if r.Method == "PATCH" {
			var b map[string]bool
			if json.NewDecoder(r.Body).Decode(&b) != nil || !b["trashed"] {
				w.WriteHeader(400)
				return
			}
			x.Trashed = true
			f.files[id] = x
			respond(x)
			return
		}
		if q.Get("alt") == "media" {
			w.Header().Set("Content-Length", fmt.Sprint(len(f.data[id])))
			w.Write(f.data[id])
			return
		}
		respond(x)
	default:
		w.WriteHeader(405)
	}
}
func setup(t *testing.T) (*Client, *fakeDrive, string) {
	t.Helper()
	f := &fakeDrive{files: map[string]file{}, data: map[string][]byte{}, pending: map[string]file{}}
	f.server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.server.Close)
	dir := t.TempDir()
	os.Chmod(dir, 0700)
	c := testClient(t, f, dir)
	return c, f, dir
}
func testClient(t *testing.T, f *fakeDrive, dir string) *Client {
	t.Helper()
	c, e := NewClient(staticToken("fake-token"), "MarketDepth-VNext-staging", dir)
	if e != nil {
		t.Fatal(e)
	}
	c.base = f.server.URL
	c.client = noRedirectClient(5 * time.Second)
	return c
}
func hash(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func TestImmutableDriveRestartAndReadback(t *testing.T) {
	c, f, dir := setup(t)
	ctx := context.Background()
	key := "historical/2026/11/2026-11-13.r1.sqlite.gz"
	b := []byte("snapshot")
	f.failAfterCommit = true
	if _, e := c.PutImmutable(ctx, key, int64(len(b)), hash(b), bytes.NewReader(b)); e == nil {
		t.Fatal("expected ambiguous failure")
	}
	if f.uploads != 1 {
		t.Fatal(f.uploads)
	}
	seq := f.seq
	c = testClient(t, f, dir)
	o, e := c.PutImmutable(ctx, key, int64(len(b)), hash(b), bytes.NewReader(b))
	if e != nil {
		t.Fatal(e)
	}
	if f.seq != seq || f.uploads != 1 {
		t.Fatal("duplicate remote upload")
	}
	got, r, e := c.OpenObject(ctx, o.ID)
	if e != nil {
		t.Fatal(e)
	}
	d, e := io.ReadAll(r)
	r.Close()
	if e != nil || got != o || !bytes.Equal(b, d) {
		t.Fatal("readback mismatch")
	}
	if _, e = c.PutImmutable(ctx, key, int64(len(b)), hash([]byte("conflict")), bytes.NewReader(b)); e == nil {
		t.Fatal("accepted revision conflict")
	}
	f.duplicate = true
	if _, e = c.PutImmutable(ctx, key, int64(len(b)), hash(b), bytes.NewReader(b)); e == nil {
		t.Fatal("accepted duplicate key")
	}
}
func TestForeignSessionAndReservationRetry(t *testing.T) {
	c, f, dir := setup(t)
	b := []byte("manifest")
	k := "staging/a.json"
	f.foreign = true
	if _, e := c.PutImmutable(context.Background(), k, int64(len(b)), hash(b), bytes.NewReader(b)); e == nil {
		t.Fatal("accepted foreign session")
	}
	seq := f.seq
	if f.uploads != 0 {
		t.Fatal("unexpected upload")
	}
	f.foreign = false
	c = testClient(t, f, dir)
	o, e := c.PutImmutable(context.Background(), k, int64(len(b)), hash(b), bytes.NewReader(b))
	if e != nil || o.ID == "" || seq != f.seq {
		t.Fatal(o, e, seq, f.seq)
	}
	if _, e = c.PutImmutable(context.Background(), "../x", 1, hash(b), bytes.NewReader(b)); e == nil {
		t.Fatal("accepted traversal")
	}
	f.files[o.ID] = file{ID: o.ID, Props: map[string]string{"md_ns": "foreign", "md_key": k}}
	if _, _, e = c.OpenObject(context.Background(), o.ID); e == nil {
		t.Fatal("accepted foreign namespace")
	}
}
func TestReservationPermissions(t *testing.T) {
	c, _, dir := setup(t)
	p := c.reservationPath("root")
	if e := os.WriteFile(p, []byte("{}"), 0644); e != nil {
		t.Fatal(e)
	}
	if _, _, e := c.load("root"); e == nil {
		t.Fatal("accepted loose reservation")
	}
	if _, e := NewClient(staticToken("x"), "test", filepath.Join(dir, "missing")); e == nil {
		t.Fatal("accepted missing directory")
	}
}

func TestMovedFolderFailsClosed(t *testing.T) {
	c, f, _ := setup(t)
	ctx := context.Background()
	key := "historical/2026/11/test.json"
	b := []byte("manifest")
	o, e := c.PutImmutable(ctx, key, int64(len(b)), hash(b), bytes.NewReader(b))
	if e != nil {
		t.Fatal(e)
	}
	r, ok, e := c.load("dir/historical/2026")
	if e != nil || !ok {
		t.Fatal("folder reservation missing")
	}
	x := f.files[r.ID]
	x.Parents = []string{"unrelated-folder"}
	f.files[r.ID] = x
	if _, r, e := c.OpenObject(ctx, o.ID); e == nil {
		r.Close()
		t.Fatal("read accepted moved folder")
	}
	if _, e := c.PutImmutable(ctx, key, int64(len(b)), hash(b), bytes.NewReader(b)); e == nil {
		t.Fatal("write accepted moved folder")
	}
}

func TestTrashOnlyExactActiveGeneration(t *testing.T) {
	c, f, _ := setup(t)
	ctx := context.Background()
	b := []byte("snapshot")
	k := "active/2026-11-13." + archive.HourGeneration(time.Date(2026, 11, 13, 1, 0, 0, 0, time.FixedZone("UTC+8", 8*3600))) + ".sqlite.gz"
	o, e := c.PutImmutable(ctx, k, int64(len(b)), hash(b), bytes.NewReader(b))
	if e != nil {
		t.Fatal(e)
	}
	h, e := c.PutImmutable(ctx, "historical/2026/11/test.sqlite.gz", int64(len(b)), hash(b), bytes.NewReader(b))
	if e != nil {
		t.Fatal(e)
	}
	if e = c.TrashActiveObject(ctx, h); e == nil {
		t.Fatal("historical trash allowed")
	}
	bad := o
	bad.SHA256 = hash([]byte("wrong"))
	if e = c.TrashActiveObject(ctx, bad); e == nil {
		t.Fatal("wrong hash allowed")
	}
	if f.files[o.ID].Trashed {
		t.Fatal("unverified trash")
	}
	if e = c.TrashActiveObject(ctx, o); e != nil {
		t.Fatal(e)
	}
	if e = c.TrashActiveObject(ctx, o); e != nil {
		t.Fatal("retry", e)
	}
	if !f.files[o.ID].Trashed || f.files[h.ID].Trashed {
		t.Fatal("wrong object trashed")
	}
}

func TestRetryAfterStatus(t *testing.T) {
	res := &http.Response{StatusCode: 429, Header: http.Header{"Retry-After": []string{"120"}}}
	e := responseStatus(res)
	if !status(e, 429) || RetryDelay(e) != 120*time.Second {
		t.Fatal(e, RetryDelay(e))
	}
}

func TestReadOnlyRecoveryWithoutLocalReservations(t *testing.T) {
	c, f, _ := setup(t)
	ctx := context.Background()
	key := "historical/2026/11/2026-11-13.r1.manifest.json"
	b := []byte("manifest")
	o, e := c.PutImmutable(ctx, key, int64(len(b)), hash(b), bytes.NewReader(b))
	if e != nil {
		t.Fatal(e)
	}
	seq, uploads := f.seq, f.uploads
	dir := t.TempDir()
	os.Chmod(dir, 0700)
	fresh := testClient(t, f, dir)
	if _, body, e := fresh.OpenObject(ctx, o.ID); e == nil {
		body.Close()
		t.Fatal("default read accepted absent reservation")
	}
	fresh.EnableRecoveryReads()
	if _, body, e := fresh.OpenObject(ctx, o.ID); e != nil {
		t.Fatal(e)
	} else {
		body.Close()
	}
	r := fresh.RecoveryReader()
	list, e := r.Discover(ctx)
	if e != nil || len(list) != 1 || list[0] != o {
		t.Fatal(list, e)
	}
	got, body, e := r.OpenObject(ctx, o.ID)
	if e != nil {
		t.Fatal(e)
	}
	raw, e := io.ReadAll(body)
	body.Close()
	if e != nil || got != o || !bytes.Equal(raw, b) {
		t.Fatal(got, e)
	}
	if _, e = r.PutImmutable(ctx, key, int64(len(b)), hash(b), bytes.NewReader(b)); e == nil {
		t.Fatal("recovery write accepted")
	}
	entries, e := os.ReadDir(dir)
	if e != nil || len(entries) != 0 || f.seq != seq || f.uploads != uploads {
		t.Fatal("recovery side effects", entries, e)
	}
	f.duplicate = true
	if _, e = r.Discover(ctx); e == nil {
		t.Fatal("duplicate candidate accepted")
	}
	f.duplicate = false
	x := f.files[o.ID]
	x.Parents = []string{"unrelated-folder"}
	f.files[o.ID] = x
	if _, body, e = r.OpenObject(ctx, o.ID); e == nil {
		body.Close()
		t.Fatal("moved object accepted")
	}
}

func TestDiscoverPlacementIncludesOrphanData(t *testing.T) {
	c, f, _ := setup(t)
	ctx := context.Background()
	b := []byte("opaque data")
	k := "historical/2026/11/2026-11-13.r1.sqlite.gz"
	o, e := c.PutImmutable(ctx, k, int64(len(b)), hash(b), bytes.NewReader(b))
	if e != nil {
		t.Fatal(e)
	}
	seq, uploads := f.seq, f.uploads
	dir := t.TempDir()
	os.Chmod(dir, 0700)
	fresh := testClient(t, f, dir).RecoveryReader()
	meta, e := fresh.Discover(ctx)
	if e != nil || len(meta) != 0 {
		t.Fatal(meta, e)
	}
	got, e := fresh.DiscoverPlacementObjects(ctx)
	if e != nil || len(got) != 1 || got[0] != (PlacementObject{"2026-11-13", k, o.ID}) {
		t.Fatal(got, e)
	}
	entries, e := os.ReadDir(dir)
	if e != nil || len(entries) != 0 || seq != f.seq || uploads != f.uploads {
		t.Fatal("placement read has side effects", entries, e)
	}
	f.duplicate = true
	if _, e = fresh.DiscoverPlacementObjects(ctx); e == nil {
		t.Fatal("duplicate archive placement accepted")
	}
	f.duplicate = false
	x := f.files[o.ID]
	x.Props["md_key"] = "historical/2026/10/2026-11-13.r1.sqlite.gz"
	f.files[o.ID] = x
	if _, e = fresh.DiscoverPlacementObjects(ctx); e == nil {
		t.Fatal("wrong archive parent date accepted")
	}
}

func TestRestrictedScopeRootRetryAndReadOnlyRecovery(t *testing.T) {
	c, f, dir := setup(t)
	ctx := context.Background()
	key := "historical/2026/11/2026-11-13.r1.manifest.json"
	b := []byte("manifest")
	f.failRootAfterCommit = true
	if _, e := c.PutImmutable(ctx, key, int64(len(b)), hash(b), bytes.NewReader(b)); e == nil {
		t.Fatal("expected ambiguous root creation")
	}
	if f.rootGETs != 0 || f.folderCreates != 1 || f.uploads != 0 {
		t.Fatal(f.rootGETs, f.folderCreates, f.uploads)
	}
	original, ok, e := c.load("root")
	if e != nil || !ok || original.Parent != "root" {
		t.Fatal(original, ok, e)
	}
	c = testClient(t, f, dir)
	o, e := c.PutImmutable(ctx, key, int64(len(b)), hash(b), bytes.NewReader(b))
	if e != nil {
		t.Fatal(e)
	}
	if f.rootGETs != 0 || f.folderCreates != 4 || f.uploads != 1 {
		t.Fatal(f.rootGETs, f.folderCreates, f.uploads)
	}
	freshDir := t.TempDir()
	os.Chmod(freshDir, 0700)
	rr := testClient(t, f, freshDir).RecoveryReader()
	_, body, e := rr.OpenObject(ctx, o.ID)
	if e != nil {
		t.Fatal(e)
	}
	body.Close()
	if f.rootGETs != 0 || f.folderCreates != 4 || f.uploads != 1 {
		t.Fatal("read-only side effect")
	}
	root := f.files[original.ID]
	root.Parents = []string{"moved"}
	f.files[original.ID] = root
	if _, e = c.PutImmutable(ctx, key, int64(len(b)), hash(b), bytes.NewReader(b)); e == nil {
		t.Fatal("accepted moved namespace root")
	}
	if _, body, e = rr.OpenObject(ctx, o.ID); e == nil {
		body.Close()
		t.Fatal("recovery accepted moved namespace root")
	}
	if f.folderCreates != 4 || f.uploads != 1 {
		t.Fatal("created replacement root")
	}
}
func TestDuplicateNamespaceRootFailsClosed(t *testing.T) {
	c, f, _ := setup(t)
	ctx := context.Background()
	b := []byte("data")
	key := "staging/a.json"
	if _, e := c.PutImmutable(ctx, key, int64(len(b)), hash(b), bytes.NewReader(b)); e != nil {
		t.Fatal(e)
	}
	r, _, e := c.load("root")
	if e != nil {
		t.Fatal(e)
	}
	duplicate := f.files[r.ID]
	duplicate.ID = "foreign_duplicate"
	duplicate.Parents = []string{"another_parent"}
	f.files[duplicate.ID] = duplicate
	seq, uploads := f.seq, f.uploads
	if _, e = c.PutImmutable(ctx, key, int64(len(b)), hash(b), bytes.NewReader(b)); e == nil {
		t.Fatal("accepted duplicate namespace key")
	}
	if f.seq != seq || f.uploads != uploads {
		t.Fatal("collision caused writes")
	}
}

func TestDriveGzipMIMEInferenceAcrossRetryAndRecovery(t *testing.T) {
	for _, mime := range []string{"application/x-gzip", "application/gzip"} {
		t.Run(mime, func(t *testing.T) {
			c, f, dir := setup(t)
			ctx := context.Background()
			f.gzipMIME = mime
			key := "active/2026-11-13." + archive.HourGeneration(time.Date(2026, 11, 13, 1, 0, 0, 0, time.FixedZone("UTC+8", 8*3600))) + ".sqlite.gz"
			b := []byte("opaque sqlite gzip fixture")
			f.failAfterCommit = true
			if _, e := c.PutImmutable(ctx, key, int64(len(b)), hash(b), bytes.NewReader(b)); e == nil {
				t.Fatal("expected lost upload response")
			}
			r, ok, e := c.load(key)
			if e != nil || !ok || r.MIME != "application/octet-stream" || f.files[r.ID].MIME != mime {
				t.Fatal(r, ok, e)
			}
			seq, uploads := f.seq, f.uploads
			c = testClient(t, f, dir)
			o, e := c.PutImmutable(ctx, key, int64(len(b)), hash(b), bytes.NewReader(b))
			if e != nil || o.ID != r.ID || f.seq != seq || f.uploads != uploads {
				t.Fatal(o, e, "duplicate upload")
			}
			checkRead := func(remote archive.RemoteObjects) {
				got, body, e := remote.OpenObject(ctx, o.ID)
				if e != nil {
					t.Fatal(e)
				}
				raw, e := io.ReadAll(body)
				body.Close()
				if e != nil || got != o || !bytes.Equal(raw, b) {
					t.Fatal(got, e)
				}
			}
			checkRead(c)
			freshDir := t.TempDir()
			os.Chmod(freshDir, 0700)
			rr := testClient(t, f, freshDir).RecoveryReader()
			checkRead(rr)
			placement, e := rr.DiscoverPlacementObjects(ctx)
			if e != nil || len(placement) != 1 || placement[0].ID != o.ID {
				t.Fatal(placement, e)
			}
			x := f.files[o.ID]
			x.MIME = "application/pdf"
			f.files[o.ID] = x
			if _, e = c.PutImmutable(ctx, key, int64(len(b)), hash(b), bytes.NewReader(b)); e == nil {
				t.Fatal("wrong MIME accepted")
			}
			if _, body, e := rr.OpenObject(ctx, o.ID); e == nil {
				body.Close()
				t.Fatal("wrong recovery MIME accepted")
			}
			if _, e = rr.DiscoverPlacementObjects(ctx); e == nil {
				t.Fatal("wrong placement MIME accepted")
			}
			if e = c.TrashActiveObject(ctx, o); e == nil {
				t.Fatal("wrong MIME retirement accepted")
			}
			x.MIME = mime
			goodSHA := x.SHA
			x.SHA = hash([]byte("different"))
			f.files[o.ID] = x
			if _, body, e := c.OpenObject(ctx, o.ID); e == nil {
				body.Close()
				t.Fatal("wrong hash accepted")
			}
			x.SHA = goodSHA
			f.files[o.ID] = x
			if e = c.TrashActiveObject(ctx, o); e != nil {
				t.Fatal(e)
			}
			if !f.files[o.ID].Trashed {
				t.Fatal("retirement failed")
			}
		})
	}
}
func TestDriveMIMEAliasesAreNarrow(t *testing.T) {
	for _, x := range []struct {
		key, expected, actual string
		want                  bool
	}{
		{"active/a.sqlite.gz", "application/octet-stream", "application/x-gzip", true},
		{"historical/a.sqlite.gz", "application/octet-stream", "application/gzip", true},
		{"active/a.manifest.json", "application/json", "application/x-gzip", false},
		{"dir/active", folderType, "application/x-gzip", false},
		{"staging/a.gz", "application/octet-stream", "application/x-gzip", false},
		{"active/a.sqlite.gz", "application/octet-stream", "application/pdf", false},
	} {
		if compatibleMIME(x.key, x.expected, x.actual) != x.want {
			t.Fatal(x)
		}
	}
}

func TestDriveSafeDiagnostic(t *testing.T) {
	req, e := http.NewRequest("PUT", "https://www.googleapis.com/upload/drive/v3/files?upload_id=PRIVATE_SESSION", nil)
	if e != nil {
		t.Fatal(e)
	}
	res := &http.Response{StatusCode: 403, Request: req, Header: http.Header{}}
	s := SafeDiagnostic(fmt.Errorf("PRIVATE_SECRET: %w", responseStatus(res)))
	if s != "drive_http=403 method=PUT endpoint=upload" {
		t.Fatal(s)
	}
	if s = SafeDiagnostic(identityError{"mime"}); s != "drive_identity_field=mime" {
		t.Fatal(s)
	}
	if s = SafeDiagnostic(fmt.Errorf("PRIVATE_SECRET")); s != "detail=withheld" {
		t.Fatal(s)
	}
}

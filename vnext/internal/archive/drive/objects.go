package drive

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
)

const folderType = "application/vnd.google-apps.folder"
const fields = "id,name,mimeType,parents,trashed,size,sha256Checksum,appProperties"
const apiBase = "https://www.googleapis.com"

type file struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	MIME    string            `json:"mimeType"`
	Parents []string          `json:"parents"`
	Trashed bool              `json:"trashed,omitempty"`
	Size    string            `json:"size,omitempty"`
	SHA     string            `json:"sha256Checksum,omitempty"`
	Props   map[string]string `json:"appProperties"`
}
type reservation struct {
	ID     string `json:"id"`
	Key    string `json:"key"`
	Size   int64  `json:"size"`
	SHA    string `json:"sha256"`
	Parent string `json:"parent"`
	MIME   string `json:"mime"`
}

// Client has a single writer per namespace. Reservation files must be durable,
// private, counted against local capacity, and retained until catalog recovery.
// No update/delete operations are implemented. Do not run two instances on
// different hosts using the same namespace until the old writer is stopped.
type Client struct {
	mu        sync.Mutex
	tokens    TokenProvider
	client    *http.Client
	base      string
	namespace string
	stateDir  string
 recoveryReads bool
}

var _ archive.RemoteObjects = (*Client)(nil)

func segment(v string) bool {
	return v != "" && v != "." && v != ".." && len(v) <= 100 && strings.Trim(v, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.") == ""
}
func identifier(v string) bool {
	return v != "" && len(v) <= 256 && strings.Trim(v, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_") == ""
}
func digestOK(v string) bool {
	b, e := hex.DecodeString(v)
	return e == nil && len(b) == 32 && strings.ToLower(v) == v
}
func validKey(k string) bool {
	if len(k) > 100 {
		return false
	}
	p := strings.Split(k, "/")
	if len(p) < 2 {
		return false
	}
	for _, s := range p {
		if !segment(s) {
			return false
		}
	}
	switch p[0] {
	case "historical", "active", "legacy", "catalog", "config", "staging":
		return true
	}
	return false
}
func NewClient(tokens TokenProvider, namespace, stateDir string) (*Client, error) {
	if tokens == nil || !segment(namespace) || len(namespace) > 60 {
		return nil, errors.New("invalid Drive namespace")
	}
	p, e := filepath.Abs(stateDir)
	if e != nil {
		return nil, e
	}
	real, e := filepath.EvalSymlinks(p)
	if e != nil || real != p {
		return nil, errors.New("private Drive state directory required")
	}
	st, e := os.Stat(p)
	if e != nil || !st.IsDir() || st.Mode().Perm()&0077 != 0 {
		return nil, errors.New("private Drive state directory required")
	}
	return &Client{tokens: tokens, namespace: namespace, stateDir: p, base: apiBase, client: noRedirectClient(3 * time.Minute)}, nil
}
func (c *Client) request(ctx context.Context, method, u string, body io.Reader, n int64, headers map[string]string) (*http.Response, error) {
	token, e := c.tokens.AccessToken(ctx)
	if e != nil {
		return nil, e
	}
	if token == "" {
		return nil, errors.New("empty Drive access token")
	}
	req, e := http.NewRequestWithContext(ctx, method, u, body)
	if e != nil {
		return nil, errors.New("Drive request invalid")
	}
	if n >= 0 {
		req.ContentLength = n
	}
	req.Header.Set("Authorization", "Bearer "+token)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, e := c.client.Do(req)
	if e != nil {
		return nil, errors.New("Drive transport failed")
	}
	return res, nil
}

type statusError struct {
	code       int
	retryAfter time.Duration
}

func (s statusError) Error() string { return fmt.Sprintf("Drive HTTP %d", s.code) }
func status(e error, s int) bool    { var x statusError; return errors.As(e, &x) && x.code == s }
func responseStatus(res *http.Response) statusError {
	s := statusError{code: res.StatusCode}
	v := strings.TrimSpace(res.Header.Get("Retry-After"))
	if v == "" {
		return s
	}
	if n, e := strconv.ParseInt(v, 10, 64); e == nil && n >= 0 && n <= 86400 {
		s.retryAfter = time.Duration(n) * time.Second
	} else if t, e := http.ParseTime(v); e == nil && t.After(time.Now()) {
		s.retryAfter = time.Until(t)
	}
	return s
}

// RetryDelay returns a server-provided lower bound, without logging response bodies.
func RetryDelay(e error) time.Duration {
	var x statusError
	if errors.As(e, &x) {
		return x.retryAfter
	}
	return 0
}
func decode(res *http.Response, v any) error {
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return responseStatus(res)
	}
	b, e := io.ReadAll(io.LimitReader(res.Body, 2<<20+1))
	if e != nil || len(b) > 2<<20 || json.Unmarshal(b, v) != nil {
		return errors.New("invalid Drive metadata response")
	}
	return nil
}
func (c *Client) json(ctx context.Context, method, path string, q url.Values, body any, v any) error {
	var r io.Reader
	var n int64
	h := map[string]string{}
	if body != nil {
		b, e := json.Marshal(body)
		if e != nil {
			return e
		}
		r = bytes.NewReader(b)
		n = int64(len(b))
		h["Content-Type"] = "application/json"
	}
	u := c.base + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	res, e := c.request(ctx, method, u, r, n, h)
	if e != nil {
		return e
	}
	return decode(res, v)
}
func (c *Client) get(ctx context.Context, id string) (file, error) {
	var f file
	if !identifier(id) {
		return f, errors.New("invalid Drive id")
	}
	e := c.json(ctx, "GET", "/drive/v3/files/"+id, url.Values{"fields": {fields}}, nil, &f)
	return f, e
}
func (c *Client) list(ctx context.Context, parent, key string) (*file, error) {
	// All inputs are constrained; no arbitrary query literals are accepted.
	q := fmt.Sprintf("'%s' in parents and trashed = false and appProperties has { key='md_key' and value='%s' } and appProperties has { key='md_ns' and value='%s' }", parent, key, c.namespace)
	v := url.Values{"q": {q}, "fields": {"nextPageToken,incompleteSearch,files(" + fields + ")"}, "pageSize": {"100"}, "spaces": {"drive"}, "corpora": {"user"}}
	var found *file
	for i := 0; i < 20; i++ {
		var page struct {
			Next       string `json:"nextPageToken"`
			Incomplete bool   `json:"incompleteSearch"`
			Files      []file `json:"files"`
		}
		if e := c.json(ctx, "GET", "/drive/v3/files", v, nil, &page); e != nil {
			return nil, e
		}
		if page.Incomplete {
			return nil, errors.New("incomplete Drive key search")
		}
		for _, f := range page.Files {
			if found != nil {
				return nil, errors.New("duplicate Drive logical key")
			}
			x := f
			found = &x
		}
		if page.Next == "" {
			return found, nil
		}
		v.Set("pageToken", page.Next)
	}
	return nil, errors.New("Drive key search page limit")
}
func (c *Client) generate(ctx context.Context) (string, error) {
	var x struct {
		IDs []string `json:"ids"`
	}
	e := c.json(ctx, "GET", "/drive/v3/files/generateIds", url.Values{"count": {"1"}, "space": {"drive"}, "type": {"files"}}, nil, &x)
	if e != nil {
		return "", e
	}
	if len(x.IDs) != 1 || !identifier(x.IDs[0]) {
		return "", errors.New("invalid generated Drive id")
	}
	return x.IDs[0], nil
}
func (c *Client) reservationPath(key string) string {
	h := sha256.Sum256([]byte(c.namespace + "\x00" + key))
	return filepath.Join(c.stateDir, hex.EncodeToString(h[:])+".drive-id.json")
}
func (c *Client) reserve(r reservation) error {
	path := c.reservationPath(r.Key)
	b, e := json.Marshal(r)
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(c.stateDir, ".id-")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if _, e = f.Write(b); e != nil {
		return e
	}
	if e = f.Sync(); e != nil {
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = os.Link(f.Name(), path); e != nil {
		return e
	}
	d, e := os.Open(c.stateDir)
	if e != nil {
		return e
	}
	defer d.Close()
	return d.Sync()
}
func (c *Client) load(key string) (reservation, bool, error) {
	var r reservation
	p := c.reservationPath(key)
	st, e := os.Lstat(p)
	if os.IsNotExist(e) {
		return r, false, nil
	}
	if e != nil || !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 || st.Size() > 4096 {
		return r, false, errors.New("invalid Drive reservation file")
	}
	b, e := os.ReadFile(p)
	if e != nil || json.Unmarshal(b, &r) != nil || r.Key != key || !identifier(r.ID) {
		return reservation{}, false, errors.New("invalid Drive reservation")
	}
	return r, true, nil
}
func (c *Client) check(f file, r reservation, name string) error {
	if f.ID != r.ID || f.Trashed || f.Name != name || f.MIME != r.MIME || len(f.Parents) != 1 || f.Parents[0] != r.Parent || f.Props["md_key"] != r.Key || f.Props["md_ns"] != c.namespace {
		return errors.New("Drive object identity conflict")
	}
	if r.MIME == folderType {
		return nil
	}
	n, e := strconv.ParseInt(f.Size, 10, 64)
	if e != nil || n != r.Size || f.Props["md_sha256"] != r.SHA || (f.SHA != "" && f.SHA != r.SHA) {
		return errors.New("Drive object size/hash conflict")
	}
	return nil
}
func (c *Client) lookup(ctx context.Context, want reservation, name string) (reservation, bool, error) {
	r, ok, e := c.load(want.Key)
	if e != nil {
		return r, false, e
	}
	if ok && (r.Parent != want.Parent || r.MIME != want.MIME || r.Size != want.Size || r.SHA != want.SHA) {
		return r, false, errors.New("immutable Drive key reservation conflict")
	}
	found, e := c.list(ctx, want.Parent, want.Key)
	if e != nil {
		return r, false, e
	}
	if found != nil {
		if !identifier(found.ID) {
			return r, false, errors.New("invalid Drive lookup id")
		}
		if ok && found.ID != r.ID {
			return r, false, errors.New("Drive id reservation conflict")
		}
		if !ok {
			r = want
			r.ID = found.ID
		}
		if e = c.check(*found, r, name); e != nil {
			return r, false, e
		}
		if !ok {
			if e = c.reserve(r); e != nil {
				return r, false, e
			}
		}
		return r, true, nil
	}
	if ok {
		f, e := c.get(ctx, r.ID)
		if e == nil {
			if e = c.check(f, r, name); e != nil {
				return r, false, e
			}
			return r, true, nil
		}
		if !status(e, 404) {
			return r, false, e
		}
		return r, false, nil
	}
	want.ID, e = c.generate(ctx)
	if e != nil {
		return r, false, e
	}
	if e = c.reserve(want); e != nil {
		return r, false, e
	}
	return want, false, nil
}
func (c *Client) metadata(r reservation, name string) file {
	p := map[string]string{"md_ns": c.namespace, "md_key": r.Key}
	if r.SHA != "" {
		p["md_sha256"] = r.SHA
	}
	return file{ID: r.ID, Name: name, MIME: r.MIME, Parents: []string{r.Parent}, Props: p}
}
func (c *Client) folder(ctx context.Context, parent, key, name string) (string, error) {
	r, exists, e := c.lookup(ctx, reservation{Key: key, Parent: parent, MIME: folderType}, name)
	if e != nil {
		return "", e
	}
	if !exists {
		var f file
		e = c.json(ctx, "POST", "/drive/v3/files", url.Values{"fields": {fields}}, c.metadata(r, name), &f)
		if status(e, 409) {
			f, e = c.get(ctx, r.ID)
		}
		if e != nil {
			return "", e
		}
		if e = c.check(f, r, name); e != nil {
			return "", e
		}
	}
	return r.ID, nil
}
func (c *Client) parent(ctx context.Context, key string) (string, string, error) {
	p := strings.Split(key, "/")
	myRoot, e := c.get(ctx, "root")
	if e != nil || !identifier(myRoot.ID) || myRoot.MIME != folderType || myRoot.Trashed {
		return "", "", errors.New("cannot resolve My Drive root")
	}
	root, e := c.folder(ctx, myRoot.ID, "root", c.namespace)
	if e != nil {
		return "", "", e
	}
	id := root
	for i := 0; i < len(p)-1; i++ {
		id, e = c.folder(ctx, id, "dir/"+strings.Join(p[:i+1], "/"), p[i])
		if e != nil {
			return "", "", e
		}
	}
	return id, p[len(p)-1], nil
}

// verifyParent follows the exact previously reserved folder chain without
// creating or moving anything. An object moved outside the tree fails closed.
func (c *Client) verifyParent(ctx context.Context, key string) (string, error) {
	myRoot, e := c.get(ctx, "root")
	if e != nil || !identifier(myRoot.ID) || myRoot.MIME != folderType || myRoot.Trashed {
		return "", errors.New("cannot resolve My Drive root")
	}
	parts := strings.Split(key, "/")
	parent := myRoot.ID
	for i := -1; i < len(parts)-1; i++ {
		k, name := "root", c.namespace
		if i >= 0 {
			k = "dir/" + strings.Join(parts[:i+1], "/")
			name = parts[i]
		}
		r, ok, e := c.load(k)
		if e != nil || !ok || r.Parent != parent || r.MIME != folderType || r.Size != 0 || r.SHA != "" {
			return "", errors.New("Drive parent reservation missing or invalid")
		}
		f, e := c.get(ctx, r.ID)
		if e != nil {
			return "", e
		}
		if e = c.check(f, r, name); e != nil {
			return "", e
		}
		parent = r.ID
	}
	return parent, nil
}
func (c *Client) object(f file, r reservation) archive.Object {
	return archive.Object{ID: f.ID, Key: r.Key, Size: r.Size, SHA256: r.SHA}
}
func (c *Client) PutImmutable(ctx context.Context, key string, size int64, sha string, body io.Reader) (archive.Object, error) {
	var z archive.Object
	if !validKey(key) || size <= 0 || size > archive.HardLimit || !digestOK(sha) || body == nil {
		return z, errors.New("invalid immutable Drive object")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	parent, name, e := c.parent(ctx, key)
	if e != nil {
		return z, e
	}
	mime := "application/octet-stream"
	if strings.HasSuffix(name, ".json") {
		mime = "application/json"
	}
	r, exists, e := c.lookup(ctx, reservation{Key: key, Parent: parent, Size: size, SHA: sha, MIME: mime}, name)
	if e != nil {
		return z, e
	}
	if exists {
		return archive.Object{ID: r.ID, Key: key, Size: size, SHA256: sha}, nil
	}
	// Start a resumable session using the preallocated, durably recorded ID.
	// Ambiguous failures return an error; the next invocation reuses that ID,
	// never allocates a second file. A whole-body retry requires a fresh reader.
	meta, e := json.Marshal(c.metadata(r, name))
	if e != nil {
		return z, e
	}
	u := c.base + "/upload/drive/v3/files?" + url.Values{"uploadType": {"resumable"}, "fields": {fields}}.Encode()
	res, e := c.request(ctx, "POST", u, bytes.NewReader(meta), int64(len(meta)), map[string]string{"Content-Type": "application/json", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": strconv.FormatInt(size, 10)})
	if e != nil {
		return z, e
	}
	location := res.Header.Get("Location")
	code := res.StatusCode
	res.Body.Close()
	if code == 409 {
		f, e := c.get(ctx, r.ID)
		if e != nil {
			return z, e
		}
		if e = c.check(f, r, name); e != nil {
			return z, e
		}
		return c.object(f, r), nil
	}
	if code != 200 && code != 201 {
		return z, responseStatus(res)
	}
	// Never forward the bearer token or archive to a server-selected foreign URL.
	loc, e := url.Parse(location)
	base, _ := url.Parse(c.base)
	if e != nil || loc.Scheme != base.Scheme || loc.Host != base.Host || loc.User != nil || loc.Fragment != "" || loc.Path != "/upload/drive/v3/files" || loc.Query().Get("upload_id") == "" {
		return z, errors.New("unsafe Drive upload session")
	}
	h := sha256.New()
	lim := &io.LimitedReader{R: body, N: size}
	res, e = c.request(ctx, "PUT", loc.String(), io.TeeReader(lim, h), size, map[string]string{"Content-Type": mime})
	if e != nil {
		return z, e
	}
	var f file
	e = decode(res, &f)
	if e != nil {
		return z, e
	}
	if lim.N != 0 || hex.EncodeToString(h.Sum(nil)) != sha {
		return z, errors.New("Drive upload input hash/size mismatch")
	}
	var extra [1]byte
	if n, e := io.ReadFull(body, extra[:]); n != 0 || !errors.Is(e, io.EOF) {
		return z, errors.New("Drive upload input size mismatch")
	}
	if e = c.check(f, r, name); e != nil {
		return z, e
	}
	return c.object(f, r), nil
}
// EnableRecoveryReads must be called only by the explicitly recovered-root
// startup path, before workers begin. It does not create reservations.
func(c *Client) EnableRecoveryReads(){c.mu.Lock();defer c.mu.Unlock();c.recoveryReads=true}
func (c *Client) OpenObject(ctx context.Context, id string) (archive.Object, io.ReadCloser, error) {
	var z archive.Object
	c.mu.Lock()
	defer c.mu.Unlock()
	f, e := c.get(ctx, id)
	if e != nil {
		return z, nil, e
	}
	key := f.Props["md_key"]
	if !validKey(key) || f.Props["md_ns"] != c.namespace {
		return z, nil, errors.New("object outside Drive namespace")
	}
	r, ok, e := c.load(key)
 if e==nil&&!ok&&c.recoveryReads{
  // Only an explicitly recovered catalog can read a missing local
  // reservation. The read-only path still validates exact remote folder
  // ancestry, key uniqueness and hash. Corrupt reservations never fallback.
  return (&RecoveryReader{c:c}).OpenObject(ctx,id)
 }
	if e != nil || !ok || r.ID != id {
		return z, nil, errors.New("Drive object reservation missing or invalid")
	}
	parent, e := c.verifyParent(ctx, key)
	if e != nil || parent != r.Parent {
		return z, nil, errors.New("Drive parent chain mismatch")
	}
	parts := strings.Split(key, "/")
	if e = c.check(f, r, parts[len(parts)-1]); e != nil {
		return z, nil, e
	}
	res, e := c.request(ctx, "GET", c.base+"/drive/v3/files/"+id+"?alt=media", nil, 0, nil)
	if e != nil {
		return z, nil, e
	}
	if res.StatusCode != 200 {
		res.Body.Close()
		return z, nil, responseStatus(res)
	}
	if res.ContentLength >= 0 && res.ContentLength != r.Size {
		res.Body.Close()
		return z, nil, errors.New("Drive download length mismatch")
	}
	return c.object(f, r), res.Body, nil
}

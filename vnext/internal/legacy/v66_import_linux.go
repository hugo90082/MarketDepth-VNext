//go:build linux && sqlite_integration

package legacy

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

// ImportObject is the exact scoped inventory identity. The future real gate
// must verify all pages, object metadata, actual parent/namespace, trash state,
// and separately exclude unknown objects; the library cannot prove these facts.
type ImportObject struct {
	Day    string `json:"day"`
	Key    string `json:"key"`
	ID     string `json:"id"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type ImportObservation struct {
	Namespace      string
	LeaseID        string
	WritersStopped bool
	Complete       bool
	ObservedAt     time.Time
	ClearLocalDays []string
	Objects        []ImportObject
	FreeBytes      int64 // usable remote quota; unknown quota is an error
}

// ImportGate is deliberately NOT implemented for real Drive in this module.
// A production adapter must actually enforce exclusive ownership (including
// stopped collector and other writers) continuously until the run returns;
// mere inspection, a boolean or a local flock cannot establish remote exclusion.
type ImportGate interface {
	Observe(ctx context.Context, leaseID string) (ImportObservation, error)
}

type V66ImportDay struct {
	Day      string           `json:"day"`
	Manifest archive.Manifest `json:"manifest"`
}
type V66ImportPlan struct {
	Version             string         `json:"version"`
	Namespace           string         `json:"namespace"`
	DraftSHA256         string         `json:"draft_sha256"`
	PlacementSHA256     string         `json:"placement_sha256"`
	CutoverMS           int64          `json:"cutover_ms"`
	Producer            string         `json:"producer"`
	Baseline            []ImportObject `json:"protected_inventory"`
	Days                []V66ImportDay `json:"days"`
	HeldDays            []string       `json:"held_days"`
	Bytes               int64          `json:"compressed_bytes"`
	PublicationApproved bool           `json:"publication_approved"`
}

const importReserve int64 = 100_000_000
const importBudget int64 = 250_000_000
const importQuotaReserve int64 = 1_000_000
const importNamespace = "MarketDepth-VNext-staging"

var importArchiveKey = regexp.MustCompile(`^(historical/[0-9]{4}/[0-9]{2}/[0-9]{4}-[0-9]{2}-[0-9]{2}\.r[1-9][0-9]*\.(manifest\.json|sqlite\.gz)|active/[0-9]{4}-[0-9]{2}-[0-9]{2}\.h[0-9]{13}\.(manifest\.json|sqlite\.gz)|catalog/loss/[0-9]{4}-[0-9]{2}-[0-9]{2}(\.partial)?\.json)$`)

func importObjectValid(o ImportObject) bool {
	a, e := time.ParseInLocation("2006-01-02", o.Day, time.FixedZone("UTC+8", 8*3600))
	if e != nil || a.Format("2006-01-02") != o.Day || !strings.HasPrefix(filepath.Base(o.Key), o.Day+".") || len(o.Key) > 100 || !importArchiveKey.MatchString(o.Key) || o.ID == "" || len(o.ID) > 256 || strings.Trim(o.ID, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_") != "" || o.Size <= 0 || o.Size > archive.HardLimit || !validHash(o.SHA256) {
		return false
	}
	if strings.HasPrefix(o.Key, "historical/") {
		return strings.HasPrefix(o.Key, "historical/"+o.Day[:4]+"/"+o.Day[5:7]+"/")
	}
	if strings.HasPrefix(o.Key, "active/") {
		h := strings.Split(filepath.Base(o.Key), ".")[1]
		n, e := strconv.ParseInt(h[1:], 10, 64)
		return e == nil && n >= a.UnixMilli() && n < a.Add(24*time.Hour).UnixMilli() && archive.HourGeneration(time.UnixMilli(n)) == h
	}
	return true
}

func inventoryMap(objects []ImportObject) (map[string]ImportObject, error) {
	if len(objects) > 50000 {
		return nil, errors.New("inventory exceeds limit")
	}
	out := map[string]ImportObject{}
	ids := map[string]bool{}
	for _, o := range objects {
		if !importObjectValid(o) || out[o.Key].ID != "" || ids[o.ID] {
			return nil, errors.New("invalid or duplicate inventory identity")
		}
		out[o.Key] = o
		ids[o.ID] = true
	}
	return out, nil
}
func importKeys(day string) (string, string) {
	b := "historical/" + day[:4] + "/" + day[5:7] + "/" + day + ".r1"
	return b + ".sqlite.gz", b + ".manifest.json"
}
func importDir(root, day string) string { return filepath.Join(root, "prepared", day) }
func importPath(root, day string) string {
	return filepath.Join(importDir(root, day), day+".legacy-r1.sqlite.gz")
}
func privateDir(p string) error {
	a, e := filepath.Abs(p)
	if e != nil {
		return e
	}
	r, e := filepath.EvalSymlinks(a)
	if e != nil || r != a {
		return errors.New("unsafe private directory path")
	}
	s, e := os.Stat(a)
	if e != nil || !s.IsDir() || s.Mode().Perm()&0077 != 0 {
		return errors.New("private directory required")
	}
	return nil
}
func regularBytes(p string, max int64) ([]byte, error) {
	s, e := os.Lstat(p)
	if e != nil {
		return nil, e
	}
	if !s.Mode().IsRegular() || s.Mode().Perm()&0077 != 0 || s.Size() <= 0 || s.Size() > max {
		return nil, errors.New("invalid durable file")
	}
	f, e := os.Open(p)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil || !os.SameFile(s, st) {
		return nil, errors.New("durable file changed")
	}
	b, e := io.ReadAll(io.LimitReader(f, max+1))
	if e != nil || int64(len(b)) != s.Size() {
		return nil, errors.New("durable file size differs")
	}
	return b, nil
}

// Link publishes a complete fsynced file without replacing any prior intent.
// An interrupted write can leave a temporary file, never a partial visible record.
func syncImportDir(path string) error {
	d, e := os.Open(path)
	if e != nil {
		return e
	}
	return errors.Join(d.Sync(), d.Close())
}
func immutableJSON(p string, v any) error {
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	dir := filepath.Dir(p)
	f, e := os.CreateTemp(dir, ".intent-")
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
	if e = os.Link(f.Name(), p); e != nil {
		return e
	}
	d, e := os.Open(dir)
	if e != nil {
		return e
	}
	return errors.Join(d.Sync(), d.Close())
}
func localFree(path string, need int64) error {
	var s syscall.Statfs_t
	if e := syscall.Statfs(path, &s); e != nil {
		return e
	}
	if need < 0 || uint64(need) > s.Bavail*uint64(s.Bsize) {
		return errors.New("insufficient local disk")
	}
	return nil
}

// PrepareV66Import creates a new immutable local plan; NEVER calls remote.
// The draft and actual placement hashes must be supplied independently. All
// protected objects (not only the target date range) are pinned in the plan.
// An incomplete preparation is intentionally not resumable/publishable.
func PrepareV66Import(ctx context.Context, root, candidateRoot string, draft []byte, draftSHA string, placement PlacementReport, placementSHA string, baseline []ImportObject, producer string, seal time.Time) (string, error) {
	bound, e := BindV66Proofs(draft, draftSHA, placement, placementSHA)
	if e != nil {
		return "", e
	}
	initial, e := inventoryMap(baseline)
	if e != nil {
		return "", e
	}
	if len(initial) != placement.ObservedRemoteCount {
		return "", errors.New("full inventory count differs from review")
	}
	byDay := map[string][]ImportObject{}
	for _, o := range initial {
		byDay[o.Day] = append(byDay[o.Day], o)
	}
	for _, d := range placement.Days {
		if len(byDay[d.Day]) != len(d.RemoteObjects) {
			return "", errors.New("review inventory differs")
		}
		for _, o := range d.RemoteObjects {
			if got := initial[o.Key]; got.ID != o.ID || got.Day != d.Day {
				return "", errors.New("review identity differs")
			}
		}
	}
	if seal.UnixMilli() < placement.FinishedAtMS || seal.After(time.Now().Add(time.Minute)) {
		return "", errors.New("invalid seal time")
	}
	if a, err := filepath.Abs(filepath.Dir(root)); err != nil {
		return "", err
	} else if r, err := filepath.EvalSymlinks(a); err != nil || r != a {
		return "", errors.New("unsafe preparation parent")
	}
	if e = localFree(filepath.Dir(root), importBudget+importReserve); e != nil {
		return "", e
	}
	if e = os.Mkdir(root, 0700); e != nil {
		return "", e
	}
	if e = privateDir(root); e != nil {
		return "", e
	}
	if e = syncImportDir(filepath.Dir(root)); e != nil {
		return "", e
	}
	for _, sub := range []string{"prepared", "progress", "scratch"} {
		if e = os.Mkdir(filepath.Join(root, sub), 0700); e != nil {
			return "", e
		}
	}
	p := V66ImportPlan{Version: "v66-import-plan-v1", Namespace: importNamespace, DraftSHA256: draftSHA, PlacementSHA256: placementSHA, CutoverMS: placement.CutoverMS, Producer: producer, Baseline: append([]ImportObject{}, baseline...), HeldDays: bound.HeldDays}
	sort.Slice(p.Baseline, func(i, j int) bool { return p.Baseline[i].Key < p.Baseline[j].Key })
	for _, proof := range bound.Proofs {
		if e = ctx.Err(); e != nil {
			return "", e
		}
		if len(byDay[proof.Day]) != 0 {
			return "", errors.New("target date occupied")
		}
		_, h, e := CanonicalLegacyProof(proof)
		if e != nil {
			return "", e
		}
		s, e := PrepareReviewedV66Day(ctx, draft, draftSHA, placement, placementSHA, proof.Day, h, candidateRoot, importDir(root, proof.Day), producer, seal, importReserve)
		if e != nil {
			return "", fmt.Errorf("prepare %s: %w", proof.Day, e)
		}
		p.Bytes += s.Manifest.Size
		if p.Bytes > importBudget {
			return "", errors.New("batch staging budget exceeded")
		}
		p.Days = append(p.Days, V66ImportDay{proof.Day, s.Manifest})
	}
	if e = validatePlan(p); e != nil {
		return "", e
	}
	if e = syncImportDir(filepath.Join(root, "prepared")); e != nil {
		return "", e
	}
	if e = immutableJSON(filepath.Join(root, "plan.json"), p); e != nil {
		return "", e
	}
	b, e := regularBytes(filepath.Join(root, "plan.json"), 4<<20)
	if e != nil {
		return "", e
	}
	return hash(b), nil
}
func validatePlan(p V66ImportPlan) error {
	if p.Version != "v66-import-plan-v1" || p.Namespace != importNamespace || p.PublicationApproved || !validHash(p.DraftSHA256) || !validHash(p.PlacementSHA256) || len(p.Days) != 55 || !reflect.DeepEqual(p.HeldDays, []string{"2026-11-14", "2026-11-15"}) || p.CutoverMS <= 0 || p.Bytes <= 0 || p.Bytes > importBudget || len(p.Producer) != 40 || strings.Trim(p.Producer, "0123456789abcdef") != "" {
		return errors.New("invalid plan header")
	}
	base, e := inventoryMap(p.Baseline)
	if e != nil {
		return e
	}
	occupied := map[string]bool{}
	for _, o := range base {
		occupied[o.Day] = true
	}
	loc := time.FixedZone("UTC+8", 8*3600)
	a := time.Date(2026, 9, 20, 0, 0, 0, 0, loc)
	var size, n int64
	for i, d := range p.Days {
		m := d.Manifest
		if d.Day != a.AddDate(0, 0, i).Format("2006-01-02") || occupied[d.Day] || m.Day != d.Day || m.DataOrigin != "legacy" || m.FileID != "" || m.ProducerCommit != p.Producer || m.LegacyProof == nil || m.LegacyProof.PlacementReportSHA256 != p.PlacementSHA256 || m.LegacyProof.CutoverMS != p.CutoverMS || archive.ValidateSealedManifest(m) != nil {
			return errors.New("invalid plan day")
		}
		n += m.LegacyProof.UniqueSpot + m.LegacyProof.UniqueFutures1m
		size += m.Size
	}
	if n != 1042893 || size != p.Bytes {
		return errors.New("plan accounting differs")
	}
	return nil
}
func readPlan(root, approvedSHA string) (V66ImportPlan, error) {
	var p V66ImportPlan
	if !validHash(approvedSHA) {
		return p, errors.New("independently approved plan digest required")
	}
	b, e := regularBytes(filepath.Join(root, "plan.json"), 4<<20)
	if e != nil || hash(b) != approvedSHA {
		return p, errors.New("approved plan digest differs")
	}
	if e = json.Unmarshal(b, &p); e != nil {
		return p, e
	}
	return p, validatePlan(p)
}
func checkPrepared(ctx context.Context, root string, d V66ImportDay) error {
	if e := privateDir(importDir(root, d.Day)); e != nil {
		return e
	}
	p := importPath(root, d.Day)
	st, e := os.Lstat(p)
	if e != nil {
		return e
	}
	if !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 || st.Size() != d.Manifest.Size {
		return errors.New("invalid prepared file")
	}
	f, e := os.Open(p)
	if e != nil {
		return e
	}
	defer f.Close()
	got, e := f.Stat()
	if e != nil || !os.SameFile(st, got) {
		return errors.New("prepared file replaced")
	}
	h := sha256.New()
	n, e := io.Copy(h, io.LimitReader(f, d.Manifest.Size+1))
	if e != nil || n != d.Manifest.Size || hex.EncodeToString(h.Sum(nil)) != d.Manifest.SHA256 {
		return errors.New("prepared file hash differs")
	}
	return ctx.Err()
}

// InspectV66Import verifies the exact plan and every prepared gzip locally.
// It returns an advisory plan, not permission to publish.
func InspectV66Import(ctx context.Context, root, expectedSHA string) (V66ImportPlan, error) {
	var zero V66ImportPlan
	for _, dir := range []string{root, filepath.Join(root, "prepared"), filepath.Join(root, "progress"), filepath.Join(root, "scratch")} {
		if e := privateDir(dir); e != nil {
			return zero, e
		}
	}
	p, e := readPlan(root, expectedSHA)
	if e != nil {
		return zero, e
	}
	for _, d := range p.Days {
		if e = checkPrepared(ctx, root, d); e != nil {
			return zero, fmt.Errorf("prepared preflight %s: %w", d.Day, e)
		}
	}
	return p, nil
}
func readRecord(root string, d V66ImportDay) (*archive.PublishedRecord, error) {
	b, e := regularBytes(filepath.Join(root, "progress", d.Day+".json"), 2<<20)
	if os.IsNotExist(e) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var r archive.PublishedRecord
	if e = json.Unmarshal(b, &r); e != nil {
		return nil, e
	}
	if archive.ValidateRecord(r) != nil {
		return nil, errors.New("invalid stored publication record")
	}
	m := r.Manifest
	m.FileID = ""
	if !reflect.DeepEqual(m, d.Manifest) {
		return nil, errors.New("record differs from prepared manifest")
	}
	return &r, nil
}
func manifestObject(m archive.Manifest, dataID string) ([]byte, string, error) {
	m.FileID = dataID
	b, e := json.Marshal(m)
	return b, hash(b), e
}
func objectMatches(o ImportObject, key string, size int64, digest string) bool {
	return o.Key == key && o.Size == size && o.SHA256 == digest
}
func verifyObject(ctx context.Context, r archive.RemoteObjects, o ImportObject, consume func(io.Reader) error) error {
	got, body, e := r.OpenObject(ctx, o.ID)
	if body != nil {
		defer body.Close()
	}
	if e != nil {
		return e
	}
	if body == nil || got.ID != o.ID || got.Key != o.Key || got.Size != o.Size || (got.SHA256 != "" && got.SHA256 != o.SHA256) {
		return errors.New("remote identity differs")
	}
	return consume(body)
}

func verifyProtected(ctx context.Context, r archive.RemoteObjects, base []ImportObject) error {
	for _, o := range base {
		if e := verifyObject(ctx, r, o, func(body io.Reader) error {
			h := sha256.New()
			n, e := io.Copy(h, io.LimitReader(body, o.Size+1))
			if e != nil || n != o.Size || hex.EncodeToString(h.Sum(nil)) != o.SHA256 {
				return errors.New("protected object bytes differ")
			}
			return ctx.Err()
		}); e != nil {
			return fmt.Errorf("protected inventory readback: %w", e)
		}
	}
	return nil
}

// restore validates the complete compressed stream, raw SQLite and proof.
func verifyPair(ctx context.Context, r archive.RemoteObjects, d V66ImportDay, data, meta ImportObject, scratch string) (archive.PublishedRecord, error) {
	var z archive.PublishedRecord
	m := d.Manifest
	dk, mk := importKeys(d.Day)
	if !objectMatches(data, dk, m.Size, m.SHA256) {
		return z, errors.New("data identity differs")
	}
	b, h, e := manifestObject(m, data.ID)
	if e != nil {
		return z, e
	}
	m.FileID = data.ID
	if e = verifyObject(ctx, r, data, func(body io.Reader) error {
		dir, e := os.MkdirTemp(scratch, "readback-")
		if e != nil {
			return e
		}
		defer os.RemoveAll(dir)
		_, e = store.RestoreVerifiedDay(ctx, m, body, dir, importReserve)
		return e
	}); e != nil {
		return z, e
	}
	if meta.ID == "" {
		return z, nil
	}
	if !objectMatches(meta, mk, int64(len(b)), h) || meta.ID == data.ID {
		return z, errors.New("manifest identity differs")
	}
	if e = verifyObject(ctx, r, meta, func(body io.Reader) error {
		got, e := io.ReadAll(io.LimitReader(body, int64(len(b))+1))
		if e != nil || !bytes.Equal(got, b) {
			return errors.New("remote manifest bytes differ")
		}
		return nil
	}); e != nil {
		return z, e
	}
	z = archive.PublishedRecord{Manifest: m, ManifestID: meta.ID, ManifestSHA256: h}
	return z, archive.ValidateRecord(z)
}

type importSession struct {
	p       V66ImportPlan
	gate    ImportGate
	lease   string
	records map[string]archive.PublishedRecord
	seen    map[string]ImportObject
}

// scan verifies full inventory on every gate check. Only the next unfinished
// date may have exact prepared data/manifest from an interrupted attempt.
func (s *importSession) scan(ctx context.Context, current string) (map[string]ImportObject, error) {
	o, e := s.gate.Observe(ctx, s.lease)
	if e != nil {
		return nil, e
	}
	now := time.Now()
	if o.Namespace != s.p.Namespace || o.LeaseID != s.lease || !o.WritersStopped || !o.Complete || o.ObservedAt.After(now.Add(time.Second)) || now.Sub(o.ObservedAt) > time.Minute || o.FreeBytes < 0 {
		return nil, errors.New("exclusive fresh observation required")
	}
	want := make([]string, 0, 55)
	for _, d := range s.p.Days {
		want = append(want, d.Day)
	}
	got := append([]string{}, o.ClearLocalDays...)
	sort.Strings(got)
	if !reflect.DeepEqual(got, want) {
		return nil, errors.New("local placement not clear")
	}
	all, e := inventoryMap(o.Objects)
	if e != nil {
		return nil, e
	}
	allowed := map[string]bool{}
	for _, x := range s.p.Baseline {
		if all[x.Key] != x {
			return nil, errors.New("protected inventory changed")
		}
		allowed[x.Key] = true
	}
	// Within a session, never accept a changed/disappearing identity.
	for k, x := range s.seen {
		if all[k] != x {
			return nil, errors.New("previously observed object changed")
		}
	}
	var remaining int64
	for _, d := range s.p.Days {
		dk, mk := importKeys(d.Day)
		a, b := all[dk], all[mk]
		r, done := s.records[d.Day]
		if done {
			if a.ID != r.Manifest.FileID || b.ID != r.ManifestID {
				return nil, errors.New("completed object ID differs")
			}
		} else if d.Day != current && (a.ID != "" || b.ID != "") {
			return nil, errors.New("unprepared/out-of-order remote collision")
		}
		if a.ID != "" {
			if !objectMatches(a, dk, d.Manifest.Size, d.Manifest.SHA256) || a.Day != d.Day {
				return nil, errors.New("data collision")
			}
			allowed[dk] = true
		} else {
			remaining += d.Manifest.Size
		}
		if b.ID != "" {
			if a.ID == "" {
				return nil, errors.New("orphan manifest")
			}
			raw, h, e := manifestObject(d.Manifest, a.ID)
			if e != nil || !objectMatches(b, mk, int64(len(raw)), h) || b.Day != d.Day || done && h != r.ManifestSHA256 {
				return nil, errors.New("manifest collision")
			}
			allowed[mk] = true
		} else {
			raw, _, e := manifestObject(d.Manifest, strings.Repeat("a", 256))
			if e != nil {
				return nil, e
			}
			remaining += int64(len(raw))
		}
	}
	if len(allowed) != len(all) {
		return nil, errors.New("unknown remote object")
	}
	if remaining > 0 && o.FreeBytes < remaining+importQuotaReserve {
		return nil, errors.New("insufficient remote quota")
	}
	s.seen = all
	return all, nil
}

// Guard every PUT, including retries, with a fresh complete observation. The
// externally held lease is what closes the check/write race, not this scan.
type guardedImportRemote struct {
	archive.RemoteObjects
	s *importSession
	d V66ImportDay
}

func (g guardedImportRemote) PutImmutable(ctx context.Context, key string, size int64, digest string, body io.Reader) (archive.Object, error) {
	all, e := g.s.scan(ctx, g.d.Day)
	if e != nil {
		return archive.Object{}, e
	}
	dk, mk := importKeys(g.d.Day)
	switch key {
	case dk:
		if size != g.d.Manifest.Size || digest != g.d.Manifest.SHA256 {
			return archive.Object{}, errors.New("unexpected data write")
		}
	case mk:
		a := all[dk]
		raw, h, e := manifestObject(g.d.Manifest, a.ID)
		if a.ID == "" || e != nil || size != int64(len(raw)) || digest != h {
			return archive.Object{}, errors.New("unexpected manifest write")
		}
	default:
		return archive.Object{}, errors.New("write outside prepared day")
	}
	o, e := g.RemoteObjects.PutImmutable(ctx, key, size, digest, body)
	if e == nil {
		if prev := all[key]; prev.ID != "" && o.ID != prev.ID {
			return archive.Object{}, errors.New("retry changed object ID")
		}
		if o.Key != key || o.ID == "" || o.Size != size || (o.SHA256 != "" && o.SHA256 != digest) {
			return archive.Object{}, errors.New("write identity differs")
		}
		g.s.seen[key] = ImportObject{g.d.Day, key, o.ID, size, digest}
	}
	return o, e
}

// RunV66Import requires the exact externally approved plan digest and an
// externally enforced exclusive lease. The production gate/command is NOT
// wired. This function is exercised only with a synthetic remote in QA.
// No automatic retry, deletion, re-sealing, or catalog mutation occurs.
func RunV66Import(ctx context.Context, root, approvedSHA, lease string, gate ImportGate, remote archive.RemoteObjects) (int, error) {
	if gate == nil || remote == nil || lease == "" {
		return 0, errors.New("exclusive import gate required")
	}
	for _, dir := range []string{root, filepath.Join(root, "prepared"), filepath.Join(root, "progress"), filepath.Join(root, "scratch")} {
		if e := privateDir(dir); e != nil {
			return 0, e
		}
	}
	// flock is only local mutual exclusion. Remote lease is independently required.
	lock, e := os.OpenFile(filepath.Join(root, "run.lock"), os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if e != nil {
		return 0, e
	}
	defer lock.Close()
	if e = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		return 0, e
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	p, e := InspectV66Import(ctx, root, approvedSHA)
	if e != nil {
		return 0, e
	}
	s := importSession{p: p, gate: gate, lease: lease, records: map[string]archive.PublishedRecord{}}
	current := ""
	n := 0
	for _, d := range p.Days {
		r, e := readRecord(root, d)
		if e != nil {
			return n, e
		}
		if r == nil {
			if current == "" {
				current = d.Day
			}
		} else {
			if current != "" {
				return n, errors.New("out-of-order progress record")
			}
			s.records[d.Day] = *r
			n++
		}
	}
	all, e := s.scan(ctx, current)
	if e != nil {
		return n, e
	}
	scratch := filepath.Join(root, "scratch")
	if e = verifyProtected(ctx, remote, p.Baseline); e != nil {
		return n, e
	}
	// Re-verify every completed pair on process restart, read-only.
	for _, d := range p.Days {
		r, ok := s.records[d.Day]
		if !ok {
			break
		}
		dk, mk := importKeys(d.Day)
		v, e := verifyPair(ctx, remote, d, all[dk], all[mk], scratch)
		if e != nil || !reflect.DeepEqual(v, r) {
			return n, fmt.Errorf("resume verification %s: %v", d.Day, e)
		}
	}
	for _, d := range p.Days {
		if _, ok := s.records[d.Day]; ok {
			continue
		}
		if e = ctx.Err(); e != nil {
			return n, e
		}
		all, e = s.scan(ctx, d.Day)
		if e != nil {
			return n, e
		}
		dk, mk := importKeys(d.Day)
		a, b := all[dk], all[mk]
		var r archive.PublishedRecord
		if a.ID != "" {
			r, e = verifyPair(ctx, remote, d, a, b, scratch)
			if e != nil {
				return n, e
			}
		}
		if b.ID == "" {
			if e = privateDir(importDir(root, d.Day)); e != nil {
				return n, e
			}
			if e = localFree(scratch, importReserve); e != nil {
				return n, e
			}
			pub, e := store.PublishPreparedLegacySnapshot(ctx, guardedImportRemote{remote, &s, d}, store.SnapshotResult{Manifest: d.Manifest, Path: importPath(root, d.Day), RawBytes: d.Manifest.RawSize}, d.Manifest.LegacyProofSHA256, scratch, importReserve)
			if e != nil {
				return n, fmt.Errorf("publish %s: %w", d.Day, e)
			}
			r, e = pub.Record()
			if e != nil {
				return n, e
			}
		}
		// Verify listing agrees with the verified readback before durable commit.
		all, e = s.scan(ctx, d.Day)
		if e != nil {
			return n, e
		}
		if all[dk].ID != r.Manifest.FileID || all[mk].ID != r.ManifestID || archive.ValidateRecord(r) != nil {
			return n, errors.New("publication inventory mismatch")
		}
		if e = immutableJSON(filepath.Join(root, "progress", d.Day+".json"), r); e != nil {
			return n, e
		}
		s.records[d.Day] = r
		n++
	}
	if _, e = s.scan(ctx, ""); e != nil {
		return n, e
	}
	if e = verifyProtected(ctx, remote, p.Baseline); e != nil {
		return n, e
	}
	return n, nil
}

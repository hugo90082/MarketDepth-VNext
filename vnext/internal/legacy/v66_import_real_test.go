//go:build linux && sqlite_integration

package legacy

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive/drive"
)

type importMockObject struct {
	o ImportObject
	b []byte
}
type importMock struct {
	objects                                            map[string]importMockObject
	next, puts, creates, gets, checks                  int
	failKey                                            string
	blocked, stale, localConflict, wrongLease, partial bool
	free                                               int64
	days                                               []string
}

func (m *importMock) add(day, key string, b []byte) ImportObject {
	m.next++
	o := ImportObject{day, key, fmt.Sprintf("mock_%d", m.next), int64(len(b)), hash(b)}
	m.objects[key] = importMockObject{o, append([]byte(nil), b...)}
	return o
}
func (m *importMock) PutImmutable(ctx context.Context, key string, n int64, h string, r io.Reader) (archive.Object, error) {
	m.puts++
	b, e := io.ReadAll(io.LimitReader(r, n+1))
	if e != nil || int64(len(b)) != n || hash(b) != h {
		return archive.Object{}, errors.New("bad body")
	}
	x, ok := m.objects[key]
	if ok {
		if !objectMatches(x.o, key, n, h) || !bytes.Equal(x.b, b) {
			return archive.Object{}, errors.New("immutable conflict")
		}
	} else {
		day := filepath.Base(key)[:10]
		m.add(day, key, b)
		m.creates++
		x = m.objects[key]
	}
	if key == m.failKey {
		m.failKey = ""
		return archive.Object{}, errors.New("synthetic timeout after object committed")
	}
	return archive.Object{ID: x.o.ID, Key: x.o.Key, Size: x.o.Size, SHA256: x.o.SHA256}, ctx.Err()
}
func (m *importMock) OpenObject(ctx context.Context, id string) (archive.Object, io.ReadCloser, error) {
	m.gets++
	for _, x := range m.objects {
		if x.o.ID == id {
			return archive.Object{ID: id, Key: x.o.Key, Size: x.o.Size, SHA256: x.o.SHA256}, io.NopCloser(bytes.NewReader(x.b)), ctx.Err()
		}
	}
	return archive.Object{}, nil, errors.New("not found")
}
func (m *importMock) Observe(ctx context.Context, lease string) (ImportObservation, error) {
	m.checks++
	now := time.Now()
	if m.stale {
		now = now.Add(-2 * time.Minute)
	}
	if m.wrongLease {
		lease = "other"
	}
	d := append([]string{}, m.days...)
	if m.localConflict {
		d = d[1:]
	}
	var os []ImportObject
	for _, x := range m.objects {
		os = append(os, x.o)
	}
	return ImportObservation{Namespace: importNamespace, LeaseID: lease, WritersStopped: !m.blocked, Complete: !m.partial, ObservedAt: now, ClearLocalDays: d, Objects: os, FreeBytes: m.free}, ctx.Err()
}

func TestImportInventoryRejectsDuplicates(t *testing.T) {
	o := ImportObject{"2026-11-14", "active/2026-11-14.h1794585600000.sqlite.gz", "id", 1, strings.Repeat("a", 64)}
	if _, e := inventoryMap([]ImportObject{o, o}); e == nil {
		t.Fatal("duplicate accepted")
	}
	p := o
	p.Key = "active/2026-11-14.h1794589200000.sqlite.gz"
	if _, e := inventoryMap([]ImportObject{o, p}); e == nil {
		t.Fatal("duplicate ID accepted")
	}
	p.ID = "bad/id"
	if _, e := inventoryMap([]ImportObject{p}); e == nil {
		t.Fatal("bad ID accepted")
	}
}

// Real 55-day input; in-memory synthetic remote and lease. Never Drive.
func TestRealV66ImportCoordinator(t *testing.T) {
	root, draftPath := os.Getenv("MD_REAL_CANDIDATE_ROOT"), os.Getenv("MD_REAL_V66_REVIEW_DRAFT")
	if root == "" || draftPath == "" {
		t.Skip("offline real inputs required")
	}
	draft, e := os.ReadFile(draftPath)
	if e != nil {
		t.Fatal(e)
	}
	const expected = "e1a8d8feda9acc7fbecc4676a792f27929f96fd13069c1203995c57b6835c418"
	if hash(draft) != expected {
		t.Fatal("source draft differs")
	}
	loc := time.FixedZone("UTC+8", 8*3600)
	a := time.Date(2026, 9, 20, 0, 0, 0, 0, loc)
	cut := time.Date(2026, 11, 14, 0, 0, 0, 0, loc)
	m := &importMock{objects: map[string]importMockObject{}, free: 500_000_000}
	base := []ImportObject{}
	for i := 0; i < 5; i++ {
		for _, suffix := range []string{".sqlite.gz", ".manifest.json"} {
			key := fmt.Sprintf("active/2026-11-14.%s%s", archive.HourGeneration(cut.Add(time.Duration(i)*time.Hour)), suffix)
			base = append(base, m.add("2026-11-14", key, []byte("synthetic protected "+key)))
		}
	}
	base = append(base, m.add("2026-11-16", "active/2026-11-16."+archive.HourGeneration(cut.Add(48*time.Hour))+".sqlite.gz", []byte("outside reviewed days")))
	p := PlacementReport{Version: "legacy-placement-review-v1", Namespace: importNamespace, CutoverMS: cut.UnixMilli(), StartedAtMS: cut.UnixMilli() + 1000, FinishedAtMS: cut.UnixMilli() + 2000, ObservedRemoteCount: len(base)}
	for i := 0; i < 57; i++ {
		day := a.AddDate(0, 0, i).Format("2006-01-02")
		d := DayPlacement{Day: day, LocalReasons: []string{}, RemoteObjects: []drive.PlacementObject{}, Status: "candidate_for_review"}
		if i >= 55 {
			d.LocalReasons = []string{"cutover_boundary_or_after"}
			d.Status = "blocked"
			for _, o := range base {
				if o.Day == day {
					d.RemoteObjects = append(d.RemoteObjects, drive.PlacementObject{Day: day, Key: o.Key, ID: o.ID})
				}
			}
			sort.Slice(d.RemoteObjects, func(i, j int) bool { return d.RemoteObjects[i].Key < d.RemoteObjects[j].Key })
		} else {
			m.days = append(m.days, day)
		}
		p.Days = append(p.Days, d)
	}
	_, ph, e := CanonicalPlacementReport(p)
	if e != nil {
		t.Fatal(e)
	}
	stage := filepath.Join(t.TempDir(), "batch")
	ctx := context.Background()
	start := time.Now()
	sha, e := PrepareV66Import(ctx, stage, root, draft, expected, p, ph, base, strings.Repeat("c", 40), time.UnixMilli(p.FinishedAtMS+1000))
	if e != nil {
		t.Fatal(e)
	}
	plan, e := readPlan(stage, sha)
	if e != nil {
		t.Fatal(e)
	}
	if len(plan.Days) != 55 || m.puts != 0 || len(m.objects) != len(base) {
		t.Fatal("prepare changed remote")
	}
	t.Logf("PREPARED 55 days %d bytes plan %s elapsed %s", plan.Bytes, sha, time.Since(start))
	run := func() (int, error) { return RunV66Import(ctx, stage, sha, "synthetic-lease", m, m) }
	reject := func(label string) {
		t.Helper()
		before := m.puts
		if n, e := run(); e == nil || n != 0 || m.puts != before {
			t.Fatalf("%s not rejected: %d %v writes %d", label, n, e, m.puts-before)
		}
		t.Log("REJECT", label)
	}
	if _, e = RunV66Import(ctx, stage, strings.Repeat("b", 64), "synthetic-lease", m, m); e == nil || m.puts != 0 {
		t.Fatal("wrong plan digest")
	}
	m.blocked = true
	reject("writer active")
	m.blocked = false
	m.wrongLease = true
	reject("wrong lease")
	m.wrongLease = false
	m.partial = true
	reject("incomplete inventory")
	m.partial = false
	m.stale = true
	reject("stale observation")
	m.stale = false
	m.localConflict = true
	reject("local collision")
	m.localConflict = false
	m.free = 1
	reject("quota")
	m.free = 500_000_000
	badKey := "historical/2026/09/2026-09-21.r2.sqlite.gz"
	m.add("2026-09-21", badKey, []byte("unexpected"))
	reject("remote collision")
	delete(m.objects, badKey)
	old := m.objects[base[0].Key]
	bad := old
	bad.b = []byte("tampered")
	m.objects[base[0].Key] = bad
	reject("protected bytes changed")
	m.objects[base[0].Key] = old
	first := plan.Days[0]
	dk, mk := importKeys(first.Day)
	m.add(first.Day, mk, []byte("orphan"))
	reject("orphan manifest")
	delete(m.objects, mk)
	// Verify every prepared file before writes, even a late-day corruption.
	fpath := importPath(stage, plan.Days[54].Day)
	b, e := os.ReadFile(fpath)
	if e != nil {
		t.Fatal(e)
	}
	badBytes := append([]byte(nil), b...)
	badBytes[0] ^= 1
	if e = os.WriteFile(fpath, badBytes, 0600); e != nil {
		t.Fatal(e)
	}
	reject("late prepared file corrupted")
	if e = os.WriteFile(fpath, b, 0600); e != nil {
		t.Fatal(e)
	}
	lock, e := os.OpenFile(filepath.Join(stage, "run.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		t.Fatal(e)
	}
	if e = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		t.Fatal(e)
	}
	reject("concurrent local process")
	syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	lock.Close()
	// Ambiguous first data creation, followed by ambiguous manifest creation.
	m.failKey = dk
	n, e := run()
	if e == nil || n != 0 || m.creates != 1 || len(m.objects) != len(base)+1 {
		t.Fatal("data interruption", n, e, m.creates)
	}
	dataID := m.objects[dk].o.ID
	t.Log("INTERRUPT data committed", dataID)
	m.failKey = mk
	n, e = run()
	if e == nil || n != 0 || m.creates != 2 || m.objects[dk].o.ID != dataID {
		t.Fatal("manifest interruption", n, e, m.creates)
	}
	metaID := m.objects[mk].o.ID
	t.Log("INTERRUPT manifest committed", metaID)
	// First pair already exists, so completion is GET-only; then publish 54 days.
	before := m.puts
	start = time.Now()
	n, e = run()
	if e != nil || n != 55 || m.creates != 110 || m.puts-before != 108 || len(m.objects) != len(base)+110 || m.objects[dk].o.ID != dataID || m.objects[mk].o.ID != metaID {
		t.Fatal("batch completion", n, e, m.creates, m.puts-before)
	}
	t.Logf("PUBLISHED 55 days 1042893 rows, 110 new objects, %s", time.Since(start))
	for _, o := range base {
		if m.objects[o.Key].o != o {
			t.Fatal("protected identity changed")
		}
	}
	ids := map[string]string{}
	for k, x := range m.objects {
		ids[k] = x.o.ID
	}
	before = m.puts
	start = time.Now()
	n, e = run()
	if e != nil || n != 55 || m.puts != before {
		t.Fatal("GET-only replay", n, e, m.puts-before)
	}
	after := map[string]string{}
	for k, x := range m.objects {
		after[k] = x.o.ID
	}
	if !reflect.DeepEqual(ids, after) {
		t.Fatal("replay changed inventory")
	}
	t.Logf("REPLAY 55 days GET-only %s, total puts=%d creates=%d GET=%d gate checks=%d", time.Since(start), m.puts, m.creates, m.gets, m.checks)
	// Tampering with a completed record stops the entire process without a write.
	rpath := filepath.Join(stage, "progress", first.Day+".json")
	record, e := os.ReadFile(rpath)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(rpath, []byte("{}"), 0600); e != nil {
		t.Fatal(e)
	}
	reject("corrupt progress")
	if e = os.WriteFile(rpath, record, 0600); e != nil {
		t.Fatal(e)
	}
	t.Log("PASS all 55 synthetic publications and complete read-only replay; 2 held days never written; 11 protected objects unchanged")
}

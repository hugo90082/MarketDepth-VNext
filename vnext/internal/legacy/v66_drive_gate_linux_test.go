//go:build linux && sqlite_integration

package legacy

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive/drive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

type strictReaderStub struct {
	inv   drive.ImportInventory
	fail  bool
	calls int
}

func (r *strictReaderStub) PlacementNamespace() string { return r.inv.Namespace }
func (r *strictReaderStub) InspectImportInventory(context.Context) (drive.ImportInventory, error) {
	r.calls++
	if r.fail {
		return drive.ImportInventory{}, errors.New("mock unavailable")
	}
	return r.inv, nil
}
func createStoppedRoot(t *testing.T, parent, name string) string {
	t.Helper()
	root := filepath.Join(parent, name)
	m, e := store.NewManager(root, store.SQLiteOpener)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(root, ".marketdepth-vnext-staging"), []byte("MARKETDEPTH-VNEXT-STAGING-1\n"), 0600); e != nil {
		t.Fatal(e)
	}
	j, e := m.OpenCatalog(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	if e = j.Close(); e != nil {
		t.Fatal(e)
	}
	if e = m.Close(); e != nil {
		t.Fatal(e)
	}
	return root
}
func TestStoppedDriveReviewMultipleRoots(t *testing.T) {
	ctx := context.Background()
	parent := t.TempDir()
	a := createStoppedRoot(t, parent, "a")
	b := createStoppedRoot(t, parent, "b")
	lock := filepath.Join(parent, "lock")
	if e := os.Mkdir(lock, 0700); e != nil {
		t.Fatal(e)
	}
	s, e := OpenStoppedDriveReview(ctx, lock, []string{a, b})
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	if e = os.WriteFile(filepath.Join(b, "2026-09-22.sqlite"), []byte("collision"), 0600); e != nil {
		t.Fatal(e)
	}
	cut := time.Date(2026, 11, 14, 0, 0, 0, 0, time.FixedZone("UTC+8", 8*3600)).UnixMilli()
	p, e := s.InspectLegacyPlacement(ctx, []string{"2026-09-21", "2026-09-22"}, cut)
	if e != nil || len(p) != 2 || !p[0].LocalClear || p[1].LocalClear {
		t.Fatal(p, e)
	}
	if other, e := OpenStoppedDriveReview(ctx, lock, []string{a, b}); e == nil {
		other.Close()
		t.Fatal("concurrent review accepted")
	}
}
func TestRealPlanDriveGate(t *testing.T) {
	stage := os.Getenv("MD_DRIVE_GATE_QA_STAGE")
	if stage == "" {
		t.Skip("private previous synthetic QA plan required")
	}
	const want = "75918607114f70736d751d9763f6beb2e53001d4f11a94e5d9eab09fb746d788"
	p, e := readPlan(stage, want)
	if e != nil {
		t.Fatal(e)
	}
	ctx := context.Background()
	dir := t.TempDir()
	a := createStoppedRoot(t, dir, "a")
	b := createStoppedRoot(t, dir, "b")
	lock := filepath.Join(dir, "lock")
	if e = os.Mkdir(lock, 0700); e != nil {
		t.Fatal(e)
	}
	s, e := OpenStoppedDriveReview(ctx, lock, []string{a, b})
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	inv := drive.ImportInventory{Namespace: importNamespace, RootID: "root_id", Folders: []drive.ImportFolder{{Key: "dir/active", ID: "active_id", Parent: "root_id"}, {Key: "root", ID: "root_id", Parent: "my_root"}}, Objects: []drive.ImportInventoryObject{}, FreeBytes: 500000000, ObservedAt: time.Now()}
	for _, o := range p.Baseline {
		inv.Objects = append(inv.Objects, drive.ImportInventoryObject{Day: o.Day, Key: o.Key, ID: o.ID, Size: o.Size, SHA256: o.SHA256})
	}
	sort.Slice(inv.Objects, func(i, j int) bool { return inv.Objects[i].Key < inv.Objects[j].Key })
	_, h, e := CanonicalDriveInventory(inv)
	if e != nil {
		t.Fatal(e)
	}
	r := &strictReaderStub{inv: inv}
	blocked := false
	fence := func(context.Context) error {
		if blocked {
			return errors.New("external fence lost")
		}
		return nil
	}
	if _, e = newDriveImportGate(s, r, p, inv, h, nil); e == nil {
		t.Fatal("missing fence accepted")
	}
	if _, e = newDriveImportGate(s, r, p, inv, "bad", fence); e == nil {
		t.Fatal("wrong reviewed digest accepted")
	}
	g, e := newDriveImportGate(s, r, p, inv, h, fence)
	if e != nil {
		t.Fatal(e)
	}
	id := g.LeaseID()
	if o, e := g.Observe(ctx, id); e != nil || len(o.ClearLocalDays) != 55 || len(o.Objects) != 11 || !o.Complete {
		t.Fatal(o, e)
	}
	reject := func(label string) {
		t.Helper()
		if _, e := g.Observe(ctx, id); e == nil {
			t.Fatalf("accepted %s", label)
		}
		t.Log("REJECT", label)
	}
	blocked = true
	reject("external fence lost")
	blocked = false
	r.fail = true
	reject("remote unavailable")
	r.fail = false
	r.inv.ObservedAt = time.Now().Add(-2 * time.Minute)
	reject("stale inventory")
	r.inv.ObservedAt = time.Now()
	r.inv.RootID = "other"
	reject("changed root")
	r.inv.RootID = inv.RootID
	r.inv.Folders = append(append([]drive.ImportFolder{}, inv.Folders...), drive.ImportFolder{Key: "dir/catalog", ID: "unexpected", Parent: "root_id"})
	reject("unexpected folder")
	r.inv.Folders = inv.Folders
	r.inv.Folders = []drive.ImportFolder{{Key: "root", ID: "root_id", Parent: "my_root"}}
	reject("missing protected folder")
	r.inv.Folders = inv.Folders
	// A planned ancestor may be created, and then must remain pinned during this session.
	r.inv.Folders = append(append([]drive.ImportFolder{}, inv.Folders...), drive.ImportFolder{Key: "dir/historical", ID: "new_folder", Parent: "root_id"})
	if _, e = g.Observe(ctx, id); e != nil {
		t.Fatal(e)
	}
	r.inv.Folders[len(r.inv.Folders)-1].ID = "replaced"
	reject("new folder identity changed")
	r.inv.Folders[len(r.inv.Folders)-1].ID = "new_folder"
	path := filepath.Join(b, "2026-09-21.sqlite")
	if e = os.WriteFile(path, []byte("collision"), 0600); e != nil {
		t.Fatal(e)
	}
	reject("second stopped root collision")
	if e = os.Remove(path); e != nil {
		t.Fatal(e)
	}
	if _, e = g.Observe(ctx, "wrong"); e == nil {
		t.Fatal("wrong lease accepted")
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	reject("closed lease")
}

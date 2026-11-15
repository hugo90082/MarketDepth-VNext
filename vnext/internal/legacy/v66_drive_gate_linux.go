//go:build linux && sqlite_integration

package legacy

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive/drive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/lease"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/store"
)

// StoppedDriveReview holds the namespace and existing root locks. The known
// roots MUST be independently inventoried by the operator. This cannot
// discover another host, non-cooperating writer or inaccessible Drive files.
type StoppedDriveReview struct {
	namespace *lease.Lock
	locals    []*store.StoppedPlacement
	roots     []string
}

func OpenStoppedDriveReview(ctx context.Context, lockDir string, roots []string) (out *StoppedDriveReview, err error) {
	if len(roots) == 0 || len(roots) > 64 {
		return nil, errors.New("explicit stopped root inventory required")
	}
	paths := append([]string{}, roots...)
	sort.Strings(paths)
	for i, p := range paths {
		if !filepath.IsAbs(p) || filepath.Clean(p) != p || p == lockDir || (i > 0 && p == paths[i-1]) {
			return nil, errors.New("invalid or duplicate stopped root")
		}
		r, e := filepath.Rel(p, lockDir)
		if e != nil || r == "." || r != ".." && !strings.HasPrefix(r, ".."+string(os.PathSeparator)) {
			return nil, errors.New("lock directory must be outside data roots")
		}
	}
	l, e := lease.AcquireNamespace(lockDir)
	if e != nil {
		return nil, e
	}
	s := &StoppedDriveReview{namespace: l, roots: paths}
	defer func() {
		if err != nil {
			s.Close()
		}
	}()
	for _, p := range paths {
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		x, e := store.OpenStoppedPlacement(ctx, p)
		if e != nil {
			return nil, e
		}
		s.locals = append(s.locals, x)
	}
	return s, nil
}
func (s *StoppedDriveReview) Close() error {
	if s == nil {
		return nil
	}
	var e error
	for i := len(s.locals) - 1; i >= 0; i-- {
		e = errors.Join(e, s.locals[i].Close())
	}
	s.locals = nil
	return errors.Join(e, s.namespace.Close())
}
func (s *StoppedDriveReview) InspectLegacyPlacement(ctx context.Context, days []string, cutover int64) ([]store.LegacyPlacement, error) {
	if s == nil || len(s.locals) == 0 {
		return nil, errors.New("stopped roots required")
	}
	if e := s.namespace.Check(s.namespace.ID()); e != nil {
		return nil, e
	}
	out := []store.LegacyPlacement{}
	for _, p := range s.locals {
		a, e := p.InspectLegacyPlacement(ctx, days, cutover)
		if e != nil {
			return nil, e
		}
		if len(out) == 0 {
			out = a
			continue
		}
		if len(a) != len(out) {
			return nil, errors.New("placement length differs")
		}
		for i, x := range a {
			if x.Day != out[i].Day {
				return nil, errors.New("placement date differs")
			}
			m := map[string]bool{}
			for _, k := range append(out[i].Reasons, x.Reasons...) {
				m[k] = true
			}
			rs := []string{}
			for k := range m {
				rs = append(rs, k)
			}
			sort.Strings(rs)
			out[i].Reasons = rs
			out[i].LocalClear = len(rs) == 0
		}
	}
	return out, s.namespace.Check(s.namespace.ID())
}

type strictInventoryReader interface {
	PlacementNamespace() string
	InspectImportInventory(context.Context) (drive.ImportInventory, error)
}

type importPlacementRemote struct {
	reader    strictInventoryReader
	inventory drive.ImportInventory
}

func (r *importPlacementRemote) PlacementNamespace() string { return r.reader.PlacementNamespace() }
func (r *importPlacementRemote) DiscoverPlacementObjects(ctx context.Context) ([]drive.PlacementObject, error) {
	i, e := r.reader.InspectImportInventory(ctx)
	if e != nil {
		return nil, e
	}
	r.inventory = i
	out := []drive.PlacementObject{}
	for _, o := range i.Objects {
		out = append(out, drive.PlacementObject{Day: o.Day, Key: o.Key, ID: o.ID})
	}
	return out, nil
}
func inventoryObjects(i drive.ImportInventory) []ImportObject {
	out := []ImportObject{}
	for _, o := range i.Objects {
		out = append(out, ImportObject{Day: o.Day, Key: o.Key, ID: o.ID, Size: o.Size, SHA256: o.SHA256})
	}
	return out
}
func CanonicalDriveInventory(i drive.ImportInventory) ([]byte, string, error) {
	if i.Namespace != importNamespace || i.RootID == "" || i.Folders == nil || i.Objects == nil || i.FreeBytes < 0 || i.ObservedAt.IsZero() {
		return nil, "", errors.New("invalid inventory report")
	}
	if _, e := inventoryMap(inventoryObjects(i)); e != nil {
		return nil, "", e
	}
	seen := map[string]bool{}
	ids := map[string]bool{}
	last := ""
	root := false
	for _, f := range i.Folders {
		if f.Key <= last || f.ID == "" || f.Parent == "" || seen[f.Key] || ids[f.ID] {
			return nil, "", errors.New("invalid inventory folder")
		}
		last = f.Key
		seen[f.Key] = true
		ids[f.ID] = true
		if f.Key == "root" && f.ID == i.RootID {
			root = true
		}
	}
	if !root {
		return nil, "", errors.New("missing inventory root")
	}
	last = ""
	for _, o := range i.Objects {
		if o.Key <= last || ids[o.ID] {
			return nil, "", errors.New("invalid inventory object order or identity")
		}
		last = o.Key
	}
	b, e := json.Marshal(i)
	if e != nil {
		return nil, "", e
	}
	return b, hash(b), nil
}

// ReviewDrivePlacement performs only GETs and read-only SQLite inspections.
// The result is advisory, expires on release of the locks, and is not approval.
func (s *StoppedDriveReview) ReviewDrivePlacement(ctx context.Context, r *drive.RecoveryReader, days []string, cutover int64) (PlacementReport, drive.ImportInventory, error) {
	var z drive.ImportInventory
	remote := &importPlacementRemote{reader: r}
	p, e := InspectPlacement(ctx, s, remote, days, cutover)
	if e != nil {
		return p, z, e
	}
	if _, _, e = CanonicalDriveInventory(remote.inventory); e != nil {
		return p, z, e
	}
	return p, remote.inventory, nil
}

// ExternalWriterFence must independently enforce the operator's verified
// exclusive-writer procedure (including older binaries and other hosts).
// There is intentionally no default, always-true or CLI boolean adapter.
// The local locks alone are insufficient for that claim.
type ExternalWriterFence func(context.Context) error

type DriveImportGate struct {
	stopped        *StoppedDriveReview
	reader         strictInventoryReader
	external       ExternalWriterFence
	plan           V66ImportPlan
	rootID         string
	folders        map[string]drive.ImportFolder
	allowedFolders map[string]bool
}

func NewDriveImportGate(s *StoppedDriveReview, c *drive.Client, p V66ImportPlan, reviewed drive.ImportInventory, reviewedSHA string, external ExternalWriterFence) (*DriveImportGate, error) {
	if c == nil {
		return nil, errors.New("Drive client required")
	}
	return newDriveImportGate(s, c.RecoveryReader(), p, reviewed, reviewedSHA, external)
}
func newDriveImportGate(s *StoppedDriveReview, reader strictInventoryReader, p V66ImportPlan, reviewed drive.ImportInventory, reviewedSHA string, external ExternalWriterFence) (*DriveImportGate, error) {
	if s == nil || reader == nil || external == nil {
		return nil, errors.New("stopped roots, Drive client and independent external fence required")
	}
	if e := s.namespace.Check(s.namespace.ID()); e != nil {
		return nil, e
	}
	if e := validatePlan(p); e != nil {
		return nil, e
	}
	_, h, e := CanonicalDriveInventory(reviewed)
	if e != nil || h != reviewedSHA {
		return nil, errors.New("reviewed inventory digest differs")
	}
	a, e := inventoryMap(inventoryObjects(reviewed))
	if e != nil {
		return nil, e
	}
	b, e := inventoryMap(p.Baseline)
	if e != nil || !reflect.DeepEqual(a, b) {
		return nil, errors.New("reviewed inventory differs from plan baseline")
	}
	g := &DriveImportGate{stopped: s, reader: reader, external: external, plan: p, rootID: reviewed.RootID, folders: map[string]drive.ImportFolder{}, allowedFolders: map[string]bool{}}
	if g.reader.PlacementNamespace() != p.Namespace {
		return nil, errors.New("Drive namespace differs")
	}
	for _, f := range reviewed.Folders {
		g.folders[f.Key] = f
	}
	for _, d := range p.Days {
		g.allowedFolders["dir/historical"] = true
		g.allowedFolders["dir/historical/"+d.Day[:4]] = true
		g.allowedFolders["dir/historical/"+d.Day[:4]+"/"+d.Day[5:7]] = true
	}
	return g, nil
}
func (g *DriveImportGate) LeaseID() string { return g.stopped.namespace.ID() }
func (g *DriveImportGate) Observe(ctx context.Context, id string) (ImportObservation, error) {
	var z ImportObservation
	if g == nil {
		return z, errors.New("Drive gate required")
	}
	if e := g.stopped.namespace.Check(id); e != nil {
		return z, e
	}
	if e := g.external(ctx); e != nil {
		return z, e
	}
	days := []string{}
	for _, d := range g.plan.Days {
		days = append(days, d.Day)
	}
	before, e := g.stopped.InspectLegacyPlacement(ctx, days, g.plan.CutoverMS)
	if e != nil {
		return z, e
	}
	for _, d := range before {
		if !d.LocalClear {
			return z, errors.New("local historical placement collision")
		}
	}
	inv, e := g.reader.InspectImportInventory(ctx)
	if e != nil {
		return z, e
	}
	if inv.RootID != g.rootID || inv.Namespace != g.plan.Namespace {
		return z, errors.New("namespace root changed")
	}
	found := map[string]drive.ImportFolder{}
	for _, f := range inv.Folders {
		old, ok := g.folders[f.Key]
		if ok && old != f || !ok && !g.allowedFolders[f.Key] {
			return z, errors.New("folder identity changed or unexpected folder")
		}
		found[f.Key] = f
	}
	for k := range g.folders {
		if _, ok := found[k]; !ok {
			return z, errors.New("protected folder disappeared")
		}
	}
	after, e := g.stopped.InspectLegacyPlacement(ctx, days, g.plan.CutoverMS)
	if e != nil || !reflect.DeepEqual(before, after) {
		return z, errors.New("local placement changed")
	}
	if e = g.external(ctx); e != nil {
		return z, e
	}
	if e = g.stopped.namespace.Check(id); e != nil {
		return z, e
	}
	if inv.ObservedAt.After(time.Now().Add(time.Second)) || time.Since(inv.ObservedAt) > time.Minute {
		return z, errors.New("inventory stale")
	}
	g.folders = found
	return ImportObservation{Namespace: inv.Namespace, LeaseID: id, WritersStopped: true, Complete: true, ObservedAt: inv.ObservedAt, ClearLocalDays: days, Objects: inventoryObjects(inv), FreeBytes: inv.FreeBytes}, nil
}

// RunDriveV66Import is the real adapter entry point for a future approved
// operator workflow. It does not trash or register catalog revisions. The
// same private Drive reservation directory must survive interruption.
// Do not expose this through a CLI until external fencing is established.
func RunDriveV66Import(ctx context.Context, root, approvedPlanSHA string, c *drive.Client, s *StoppedDriveReview, reviewed drive.ImportInventory, reviewedSHA string, external ExternalWriterFence) (int, error) {
	p, e := InspectV66Import(ctx, root, approvedPlanSHA)
	if e != nil {
		return 0, e
	}
	g, e := NewDriveImportGate(s, c, p, reviewed, reviewedSHA, external)
	if e != nil {
		return 0, e
	}
	// Bind before the first possible write, and verify identity on every scan.
	if _, e = g.Observe(ctx, g.LeaseID()); e != nil {
		return 0, e
	}
	if e = c.BindImportState(root, approvedPlanSHA, reviewedSHA); e != nil {
		return 0, e
	}
	g.external = func(ctx context.Context) error {
		if e := external(ctx); e != nil {
			return e
		}
		return c.BindImportState(root, approvedPlanSHA, reviewedSHA)
	}
	c.EnableRecoveryReads()
	return RunV66Import(ctx, root, approvedPlanSHA, g.LeaseID(), g, c)
}

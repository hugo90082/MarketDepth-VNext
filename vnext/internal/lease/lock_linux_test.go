//go:build linux

package lease

import (
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/runtimeprofile"
	"os"
	"path/filepath"
	"testing"
)

func TestNamespaceLease(t *testing.T) {
	d := t.TempDir()
	os.Chmod(d, 0700)
	a, e := AcquireNamespace(d)
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	if b, e := AcquireNamespace(d); e == nil {
		b.Close()
		t.Fatal("second owner")
	}
	if e = a.Check(a.ID()); e != nil {
		t.Fatal(e)
	}
	if e = a.Check("wrong"); e == nil {
		t.Fatal("wrong lease")
	}
	if e = a.Close(); e != nil {
		t.Fatal(e)
	}
	b, e := AcquireNamespace(d)
	if e != nil {
		t.Fatal(e)
	}
	defer b.Close()
	if b.ID() == a.ID() {
		t.Fatal("reused lease id")
	}
	if e = os.Rename(filepath.Join(d, NamespaceLock), filepath.Join(d, "old")); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(d, NamespaceLock), nil, 0600); e != nil {
		t.Fatal(e)
	}
	if e = b.Check(b.ID()); e == nil {
		t.Fatal("replacement undetected")
	}
}
func TestStoppedRootLock(t *testing.T) {
	d := t.TempDir()
	os.Chmod(d, 0700)
	if a, e := AcquireStoppedRoot(d); e == nil {
		a.Close()
		t.Fatal("created missing lock")
	}
	if e := os.WriteFile(filepath.Join(d, ".writer.lock"), nil, 0600); e != nil {
		t.Fatal(e)
	}
	a, e := AcquireStoppedRoot(d)
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	if b, e := AcquireStoppedRoot(d); e == nil {
		b.Close()
		t.Fatal("second root owner")
	}
}

func TestProfileNamespaceIsolation(t *testing.T) {
	d := t.TempDir()
	if e := os.Chmod(d, 0700); e != nil {
		t.Fatal(e)
	}
	a, e := AcquireProfileNamespace(d, runtimeprofile.Staging)
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	b, e := AcquireProfileNamespace(d, runtimeprofile.Production)
	if e != nil {
		t.Fatal(e)
	}
	defer b.Close()
	if x, e := AcquireProfileNamespace(d, runtimeprofile.Production); e == nil {
		x.Close()
		t.Fatal("two production locks")
	}
	if x, e := AcquireProfileNamespace(d, 0); e == nil {
		x.Close()
		t.Fatal("invalid profile lock")
	}
}

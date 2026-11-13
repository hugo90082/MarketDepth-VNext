//go:build linux

package archive

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMeasureAllocatedHardlinkSparseAndSymlink(t *testing.T) {
	root := t.TempDir()
	f, e := os.Create(filepath.Join(root, "data.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	if e = f.Truncate(100_000_000); e != nil {
		f.Close()
		t.Fatal(e)
	}
	if _, e = f.WriteAt([]byte("marketdepth"), 100); e != nil {
		f.Close()
		t.Fatal(e)
	}
	if e = f.Close(); e != nil {
		t.Fatal(e)
	}
	a, e := MeasureAllocated(root)
	if e != nil || a <= 0 || a >= 100_000_000 {
		t.Fatal(a, e)
	}
	if e = os.Link(filepath.Join(root, "data.sqlite"), filepath.Join(root, "duplicate")); e != nil {
		t.Fatal(e)
	}
	b, e := MeasureAllocated(root)
	if e != nil || b-a > 65536 {
		t.Fatal(a, b, e)
	}
	if e = os.Symlink(t.TempDir(), filepath.Join(root, "unsafe")); e != nil {
		t.Fatal(e)
	}
	if _, e = MeasureAllocated(root); e == nil {
		t.Fatal("symlink accepted")
	}
}

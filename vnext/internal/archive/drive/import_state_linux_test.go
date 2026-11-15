//go:build linux

package drive

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImportStateBoundToPlanAndDirectory(t *testing.T) {
	root := t.TempDir()
	os.Chmod(root, 0700)
	state := filepath.Join(root, "drive-state")
	if e := os.Mkdir(state, 0700); e != nil {
		t.Fatal(e)
	}
	c, e := NewClient(staticToken("fake"), "MarketDepth-VNext-staging", state)
	if e != nil {
		t.Fatal(e)
	}
	a, b := strings.Repeat("a", 64), strings.Repeat("b", 64)
	if e = c.BindImportState(root, a, b); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(state, "reservation"), []byte("id"), 0600); e != nil {
		t.Fatal(e)
	}
	c, e = NewClient(staticToken("fake"), "MarketDepth-VNext-staging", state)
	if e != nil {
		t.Fatal(e)
	}
	if e = c.BindImportState(root, a, b); e != nil {
		t.Fatal(e)
	}
	if e = c.BindImportState(root, b, a); e == nil {
		t.Fatal("changed approval accepted")
	}
	if e = os.Rename(state, state+"-old"); e != nil {
		t.Fatal(e)
	}
	if e = os.Mkdir(state, 0700); e != nil {
		t.Fatal(e)
	}
	if e = c.BindImportState(root, a, b); e == nil {
		t.Fatal("replaced reservation directory accepted")
	}
}

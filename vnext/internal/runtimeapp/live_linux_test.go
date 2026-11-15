//go:build linux && live_ws && sqlite_integration && secure_auth

package runtimeapp

import (
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/runtimeprofile"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrepareIsolatedRoot(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "new")
	if e := prepare(runtimeprofile.Staging, root, false); e == nil {
		t.Fatal("unmarked accepted")
	}
	if e := prepare(runtimeprofile.Staging, root, true); e != nil {
		t.Fatal(e)
	}
	if e := prepare(runtimeprofile.Staging, root, false); e != nil {
		t.Fatal(e)
	}
	if e := prepare(runtimeprofile.Staging, root, true); e == nil {
		t.Fatal("existing root accepted for init")
	}
	n, markerText := runtimeprofile.Production.Marker()
	foreign := filepath.Join(root, n)
	if e := os.WriteFile(foreign, []byte(markerText), 0600); e != nil {
		t.Fatal(e)
	}
	if e := prepare(runtimeprofile.Staging, root, false); e == nil {
		t.Fatal("conflicting marker accepted")
	}
	if e := os.Remove(foreign); e != nil {
		t.Fatal(e)
	}
	old := filepath.Join(base, "legacy")
	os.Mkdir(old, 0700)
	os.WriteFile(filepath.Join(old, "old.sqlite"), []byte("original"), 0600)
	if e := prepare(runtimeprofile.Staging, old, true); e == nil {
		t.Fatal("old root accepted")
	}
	if e := prepare(runtimeprofile.Staging, old, false); e == nil {
		t.Fatal("unmarked old root accepted")
	}
	b, e := os.ReadFile(filepath.Join(old, "old.sqlite"))
	if e != nil || string(b) != "original" {
		t.Fatal("old data modified")
	}
	link := filepath.Join(base, "link")
	if e := os.Symlink(root, link); e != nil {
		t.Fatal(e)
	}
	if e := prepare(runtimeprofile.Staging, link, false); e == nil {
		t.Fatal("symlink root accepted")
	}
	if e := prepare(runtimeprofile.Staging, filepath.Join(link, "new"), true); e == nil {
		t.Fatal("symlink parent accepted")
	}
}

func TestDriveCredentialCannotBeInsideDataRoot(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "marketdepth.oauth.json")
	if e := os.WriteFile(p, []byte("{}"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e := configuredDrive(runtimeprofile.Staging, root, p, strings.Repeat("a", 40)); e == nil || !strings.Contains(e.Error(), "outside market-data root") {
		t.Fatal(e)
	}
}

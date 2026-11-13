//go:build linux && live_ws && sqlite_integration && secure_auth

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrepareIsolatedRoot(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "new")
	if e := prepare(root, false); e == nil {
		t.Fatal("unmarked accepted")
	}
	if e := prepare(root, true); e != nil {
		t.Fatal(e)
	}
	if e := prepare(root, false); e != nil {
		t.Fatal(e)
	}
	if e := prepare(root, true); e == nil {
		t.Fatal("existing root accepted for init")
	}
	old := filepath.Join(base, "legacy")
	os.Mkdir(old, 0700)
	os.WriteFile(filepath.Join(old, "old.sqlite"), []byte("original"), 0600)
	if e := prepare(old, true); e == nil {
		t.Fatal("old root accepted")
	}
	if e := prepare(old, false); e == nil {
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
	if e := prepare(link, false); e == nil {
		t.Fatal("symlink root accepted")
	}
	if e := prepare(filepath.Join(link, "new"), true); e == nil {
		t.Fatal("symlink parent accepted")
	}
}

func TestDriveCredentialCannotBeInsideDataRoot(t *testing.T) {
	root := t.TempDir()
	p := filepath.Join(root, "marketdepth.oauth.json")
	if e := os.WriteFile(p, []byte("{}"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e := stagingDrive(root, p, strings.Repeat("a", 40)); e == nil || !strings.Contains(e.Error(), "outside market-data root") {
		t.Fatal(e)
	}
}

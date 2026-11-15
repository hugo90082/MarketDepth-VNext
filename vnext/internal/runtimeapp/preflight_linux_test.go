//go:build linux && live_ws && sqlite_integration && secure_auth

package runtimeapp

import (
	"context"
	"encoding/base64"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/runtimeprofile"
	"golang.org/x/crypto/bcrypt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProductionPreflightNoMutation(t *testing.T) {
	base := t.TempDir()
	old := filepath.Join(base, "old")
	locks := filepath.Join(base, "locks")
	for _, p := range []string{old, locks} {
		if e := os.Mkdir(p, 0700); e != nil {
			t.Fatal(e)
		}
	}
	cred := filepath.Join(base, "private.json")
	if e := os.WriteFile(cred, []byte(`{"client_id":"fake","client_secret":"fake","refresh_token":"fake","scope":"https://www.googleapis.com/auth/drive.file"}`), 0600); e != nil {
		t.Fatal(e)
	}
	k := base64.StdEncoding.EncodeToString(make([]byte, 32))
	h, e := bcrypt.GenerateFromPassword([]byte("test-only"), 10)
	if e != nil {
		t.Fatal(e)
	}
	c := ProductionConfig{Root: filepath.Join(base, "future"), Listen: "127.0.0.1:18082", Origin: "https://example.invalid", Credentials: cred, Producer: strings.Repeat("a", 40), LeaseDir: locks, ProtectedRoots: []string{old}}
	p, e := CheckProduction(c, k, string(h))
	if e != nil || !p.LocalConfigValid || p.ProductionReady || p.ActivationAllowed || p.NetworkChecked || p.Namespace != "MarketDepth-VNext" {
		t.Fatal(p, e)
	}
	if _, e = os.Stat(c.Root); !os.IsNotExist(e) {
		t.Fatal("created data root")
	}
	if x, e := os.ReadDir(locks); e != nil || len(x) != 0 {
		t.Fatal("created lock", e)
	}
	for _, mut := range []func(*ProductionConfig){func(x *ProductionConfig) { x.Root = old }, func(x *ProductionConfig) { x.Root = filepath.Join(old, "nested") }, func(x *ProductionConfig) { x.ProtectedRoots = nil }, func(x *ProductionConfig) { x.Listen = "0.0.0.0:80" }, func(x *ProductionConfig) { x.Origin = "http://example.invalid" }, func(x *ProductionConfig) { x.Producer = "bad" }, func(x *ProductionConfig) { x.LeaseDir = old }, func(x *ProductionConfig) { x.Root = locks }} {
		b := c
		mut(&b)
		if _, e = CheckProduction(b, k, string(h)); e == nil {
			t.Fatal("accepted invalid config", b.Root)
		}
	}
	if _, e = CheckProduction(c, "bad", string(h)); e == nil {
		t.Fatal("accepted invalid auth")
	}
	if e = prepare(runtimeprofile.Staging, c.Root, true); e != nil {
		t.Fatal(e)
	}
	if _, e = CheckProduction(c, k, string(h)); e == nil {
		t.Fatal("accepted staging root")
	}
	if e = run(context.Background(), runtimeprofile.Production, c.Root, c.Listen, c.Origin, false, cred, c.Producer, false, false, false); e == nil {
		t.Fatal("enabled production runtime")
	}
	if e = runRecovery(context.Background(), runtimeprofile.Production, filepath.Join(base, "no-create"), cred, c.Producer); e == nil {
		t.Fatal("enabled production recovery")
	}
	if _, e = os.Stat(filepath.Join(base, "no-create")); !os.IsNotExist(e) {
		t.Fatal("created recovery root")
	}
	other := filepath.Join(base, "production")
	if e = prepare(runtimeprofile.Production, other, true); e != nil {
		t.Fatal(e)
	}
	c.Root = other
	if _, e = CheckProduction(c, k, string(h)); e != nil {
		t.Fatal(e)
	}
	if e = prepare(runtimeprofile.Staging, other, false); e == nil {
		t.Fatal("production root accepted as staging")
	}
}

func TestStagingLeaseEnforcedByRuntime(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "new")
	locks := filepath.Join(base, "locks")
	if e := os.Mkdir(locks, 0700); e != nil {
		t.Fatal(e)
	}
	cred := filepath.Join(base, "cred.json")
	if e := os.WriteFile(cred, []byte("fake"), 0600); e != nil {
		t.Fatal(e)
	}
	called := 0
	fn := func() error { called++; return nil }
	if e := withStagingLease(root, cred, "", fn); e == nil || called != 0 {
		t.Fatal("missing lease permitted")
	}
	if e := withStagingLease(locks, cred, locks, fn); e == nil || called != 0 {
		t.Fatal("overlap permitted")
	}
	if e := withStagingLease(root, "", locks, fn); e == nil || called != 0 {
		t.Fatal("lease without Drive")
	}
	if e := withStagingLease(root, cred, locks, func() error {
		if e := withStagingLease(root, cred, locks, fn); e == nil {
			t.Fatal("double namespace writer")
		}
		called++
		return nil
	}); e != nil || called != 1 {
		t.Fatal(e, called)
	}
	if e := withStagingLease(root, cred, locks, fn); e != nil || called != 2 {
		t.Fatal(e, called)
	}
	if _, e := os.Stat(root); !os.IsNotExist(e) {
		t.Fatal("created root during lock check")
	}
}

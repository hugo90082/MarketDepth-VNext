//go:build linux && live_ws && sqlite_integration && secure_auth

package runtimeapp

import (
	"encoding/base64"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive/drive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/httpapi"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/runtimeprofile"
)

// ProductionConfig carries paths, never raw secrets. Preflight is a local
// configuration review, not a release approval, fence or network health test.
type ProductionConfig struct {
	Root, Listen, Origin, Credentials, Producer, LeaseDir string
	ProtectedRoots                                        []string
}
type ProductionPreflight struct {
	Mode              string   `json:"mode"`
	Namespace         string   `json:"namespace"`
	RootState         string   `json:"root_state"`
	LocalConfigValid  bool     `json:"local_config_valid"`
	ProductionReady   bool     `json:"production_ready"`
	ActivationAllowed bool     `json:"activation_allowed"`
	NetworkChecked    bool     `json:"network_checked"`
	RemainingGates    []string `json:"remaining_gates"`
}

func absoluteSafe(p string) bool {
	return p != "" && p != "/" && filepath.IsAbs(p) && filepath.Clean(p) == p
}
func existingCanonical(p string) bool {
	if !absoluteSafe(p) {
		return false
	}
	real, e := filepath.EvalSymlinks(p)
	return e == nil && real == p
}
func overlaps(a, b string) bool {
	within := func(x, y string) bool {
		r, e := filepath.Rel(x, y)
		return e == nil && (r == "." || r != ".." && !strings.HasPrefix(r, ".."+string(os.PathSeparator)))
	}
	return within(a, b) || within(b, a)
}
func ownedPrivate(p string, dir bool) bool {
	s, e := os.Lstat(p)
	if e != nil || s.Mode().Perm()&0077 != 0 {
		return false
	}
	if dir && !s.IsDir() || !dir && !s.Mode().IsRegular() {
		return false
	}
	st, ok := s.Sys().(*syscall.Stat_t)
	return ok && st.Uid == uint32(os.Geteuid()) && (dir || st.Nlink == 1)
}
func markerExists(root string, p runtimeprofile.Profile) (bool, error) {
	n, _ := p.Marker()
	_, e := os.Lstat(filepath.Join(root, n))
	if errors.Is(e, os.ErrNotExist) {
		return false, nil
	}
	return e == nil, e
}

// CheckProduction performs only filesystem reads and local authentication
// configuration validation. It does not acquire/create locks, create a root,
// open SQLite, connect to Drive/venues, start collectors, or print secrets.
func CheckProduction(c ProductionConfig, sessionKeyB64, passwordBcrypt string) (ProductionPreflight, error) {
	var z ProductionPreflight
	if !absoluteSafe(c.Root) || !existingCanonical(filepath.Dir(c.Root)) || !existingCanonical(c.Credentials) || !existingCanonical(c.LeaseDir) || !ownedPrivate(c.Credentials, false) || !ownedPrivate(c.LeaseDir, true) {
		return z, errors.New("canonical production root parent, private external credential and private lease directory required")
	}
	if len(c.ProtectedRoots) == 0 || len(c.ProtectedRoots) > 64 {
		return z, errors.New("explicit protected old/staging root inventory required")
	}
	seen := map[string]bool{}
	for _, p := range c.ProtectedRoots {
		if !existingCanonical(p) || seen[p] {
			return z, errors.New("invalid or duplicate protected root")
		}
		st, e := os.Stat(p)
		if e != nil || !st.IsDir() {
			return z, errors.New("protected root must be an existing directory")
		}
		seen[p] = true
		for _, q := range []string{c.Root, c.Credentials, c.LeaseDir} {
			if overlaps(p, q) {
				return z, errors.New("production paths overlap protected root")
			}
		}
	}
	if overlaps(c.Root, c.Credentials) || overlaps(c.Root, c.LeaseDir) || overlaps(c.LeaseDir, c.Credentials) {
		return z, errors.New("production data, credentials and lease must be separate")
	}
	state := "new_root_required"
	if _, e := os.Lstat(c.Root); e == nil {
		if !existingCanonical(c.Root) || !ownedPrivate(c.Root, true) {
			return z, errors.New("existing production root must be canonical and private")
		}
		old, e := markerExists(c.Root, runtimeprofile.Staging)
		if e != nil || old {
			return z, errors.New("staging marker cannot be used for production")
		}
		n, want := runtimeprofile.Production.Marker()
		p := filepath.Join(c.Root, n)
		if !ownedPrivate(p, false) {
			return z, errors.New("existing root lacks private production marker")
		}
		b, e := os.ReadFile(p)
		if e != nil || string(b) != want {
			return z, errors.New("invalid production marker")
		}
		state = "existing_marked_root_review_required"
	} else if !errors.Is(e, os.ErrNotExist) {
		return z, errors.New("production root inaccessible")
	}
	host, port, e := net.SplitHostPort(c.Listen)
	n, pe := strconv.Atoi(port)
	if e != nil || pe != nil || n < 1 || n > 65535 || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return z, errors.New("numeric loopback listen address required")
	}
	if len(c.Producer) != 40 || strings.Trim(c.Producer, "0123456789abcdef") != "" {
		return z, errors.New("exact producer commit required")
	}
	key, e := base64.StdEncoding.DecodeString(sessionKeyB64)
	if e != nil {
		return z, errors.New("invalid session key encoding")
	}
	if _, e = httpapi.NewBcryptAuth(c.Origin, key, []byte(passwordBcrypt)); e != nil {
		return z, e
	}
	if _, e = drive.LoadCredentials(c.Credentials); e != nil {
		return z, e
	}
	return ProductionPreflight{Mode: "production_preflight_only", Namespace: runtimeprofile.Production.Namespace(), RootState: state, LocalConfigValid: true, ProductionReady: false, ActivationAllowed: false, NetworkChecked: false, RemainingGates: []string{"release_approval_and_writer_fence", "production_namespace_import_and_recovery", "source_backup_and_cutover_mixed_days", "live_and_frontend_tls_acceptance"}}, nil
}

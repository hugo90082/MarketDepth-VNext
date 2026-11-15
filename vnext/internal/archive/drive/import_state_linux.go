//go:build linux

package drive

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

type importStateBinding struct {
	Namespace       string `json:"namespace"`
	PlanSHA256      string `json:"plan_sha256"`
	InventorySHA256 string `json:"inventory_sha256"`
	Device          uint64 `json:"device"`
	Inode           uint64 `json:"inode"`
}

// BindImportState pins a private reservation directory to one reviewed plan.
// The marker is outside that directory: removing/replacing the reservation
// directory cannot silently reset durable preallocated object IDs. No Drive
// calls occur. The caller must already hold its exclusive namespace lease.
func (c *Client) BindImportState(root, planSHA, inventorySHA string) error {
	if c == nil || !digestOK(planSHA) || !digestOK(inventorySHA) {
		return errors.New("valid import approval digests required")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	a, e := filepath.Abs(root)
	if e != nil || a != root || filepath.Clean(root) != root || c.stateDir != filepath.Join(root, "drive-state") {
		return errors.New("reservation directory must be plan root/drive-state")
	}
	for _, d := range []string{root, c.stateDir} {
		r, e := filepath.EvalSymlinks(d)
		if e != nil || r != d {
			return errors.New("unsafe import state path")
		}
		s, e := os.Stat(d)
		if e != nil || !s.IsDir() || s.Mode().Perm()&0077 != 0 || s.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
			return errors.New("private import state directory required")
		}
	}
	s, e := os.Stat(c.stateDir)
	if e != nil {
		return e
	}
	st := s.Sys().(*syscall.Stat_t)
	want := importStateBinding{c.namespace, planSHA, inventorySHA, uint64(st.Dev), st.Ino}
	p := filepath.Join(root, "drive-state-binding.json")
	read := func() error {
		info, e := os.Lstat(p)
		if e != nil {
			return e
		}
		if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 4096 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
			return errors.New("unsafe import state binding")
		}
		b, e := os.ReadFile(p)
		var got importStateBinding
		if e != nil || json.Unmarshal(b, &got) != nil || got != want {
			return errors.New("import state identity or approval changed")
		}
		return nil
	}
	if e = read(); !errors.Is(e, os.ErrNotExist) {
		return e
	}
	entries, e := os.ReadDir(c.stateDir)
	if e != nil || len(entries) != 0 {
		return errors.New("unbound state directory must be empty")
	}
	b, e := json.Marshal(want)
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(root, ".state-binding-")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if _, e = f.Write(b); e != nil {
		return e
	}
	if e = f.Sync(); e != nil {
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = os.Link(f.Name(), p); e != nil {
		return e
	}
	d, e := os.Open(root)
	if e != nil {
		return e
	}
	if e = errors.Join(d.Sync(), d.Close()); e != nil {
		return e
	}
	return read()
}

//go:build linux

// Package lease provides same-host process exclusion. It does NOT fence
// non-cooperating programs, other hosts, or Google Drive clients.
package lease

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"syscall"
)

const NamespaceLock = "MarketDepth-VNext-staging.writer.lock"

type Lock struct {
	mu   sync.Mutex
	f    *os.File
	path string
	id   string
}

func privateDirectory(dir string) error {
	if !filepath.IsAbs(dir) || filepath.Clean(dir) != dir || dir == "/" {
		return errors.New("absolute private lock directory required")
	}
	real, e := filepath.EvalSymlinks(dir)
	if e != nil || real != dir {
		return errors.New("unsafe lock directory")
	}
	st, e := os.Stat(dir)
	if e != nil || !st.IsDir() || st.Mode().Perm()&0077 != 0 || st.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
		return errors.New("lock directory must be private and owned by current user")
	}
	return nil
}
func acquire(dir, name string, create bool) (*Lock, error) {
	if e := privateDirectory(dir); e != nil {
		return nil, e
	}
	p := filepath.Join(dir, name)
	flags := syscall.O_RDWR | syscall.O_NOFOLLOW | syscall.O_CLOEXEC
	if create {
		flags |= syscall.O_CREAT
	}
	fd, e := syscall.Open(p, flags, 0600)
	if e != nil {
		return nil, e
	}
	f := os.NewFile(uintptr(fd), p)
	l := &Lock{f: f, path: p}
	ok := false
	defer func() {
		if !ok {
			f.Close()
		}
	}()
	if e = l.check(); e != nil {
		return nil, e
	}
	if e = syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		return nil, errors.New("writer lock occupied")
	}
	if e = l.check(); e != nil {
		return nil, e
	}
	var b [16]byte
	if _, e = rand.Read(b[:]); e != nil {
		return nil, e
	}
	l.id = hex.EncodeToString(b[:])
	ok = true
	return l, nil
}
func AcquireNamespace(dir string) (*Lock, error)   { return acquire(dir, NamespaceLock, true) }
func AcquireStoppedRoot(dir string) (*Lock, error) { return acquire(dir, ".writer.lock", false) }
func (l *Lock) check() error {
	if l.f == nil {
		return errors.New("lease closed")
	}
	if e := privateDirectory(filepath.Dir(l.path)); e != nil {
		return e
	}
	a, e := l.f.Stat()
	if e != nil {
		return e
	}
	b, e := os.Lstat(l.path)
	if e != nil || !a.Mode().IsRegular() || !b.Mode().IsRegular() || a.Mode().Perm()&0077 != 0 || a.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || a.Sys().(*syscall.Stat_t).Nlink != 1 || !os.SameFile(a, b) {
		return errors.New("lock identity changed")
	}
	return nil
}
func (l *Lock) Check(id string) error {
	if l == nil {
		return errors.New("lease required")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if id == "" || id != l.id {
		return errors.New("lease identity differs")
	}
	return l.check()
}
func (l *Lock) ID() string {
	if l == nil {
		return ""
	}
	return l.id
}

// Never unlink a lock file: a new inode could create two lock owners.
func (l *Lock) Close() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.f == nil {
		return nil
	}
	e := l.f.Close()
	l.f = nil
	return e
}

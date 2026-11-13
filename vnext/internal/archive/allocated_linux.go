//go:build linux

package archive

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"syscall"
)

// MeasureAllocated measures a dedicated market-data tree including SQLite WAL,
// SHM, catalog, staging, pending and cache. It counts Linux allocated 512-byte
// blocks, deduplicates hard links, and refuses symlinks/special files rather
// than accidentally traversing outside the tree. Concurrent growth still needs
// reservation/remeasurement by the executor; this is not an OS-enforced quota.
func MeasureAllocated(root string) (int64, error) {
	root, e := filepath.Abs(root)
	if e != nil {
		return 0, e
	}
	real, e := filepath.EvalSymlinks(root)
	if e != nil || real != root {
		return 0, errors.New("invalid capacity root")
	}
	st, e := os.Stat(root)
	if e != nil {
		return 0, e
	}
	if !st.IsDir() {
		return 0, errors.New("capacity root must be directory")
	}
	type inode struct{ dev, ino uint64 }
	seen := map[inode]bool{}
	var total int64
	e = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		i, e := d.Info()
		if e != nil {
			return e
		}
		if !i.IsDir() && !i.Mode().IsRegular() {
			return fmt.Errorf("unsafe capacity path: %s", path)
		}
		s, ok := i.Sys().(*syscall.Stat_t)
		if !ok || s.Blocks < 0 || s.Blocks > (1<<60)/512 {
			return errors.New("invalid allocated block count")
		}
		key := inode{uint64(s.Dev), s.Ino}
		if seen[key] {
			return nil
		}
		seen[key] = true
		n := s.Blocks * 512
		if total > 1<<60-n {
			return errors.New("allocated bytes overflow")
		}
		total += n
		return nil
	})
	return total, e
}

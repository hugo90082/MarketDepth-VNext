package drive

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
)

var _ archive.ActiveRetirer = (*Client)(nil)

func isActiveObjectKey(k string) bool {
	if !validKey(k) || !strings.HasPrefix(k, "active/") {
		return false
	}
	s := strings.TrimPrefix(k, "active/")
	if strings.HasSuffix(s, ".sqlite.gz") {
		s = strings.TrimSuffix(s, ".sqlite.gz")
	} else if strings.HasSuffix(s, ".manifest.json") {
		s = strings.TrimSuffix(s, ".manifest.json")
	} else {
		return false
	}
	p := strings.Split(s, ".")
	if len(p) != 2 || len(p[1]) != 14 || p[1][0] != 'h' {
		return false
	}
	a, e := time.ParseInLocation("2006-01-02", p[0], time.FixedZone("UTC+8", 8*3600))
	if e != nil {
		return false
	}
	for i := 0; i < 24; i++ {
		if p[1] == archive.HourGeneration(a.Add(time.Duration(i)*time.Hour)) {
			return true
		}
	}
	return false
}

// TrashActiveObject is an idempotent, narrow retirement operation. It cannot
// target historical, legacy, folder or foreign-namespace objects. A 404 is not
// interpreted as success (permissions may have been revoked).
func (c *Client) TrashActiveObject(ctx context.Context, want archive.Object) error {
	if !isActiveObjectKey(want.Key) || !identifier(want.ID) || want.Size <= 0 || !digestOK(want.SHA256) {
		return errors.New("invalid active retirement target")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	r, ok, e := c.load(want.Key)
	if e != nil || !ok || r.ID != want.ID || r.Size != want.Size || r.SHA != want.SHA256 || r.MIME == folderType {
		return errors.New("active retirement reservation mismatch")
	}
	parent, e := c.verifyParent(ctx, want.Key)
	if e != nil || parent != r.Parent {
		return errors.New("active retirement parent mismatch")
	}
	name := strings.TrimPrefix(want.Key, "active/")
	f, e := c.get(ctx, want.ID)
	if e != nil {
		return e
	}
	already := f.Trashed
	f.Trashed = false
	if e = c.check(f, r, name); e != nil {
		return e
	}
	if already {
		return nil
	}
	var out file
	if e = c.json(ctx, "PATCH", "/drive/v3/files/"+want.ID, url.Values{"fields": {fields}}, map[string]bool{"trashed": true}, &out); e != nil {
		return e
	}
	if !out.Trashed {
		return errors.New("Drive did not confirm trash")
	}
	out.Trashed = false
	return c.check(out, r, name)
}

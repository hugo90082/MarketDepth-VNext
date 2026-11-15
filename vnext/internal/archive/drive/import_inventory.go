package drive

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"path"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
)

// ImportInventory reports the entire *visible*, non-trashed archive tree.
// drive.file cannot prove absence of objects inaccessible to this OAuth app.
// It is never a lease or an authorization to write. No reservations are made.
type ImportInventory struct {
	Namespace  string                  `json:"namespace"`
	RootID     string                  `json:"root_id"`
	Folders    []ImportFolder          `json:"folders"`
	Objects    []ImportInventoryObject `json:"objects"`
	FreeBytes  int64                   `json:"free_bytes"`
	ObservedAt time.Time               `json:"observed_at"`
}
type ImportFolder struct {
	Key    string `json:"key"`
	ID     string `json:"id"`
	Parent string `json:"parent"`
}
type ImportInventoryObject struct {
	Day    string `json:"day"`
	Key    string `json:"key"`
	ID     string `json:"id"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

var importFolderKey = regexp.MustCompile(`^dir/(active|historical(/[0-9]{4}(/(0[1-9]|1[0-2]))?)?|catalog(/loss)?)$`)

func (c *Client) inventoryList(ctx context.Context, q string) ([]file, error) {
	v := url.Values{"q": {q}, "fields": {"nextPageToken,incompleteSearch,files(" + fields + ")"}, "pageSize": {"100"}, "spaces": {"drive"}, "corpora": {"user"}}
	out := []file{}
	ids, tokens := map[string]bool{}, map[string]bool{}
	for i := 0; i < 500; i++ {
		var page struct {
			Next       string `json:"nextPageToken"`
			Incomplete bool   `json:"incompleteSearch"`
			Files      []file `json:"files"`
		}
		if e := c.json(ctx, "GET", "/drive/v3/files", v, nil, &page); e != nil {
			return nil, e
		}
		if page.Incomplete || page.Files == nil || len(page.Files) > 100 {
			return nil, errors.New("incomplete import inventory")
		}
		for _, f := range page.Files {
			if f.Trashed || !identifier(f.ID) || ids[f.ID] {
				return nil, errors.New("invalid or duplicate inventory file")
			}
			ids[f.ID] = true
			out = append(out, f)
		}
		if page.Next == "" {
			return out, nil
		}
		if tokens[page.Next] || len(page.Next) > 4096 {
			return nil, errors.New("invalid inventory page token")
		}
		tokens[page.Next] = true
		v.Set("pageToken", page.Next)
	}
	return nil, errors.New("inventory page limit")
}
func (c *Client) importQuota(ctx context.Context) (int64, error) {
	var r struct {
		Quota struct {
			Limit string `json:"limit"`
			Usage string `json:"usage"`
		} `json:"storageQuota"`
	}
	if e := c.json(ctx, "GET", "/drive/v3/about", url.Values{"fields": {"storageQuota(limit,usage)"}}, nil, &r); e != nil {
		return 0, e
	}
	limit, e := strconv.ParseInt(r.Quota.Limit, 10, 64)
	used, e2 := strconv.ParseInt(r.Quota.Usage, 10, 64)
	if e != nil || e2 != nil || limit <= 0 || used < 0 || used > limit {
		return 0, errors.New("unknown or exhausted Drive quota")
	}
	return limit - used, nil
}

// InspectImportInventory cross-checks the namespace appProperties listing
// against recursive parent listings (including visible untagged children).
// Unexpected keys, names, missing/moved/duplicated parents and incomplete
// pages are fatal. Trashed generations are not imported or modified.
func (r *RecoveryReader) InspectImportInventory(ctx context.Context) (ImportInventory, error) {
	var z ImportInventory
	if r == nil || r.c == nil {
		return z, errors.New("recovery client required")
	}
	c := r.c
	c.mu.Lock()
	defer c.mu.Unlock()
	root, e := c.findNamespaceRoot(ctx)
	if e != nil {
		return z, e
	}
	if root == nil {
		return z, errors.New("existing namespace root required")
	}
	roots, e := c.inventoryList(ctx, fmt.Sprintf("trashed = false and 'root' in parents and name = '%s'", c.namespace))
	if e != nil {
		return z, e
	}
	if len(roots) != 1 || !reflect.DeepEqual(roots[0], *root) {
		return z, errors.New("visible namespace name collision")
	}
	scope, e := c.inventoryList(ctx, fmt.Sprintf("trashed = false and appProperties has { key='md_ns' and value='%s' }", c.namespace))
	if e != nil {
		return z, e
	}
	byID := map[string]file{}
	byKey := map[string]bool{}
	for _, f := range scope {
		k := f.Props["md_key"]
		if k == "" || f.Props["md_ns"] != c.namespace || byKey[k] {
			return z, errors.New("invalid or duplicate namespace key")
		}
		byKey[k] = true
		byID[f.ID] = f
	}
	if !reflect.DeepEqual(byID[root.ID], *root) {
		return z, errors.New("namespace root inventory differs")
	}
	out := ImportInventory{Namespace: c.namespace, RootID: root.ID, Folders: []ImportFolder{{"root", root.ID, root.Parents[0]}}, Objects: []ImportInventoryObject{}}
	visited := map[string]bool{root.ID: true}
	for i := 0; i < len(out.Folders); i++ {
		parent := out.Folders[i]
		if len(out.Folders) > 1000 {
			return z, errors.New("folder limit")
		}
		children, e := c.inventoryList(ctx, fmt.Sprintf("trashed = false and '%s' in parents", parent.ID))
		if e != nil {
			return z, e
		}
		for _, f := range children {
			if visited[f.ID] || !reflect.DeepEqual(byID[f.ID], f) {
				return z, errors.New("unknown or changed namespace child")
			}
			visited[f.ID] = true
			key := f.Props["md_key"]
			if len(f.Parents) != 1 || f.Parents[0] != parent.ID {
				return z, errors.New("invalid child parent")
			}
			prefix := ""
			if parent.Key != "root" {
				prefix = strings.TrimPrefix(parent.Key, "dir/") + "/"
			}
			if f.MIME == folderType {
				if !importFolderKey.MatchString(key) || key != "dir/"+prefix+f.Name || f.Props["md_sha256"] != "" || f.SHA != "" || f.Size != "" {
					return z, errors.New("unknown import folder")
				}
				out.Folders = append(out.Folders, ImportFolder{key, f.ID, parent.ID})
				continue
			}
			if parent.Key == "root" || !validKey(key) || !recoveryKey.MatchString(key) || key != prefix+f.Name || path.Base(key) != f.Name {
				return z, errors.New("unknown import object")
			}
			day := f.Name[:10]
			d, e := time.Parse("2006-01-02", day)
			if e != nil || d.Format("2006-01-02") != day {
				return z, errors.New("invalid import day")
			}
			if strings.HasPrefix(key, "historical/") && !strings.HasPrefix(key, "historical/"+day[:4]+"/"+day[5:7]+"/") {
				return z, errors.New("invalid historical parent date")
			}
			if strings.HasPrefix(key, "active/") && !isActiveObjectKey(key) {
				return z, errors.New("invalid active generation")
			}
			size, e := strconv.ParseInt(f.Size, 10, 64)
			h := f.Props["md_sha256"]
			mime := "application/octet-stream"
			if strings.HasSuffix(key, ".json") {
				mime = "application/json"
			}
			if e != nil || size <= 0 || size > archive.HardLimit || !digestOK(h) || c.check(f, reservation{ID: f.ID, Key: key, Parent: parent.ID, Size: size, SHA: h, MIME: mime}, f.Name) != nil {
				return z, errors.New("invalid import object metadata")
			}
			out.Objects = append(out.Objects, ImportInventoryObject{day, key, f.ID, size, h})
		}
	}
	if len(visited) != len(byID) {
		return z, errors.New("namespace object outside tree")
	}
	// Re-read the scoped listing: detects additions/removals during traversal.
	again, e := c.inventoryList(ctx, fmt.Sprintf("trashed = false and appProperties has { key='md_ns' and value='%s' }", c.namespace))
	if e != nil {
		return z, e
	}
	if len(again) != len(byID) {
		return z, errors.New("inventory changed during scan")
	}
	for _, f := range again {
		if !reflect.DeepEqual(byID[f.ID], f) {
			return z, errors.New("inventory changed during scan")
		}
	}
	out.FreeBytes, e = c.importQuota(ctx)
	if e != nil {
		return z, e
	}
	out.ObservedAt = time.Now().UTC()
	sort.Slice(out.Objects, func(i, j int) bool { return out.Objects[i].Key < out.Objects[j].Key })
	sort.Slice(out.Folders, func(i, j int) bool { return out.Folders[i].Key < out.Folders[j].Key })
	return out, nil
}

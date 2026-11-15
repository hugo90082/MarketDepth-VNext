package drive

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"testing"
)

func TestStrictImportInventory(t *testing.T) {
	c, f, dir := setup(t)
	ctx := context.Background()
	body := []byte("test bytes")
	h := sha256.Sum256(body)
	key := "historical/2026/11/2026-11-13.r1.sqlite.gz"
	o, e := c.PutImmutable(ctx, key, int64(len(body)), hex.EncodeToString(h[:]), bytes.NewReader(body))
	if e != nil {
		t.Fatal(e)
	}
	n := f.uploads
	folders := f.folderCreates
	seq := f.seq
	before, _ := os.ReadDir(dir)
	inv, e := c.RecoveryReader().InspectImportInventory(ctx)
	if e != nil || len(inv.Objects) != 1 || inv.Objects[0].ID != o.ID || len(inv.Folders) != 4 || inv.FreeBytes != 999000000 {
		t.Fatal(inv, e)
	}
	after, _ := os.ReadDir(dir)
	if f.uploads != n || f.folderCreates != folders || f.seq != seq || len(before) != len(after) {
		t.Fatal("inventory wrote")
	}
	orig := f.files[o.ID]
	x := orig
	x.Parents = []string{"foreign"}
	f.files[o.ID] = x
	if _, e = c.RecoveryReader().InspectImportInventory(ctx); e == nil {
		t.Fatal("moved object accepted")
	}
	f.files[o.ID] = orig
	f.files["unknown"] = file{ID: "unknown", Name: "untagged", MIME: "application/json", Parents: []string{inv.RootID}}
	if _, e = c.RecoveryReader().InspectImportInventory(ctx); e == nil {
		t.Fatal("untagged child accepted")
	}
	delete(f.files, "unknown")
	f.files["duplicate_root"] = file{ID: "duplicate_root", Name: inv.Namespace, MIME: folderType, Parents: []string{"my_root"}}
	if _, e = c.RecoveryReader().InspectImportInventory(ctx); e == nil {
		t.Fatal("duplicate name accepted")
	}
	delete(f.files, "duplicate_root")
	f.files["unknown"] = file{ID: "unknown", Name: "unknown", MIME: folderType, Parents: []string{inv.RootID}, Props: map[string]string{"md_ns": inv.Namespace, "md_key": "dir/unknown"}}
	if _, e = c.RecoveryReader().InspectImportInventory(ctx); e == nil {
		t.Fatal("unknown folder accepted")
	}
	delete(f.files, "unknown")
	f.duplicate = true
	if _, e = c.RecoveryReader().InspectImportInventory(ctx); e == nil {
		t.Fatal("duplicate accepted")
	}
}

func TestImportInventoryPaginationAndDurableReservation(t *testing.T) {
	c, f, dir := setup(t)
	ctx := context.Background()
	data := []byte("immutable payload")
	digest := hash(data)
	key := "historical/2026/11/2026-11-13.r1.sqlite.gz"
	f.failAfterCommit = true
	if _, e := c.PutImmutable(ctx, key, int64(len(data)), digest, bytes.NewReader(data)); e == nil {
		t.Fatal("expected ambiguous failure")
	}
	inv, e := c.RecoveryReader().InspectImportInventory(ctx)
	if e != nil || len(inv.Objects) != 1 {
		t.Fatal(inv, e)
	}
	id := inv.Objects[0].ID
	seq := f.seq
	uploads := f.uploads
	c = testClient(t, f, dir)
	o, e := c.PutImmutable(ctx, key, int64(len(data)), digest, bytes.NewReader(data))
	if e != nil || o.ID != id || f.seq != seq || f.uploads != uploads {
		t.Fatal("retry changed identity", o, e)
	}
	parent := f.files[id].Parents[0]
	for i := 2; i <= 130; i++ {
		n := fmt.Sprintf("2026-11-13.r%d.sqlite.gz", i)
		k := "historical/2026/11/" + n
		xid := fmt.Sprintf("synthetic_%d", i)
		f.files[xid] = file{ID: xid, Name: n, MIME: "application/gzip", Parents: []string{parent}, Size: fmt.Sprint(len(data)), SHA: digest, Props: map[string]string{"md_ns": inv.Namespace, "md_key": k, "md_sha256": digest}}
	}
	inv, e = c.RecoveryReader().InspectImportInventory(ctx)
	if e != nil || len(inv.Objects) != 130 {
		t.Fatal(len(inv.Objects), e)
	}
	f.repeatToken = true
	if _, e = c.RecoveryReader().InspectImportInventory(ctx); e == nil {
		t.Fatal("repeated token accepted")
	}
	f.repeatToken = false
	f.listIncomplete = true
	if _, e = c.RecoveryReader().InspectImportInventory(ctx); e == nil {
		t.Fatal("incomplete search accepted")
	}
	f.listIncomplete = false
	f.quotaMissing = true
	if _, e = c.RecoveryReader().InspectImportInventory(ctx); e == nil {
		t.Fatal("unknown quota accepted")
	}
	f.quotaMissing = false
	if f.seq != seq || f.uploads != uploads {
		t.Fatal("read-only listing created object")
	}
}

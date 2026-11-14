//go:build linux && sqlite_integration

package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/legacyproof"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
)

// Real market data, synthetic placement and in-memory remote only. Never
// accepts OAuth credentials, calls Drive or authorizes publication.
func TestRealLegacySealedRoundTrip(t *testing.T) {
	root := os.Getenv("MD_REAL_CANDIDATE_ROOT")
	draftPath := os.Getenv("MD_REAL_V66_REVIEW_DRAFT")
	if root == "" || draftPath == "" {
		t.Skip("offline real inputs required")
	}
	ctx := context.Background()
	b, e := os.ReadFile(draftPath)
	if e != nil {
		t.Fatal(e)
	}
	h := sha256.Sum256(b)
	if hex.EncodeToString(h[:]) != "e1a8d8feda9acc7fbecc4676a792f27929f96fd13069c1203995c57b6835c418" {
		t.Fatal("unexpected real draft")
	}
	var draft struct {
		Days []struct {
			Day          string                    `json:"day"`
			CandidateSHA string                    `json:"candidate_sha256"`
			RowsSHA      string                    `json:"canonical_rows_sha256"`
			Spot         int64                     `json:"unique_spot"`
			F1           int64                     `json:"unique_futures_1m"`
			Sources      []legacyproof.SourceProof `json:"sources"`
		}
	}
	if e = json.Unmarshal(b, &draft); e != nil {
		t.Fatal(e)
	}
	loc := time.FixedZone("UTC+8", 8*3600)
	cut := time.Date(2026, 11, 14, 0, 0, 0, 0, loc)
	now := cut.Add(24 * time.Hour)
	const day = "2026-11-13"
	d := draft.Days[54]
	if d.Day != day {
		t.Fatal(d)
	}
	p := legacyproof.LegacyDayProof{Version: "legacy-day-proof-v1", Day: day, CutoverMS: cut.UnixMilli(), Sources: d.Sources, CanonicalRowsSHA256: d.RowsSHA, PlacementReportSHA256: strings.Repeat("a", 64), UniqueSpot: d.Spot, UniqueFutures1m: d.F1, UnknownAvailability: d.Spot + d.F1}
	_, proofSHA, e := legacyproof.CanonicalLegacyProof(p)
	if e != nil {
		t.Fatal(e)
	}
	candidate := filepath.Join(root, "days", "candidate-"+day+".sqlite")
	base := t.TempDir()
	if e = os.Chmod(base, 0700); e != nil {
		t.Fatal(e)
	}
	stage := filepath.Join(base, "stage")
	reserve := int64(100_000_000)
	if _, e = BuildReviewedLegacySnapshot(ctx, candidate, d.CandidateSHA, p, strings.Repeat("b", 64), filepath.Join(base, "bad"), strings.Repeat("c", 40), now, reserve); e == nil {
		t.Fatal("wrong proof hash accepted")
	}
	snap, e := BuildReviewedLegacySnapshot(ctx, candidate, d.CandidateSHA, p, proofSHA, stage, strings.Repeat("c", 40), now, reserve)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = BuildReviewedLegacySnapshot(ctx, candidate, d.CandidateSHA, p, proofSHA, stage, strings.Repeat("c", 40), now, reserve); e == nil {
		t.Fatal("overwrite accepted")
	}
	if snap.Manifest.RowCounts["spot_depth"] != d.Spot || snap.Manifest.RowCounts["futures_1m"] != d.F1 || snap.Manifest.RowCounts["futures_10s"] != 0 || snap.Manifest.DataOrigin != "legacy" || snap.Manifest.LegacyProofSHA256 != proofSHA {
		t.Fatal(snap.Manifest)
	}
	compressed, e := os.ReadFile(snap.Path)
	if e != nil {
		t.Fatal(e)
	}
	remote := &sealedRemote{objects: map[string]storedArchiveObject{}, keys: map[string]string{}}
	verify := func(ctx context.Context, m archive.Manifest, r io.Reader) error {
		dir, e := os.MkdirTemp(base, "verify-")
		if e != nil {
			return e
		}
		defer os.RemoveAll(dir)
		_, e = RestoreVerifiedDay(ctx, m, r, dir, reserve)
		return e
	}
	if _, e = archive.PublishSealed(ctx, remote, snap.Manifest, bytes.NewReader(compressed), verify); e == nil || len(remote.objects) != 0 {
		t.Fatal("live publisher accepted historical manifest")
	}
	bad := snap.Manifest
	bad.LegacyProofSHA256 = strings.Repeat("b", 64)
	if _, e = archive.PublishLegacySealed(ctx, remote, bad, bytes.NewReader(compressed), verify); e == nil || len(remote.objects) != 0 {
		t.Fatal("wrong proof accepted")
	}
	bad = snap.Manifest
	bad.DataOrigin = "live"
	if _, e = archive.PublishSealed(ctx, remote, bad, bytes.NewReader(compressed), verify); e == nil || len(remote.objects) != 0 {
		t.Fatal("relabel accepted")
	}
	// Prepared local bytes must pass preflight before any remote operation.
	badPath := filepath.Join(base, "tampered.gz")
	tampered := append([]byte(nil), compressed...)
	tampered[len(tampered)/2] ^= 1
	if e = os.WriteFile(badPath, tampered, 0600); e != nil {
		t.Fatal(e)
	}
	damaged := snap
	damaged.Path = badPath
	if _, e = PublishPreparedLegacySnapshot(ctx, remote, damaged, proofSHA, base, reserve); e == nil || len(remote.objects) != 0 {
		t.Fatal("tampered local snapshot reached remote")
	}
	remote.failManifest = true
	if _, e = PublishPreparedLegacySnapshot(ctx, remote, snap, proofSHA, base, reserve); e == nil || len(remote.objects) != 1 {
		t.Fatal("failed manifest not handled", e, len(remote.objects))
	}
	remote.failManifest = false
	pub, e := PublishPreparedLegacySnapshot(ctx, remote, snap, proofSHA, base, reserve)
	if e != nil {
		t.Fatal(e)
	}
	rec, e := pub.Record()
	if e != nil {
		t.Fatal(e)
	}
	again, e := PublishPreparedLegacySnapshot(ctx, remote, snap, proofSHA, base, reserve)
	if e != nil {
		t.Fatal(e)
	}
	rec2, e := again.Record()
	if e != nil || !reflect.DeepEqual(rec, rec2) || len(remote.objects) != 2 {
		t.Fatal("immutable retry differs", e)
	}
	allow := func(context.Context, int64) (func(), error) { return func() {}, nil }
	m, j := freshRecovery(t, ctx, filepath.Join(base, "recovered"), now)
	defer m.Close()
	defer j.Close()
	if e = j.RegisterArchive(ctx, pub); e == nil {
		t.Fatal("ordinary live registration accepted legacy")
	}
	result, e := j.RebuildVerifiedCatalog(ctx, remote, recoveryCandidates(remote), allow)
	if e != nil || result.SealedDays != 1 || result.SealedRevisions != 1 {
		t.Fatal(result, e)
	}
	if e = j.CanCollectDay(ctx, day); e == nil {
		t.Fatal("recovered legacy day writable")
	}
	c, e := NewArchiveReadCache(m, remote, allow)
	if e != nil {
		t.Fatal(e)
	}
	r, e := NewArchiveReader(j, c)
	if e != nil {
		t.Fatal(e)
	}
	// Query through actual recovered catalog, compare against original SQL row.
	db, e := SQLiteOpener(candidate, true)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	var key model.Key
	if e = db.QueryRowContext(ctx, "SELECT t,venue,asset FROM spot_depth ORDER BY t,venue,asset LIMIT 1").Scan(&key.T, &key.Venue, &key.Asset); e != nil {
		t.Fatal(e)
	}
	expected, e := readRow(ctx, db, model.Spot, key)
	if e != nil {
		t.Fatal(e)
	}
	page, e := r.History(ctx, Query{Kind: model.Spot, From: key.T, To: key.T + 60000, Venue: key.Venue, Asset: key.Asset, Limit: 1})
	if e != nil || len(page.Rows) != 1 {
		t.Fatal(page, e)
	}
	x, _ := json.Marshal(expected)
	y, _ := json.Marshal(page.Rows[0])
	if !bytes.Equal(x, y) {
		t.Fatal("recovered row mismatch")
	}
	if latest, e := r.Latest(ctx, model.Spot); e != nil || len(latest) != 0 {
		t.Fatal("legacy treated as live", e)
	}
	days, e := r.Days(ctx, day, day)
	if e != nil || len(days) != 1 || days[0].State != "sealed_remote" || int64(days[0].Counts[model.Spot]) != d.Spot {
		t.Fatal(days, e)
	}
	download, e := r.OpenSealed(ctx, day, 0)
	if e != nil {
		t.Fatal(e)
	}
	got, e := io.ReadAll(download.Body)
	ce := download.Body.Close()
	if e != nil || ce != nil || !bytes.Equal(got, compressed) {
		t.Fatal("download differs", e, ce)
	}
	if actual, e := auditHash(ctx, candidate); e != nil || actual != d.CandidateSHA {
		t.Fatal("candidate changed")
	}
	t.Logf("real day %s spot=%d F1=%d raw=%d gzip=%d; immutable retry, proof validation, GET-only recovery, readback and download passed", day, d.Spot, d.F1, snap.Manifest.RawSize, snap.Manifest.Size)
}

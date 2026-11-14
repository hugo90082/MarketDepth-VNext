//go:build linux && sqlite_integration

package store

import (
	"context"
	"errors"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/archive"
	"github.com/hugo90082/MarketDepth-VNext/vnext/internal/model"
	"io"
	"os"
	"strings"
	"testing"
	"time"
)

type legacyGuardRemote struct{ puts, opens int }

func (r *legacyGuardRemote) PutImmutable(context.Context, string, int64, string, io.Reader) (archive.Object, error) {
	r.puts++
	return archive.Object{}, errors.New("unexpected write")
}
func (r *legacyGuardRemote) OpenObject(context.Context, string) (archive.Object, io.ReadCloser, error) {
	r.opens++
	return archive.Object{}, nil, errors.New("unexpected read")
}
func TestRealLegacyCandidatePublicationGuard(t *testing.T) {
	p := os.Getenv("MD_REAL_CANDIDATE_SQLITE")
	if p == "" {
		t.Skip("offline real candidate required")
	}
	ctx := context.Background()
	const day = "2026-11-13"
	if _, e := checkSnapshot(ctx, p, day); e == nil {
		t.Fatal("real candidate accepted by live snapshot verifier")
	} else {
		t.Log("real candidate snapshot rejected:", e)
	}
	a, e := time.ParseInLocation("2006-01-02", day, time.FixedZone("UTC+8", 8*3600))
	if e != nil {
		t.Fatal(e)
	}
	end := a.Add(24 * time.Hour).UnixMilli()
	m := archive.Manifest{ContractID: model.Contract, Day: day, Timezone: model.Timezone, Revision: 1, Generation: "g1", SHA256: strings.Repeat("a", 64), RawSHA256: strings.Repeat("b", 64), Size: 100, RawSize: 200, From: a.UnixMilli(), To: end, ProducerCommit: strings.Repeat("c", 40), SealedAt: &end, DataOrigin: "legacy"}
	r := new(legacyGuardRemote)
	verify := func(context.Context, archive.Manifest, io.Reader) error { return errors.New("unexpected verification") }
	if _, e = archive.PublishSealed(ctx, r, m, strings.NewReader("candidate"), verify); e == nil || r.puts != 0 || r.opens != 0 {
		t.Fatal("legacy publisher not blocked before remote I/O", e, r)
	} else {
		t.Log("legacy sealed manifest rejected before remote I/O:", e)
	}
	m.SealedAt = nil
	m.Generation = archive.HourGeneration(a)
	if _, e = archive.PublishActive(ctx, r, m, strings.NewReader("candidate"), verify); e == nil || r.puts != 0 || r.opens != 0 {
		t.Fatal("legacy active publisher not blocked", e, r)
	}
}

package archive

import "testing"

func TestCapacityPriorityAndProtection(t *testing.T) {
	entries := []LocalEntry{
		{ID: "active", Bytes: 250_000_000, Class: Protected},
		{ID: "leased", Bytes: 120_000_000, Class: VerifiedDay, Day: "2026-11-01", InUse: true},
		{ID: "unverified-new", Bytes: 160_000_000, Class: UnverifiedDay, Day: "2026-11-11"},
		{ID: "unverified-old", Bytes: 160_000_000, Class: UnverifiedDay, Day: "2026-11-10"},
		{ID: "verified", Bytes: 150_000_000, Class: VerifiedDay, Day: "2026-11-09"},
		{ID: "cache", Bytes: 90_000_000, Class: Cache},
		{ID: "part", Bytes: 10_000_000, Class: FailedPart},
		{ID: "catalog", Bytes: 50_000_000, Class: Protected},
	}
	p, e := PlanCapacity(entries, 100_000_000)
	if e != nil {
		t.Fatal(e)
	}
	// 1.09GB -> cache+part+verified -> 840MB; no data loss.
	if len(p.Actions) != 3 || p.Actions[0].ID != "cache" || p.Actions[1].ID != "part" || p.Actions[2].ID != "verified" || p.Projected != 840_000_000 || p.StopWrites {
		t.Fatal(p)
	}
	p, e = PlanCapacity(entries, 270_000_000)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.Actions) != 4 || p.Actions[3].ID != "unverified-old" || !p.Actions[3].PermanentLoss || p.Projected != 850_000_000 {
		t.Fatal(p)
	}
}
func TestCacheAndHardStop(t *testing.T) {
	p, e := PlanCapacity([]LocalEntry{{ID: "cache-older", Bytes: 70_000_000, Class: Cache, LastUsed: 1}, {ID: "cache-newer", Bytes: 70_000_000, Class: Cache, LastUsed: 2}, {ID: "active", Bytes: 250_000_000, Class: Protected}}, 0)
	if e != nil || len(p.Actions) != 1 || p.Actions[0].ID != "cache-older" || p.ProjectedCache != 70_000_000 {
		t.Fatal(p, e)
	}
	p, e = PlanCapacity([]LocalEntry{{ID: "active", Bytes: 999_000_000, Class: Protected}}, 2_000_000)
	if e != nil || !p.StopWrites || !p.StopOptional || len(p.Actions) != 0 {
		t.Fatal(p, e)
	}
	p, e = PlanCapacity([]LocalEntry{{ID: "cache", Bytes: 101_000_000, Class: Cache, InUse: true}}, 0)
	if e != nil || !p.StopOptional || p.StopWrites || len(p.Actions) != 0 {
		t.Fatal(p, e)
	}
}
func TestRejectBadCapacityInput(t *testing.T) {
	for _, entries := range [][]LocalEntry{{{ID: "x", Bytes: 1, Class: UnverifiedDay, Day: "invalid"}}, {{ID: "x", Bytes: 1, Class: Cache}, {ID: "x", Bytes: 1, Class: Protected}}, {{ID: "x", Bytes: -1, Class: Cache}}} {
		if _, e := PlanCapacity(entries, 0); e == nil {
			t.Fatal("invalid input accepted")
		}
	}
}

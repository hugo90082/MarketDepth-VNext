package archive

import (
	"errors"
	"sort"
	"time"
)

const (
	HardLimit  int64 = 1_000_000_000
	HighWater  int64 = 950_000_000
	LowWater   int64 = 900_000_000
	CacheLimit int64 = 100_000_000
)

type LocalClass string

const (
	Cache               LocalClass = "cache"
	FailedPart          LocalClass = "failed_part"
	RebuildableSnapshot LocalClass = "rebuildable_snapshot"
	VerifiedDay         LocalClass = "verified_day"
	UnverifiedDay       LocalClass = "unverified_day"
	Protected           LocalClass = "protected"
)

// LocalEntry describes an entire eviction unit, including its WAL/SHM and any
// inseparable companion files. Bytes are allocated disk bytes, not logical sizes.
// VerifiedDay means remote data+manifest verified and catalog committed.
// A current or grace-period day, a reader lease, a pending intent or an open
// writer MUST set InUse (or Protected) regardless of remote availability.
type LocalEntry struct {
	ID    string
	Day   string
	Bytes int64
	Class LocalClass
	InUse bool
	// Oldest first within class. For days, the date itself is authoritative.
	LastUsed int64
}
type Eviction struct {
	ID            string
	Bytes         int64
	PermanentLoss bool
	Reason        string
}
type CapacityPlan struct {
	Used, Reserved, Projected, ProjectedCache int64
	Actions                                   []Eviction
	StopWrites                                bool
	StopOptional                              bool
}

// PlanCapacity is a pure dry-run. No file removal or authority to delete is
// implied. The executor must acquire leases, remeasure, and persist any loss
// tombstone before unlinking. Reserve includes pending allocation and safety
// headroom; the catalog and all protected data count toward the hard limit.
func PlanCapacity(entries []LocalEntry, reserve int64) (CapacityPlan, error) {
	p := CapacityPlan{Reserved: reserve, Actions: []Eviction{}}
	if reserve < 0 || reserve > HardLimit {
		return p, errors.New("invalid capacity reservation")
	}
	seen := map[string]bool{}
	var cache int64
	candidates := []LocalEntry{}
	for _, e := range entries {
		if e.ID == "" || seen[e.ID] || e.Bytes < 0 || e.Bytes > 1<<50 {
			return p, errors.New("invalid or duplicate capacity entry")
		}
		seen[e.ID] = true
		if p.Used > 1<<60-e.Bytes {
			return p, errors.New("capacity overflow")
		}
		p.Used += e.Bytes
		switch e.Class {
		case Cache:
			cache += e.Bytes
		case FailedPart, RebuildableSnapshot, Protected:
		case VerifiedDay, UnverifiedDay:
			if _, err := time.Parse("2006-01-02", e.Day); err != nil {
				return p, errors.New("day eviction needs valid calendar date")
			}
		default:
			return p, errors.New("unknown capacity class")
		}
		if !e.InUse && e.Class != Protected && e.Bytes > 0 {
			candidates = append(candidates, e)
		}
	}
	rank := func(c LocalClass) int {
		switch c {
		case Cache:
			return 0
		case FailedPart:
			return 1
		case RebuildableSnapshot:
			return 2
		case VerifiedDay:
			return 3
		case UnverifiedDay:
			return 4
		}
		return 5
	}
	sort.Slice(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		if rank(a.Class) != rank(b.Class) {
			return rank(a.Class) < rank(b.Class)
		}
		if a.Class == VerifiedDay || a.Class == UnverifiedDay {
			if a.Day != b.Day {
				return a.Day < b.Day
			}
		}
		if a.LastUsed != b.LastUsed {
			return a.LastUsed < b.LastUsed
		}
		return a.ID < b.ID
	})
	projected := p.Used + reserve
	// Cache has its own 100MB limit even when the total is below high-water.
	pressure := projected >= HighWater
	for _, e := range candidates {
		needCache := cache > CacheLimit && e.Class == Cache
		needTotal := pressure && projected > LowWater
		if !needCache && !needTotal {
			continue
		}
		// Forced unverified-day deletion is a last resort for total pressure only.
		if e.Class == UnverifiedDay && !needTotal {
			continue
		}
		loss := e.Class == UnverifiedDay
		reason := "reclaim_rebuildable"
		if e.Class == VerifiedDay {
			reason = "remote_verified"
		}
		if loss {
			reason = "capacity_forced_loss_requires_tombstone"
		}
		p.Actions = append(p.Actions, Eviction{e.ID, e.Bytes, loss, reason})
		projected -= e.Bytes
		if e.Class == Cache {
			cache -= e.Bytes
		}
	}
	p.Projected = projected
	p.ProjectedCache = cache
	p.StopOptional = projected >= HighWater || cache > CacheLimit
	// At the hard cap, no allocation should proceed unless safety can be restored.
	p.StopWrites = projected >= HardLimit
	return p, nil
}

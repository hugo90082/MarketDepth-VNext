#!/usr/bin/env python3
"""Summarize bounded resource_probe JSONL; no production approval."""
import argparse
import datetime
import json
import math
import pathlib
import uuid

VERSION = "staging-resource-v1"
LIMIT = 1_000_000_000
MIN_FREE = 1_000_000_000
TZ = datetime.timezone(datetime.timedelta(hours=8))
NUMERIC = {
    "sample_at_ms", "monotonic_ns", "sample_duration_ns", "pid",
    "process_start_ticks", "clock_ticks_per_second", "cpu_ticks", "rss_bytes",
    "allocated_bytes", "filesystem_free_bytes", "capacity_limit_bytes",
}


def stats(values):
    if not values:
        return None
    v = sorted(values)
    return {"p50": v[math.ceil(len(v) * .50)-1],
            "p95": v[math.ceil(len(v) * .95)-1], "max": v[-1]}


def no_duplicate(pairs):
    result = {}
    for k, v in pairs:
        if k in result:
            raise ValueError("duplicate sample field")
        result[k] = v
    return result


def summarize(samples, max_gap_seconds=90):
    if not 1 <= max_gap_seconds <= 300:
        raise ValueError("invalid maximum gap")
    first = prev = None
    rss, disk, free, cpu, durations, gaps = [], [], [], [], [], []
    count = 0
    for s in samples:
        count += 1
        if count > 100_000:
            raise ValueError("sample count limit")
        if set(s) != NUMERIC | {"version", "boot_id"} or s["version"] != VERSION:
            raise ValueError("invalid sample schema")
        if any(type(s[k]) is not int or s[k] < 0 or s[k] > 2**63-1 for k in NUMERIC):
            raise ValueError("invalid numeric sample field")
        if not isinstance(s["boot_id"], str) or str(uuid.UUID(s["boot_id"])) != s["boot_id"]:
            raise ValueError("invalid boot ID")
        if s["pid"] <= 1 or s["process_start_ticks"] <= 0 or not 1 <= s["clock_ticks_per_second"] <= 10000 or s["capacity_limit_bytes"] != LIMIT:
            raise ValueError("invalid sample identity")
        identity = tuple(s[k] for k in ("boot_id", "pid", "process_start_ticks", "clock_ticks_per_second"))
        if first is None:
            first = s
            first_identity = identity
        if identity != first_identity:
            raise ValueError("restart or boot identity change")
        if prev is not None:
            delta = (s["monotonic_ns"] - prev["monotonic_ns"]) / 1e9
            wall = (s["sample_at_ms"] - prev["sample_at_ms"]) / 1000
            ticks = s["cpu_ticks"] - prev["cpu_ticks"]
            if delta <= 0 or wall <= 0 or ticks < 0 or abs(wall-delta) > 2:
                raise ValueError("non-monotonic samples or clock discontinuity")
            gaps.append(delta)
            cpu.append(round(100*ticks/s["clock_ticks_per_second"]/delta, 3))
        rss.append(s["rss_bytes"])
        disk.append(s["allocated_bytes"])
        free.append(s["filesystem_free_bytes"])
        durations.append(s["sample_duration_ns"]/1e9)
        prev = s
    if count < 2:
        raise ValueError("at least two samples required")
    span = (prev["monotonic_ns"]-first["monotonic_ns"])/1e9
    a = datetime.datetime.fromtimestamp(first["sample_at_ms"]/1000, TZ)
    b = datetime.datetime.fromtimestamp(prev["sample_at_ms"]/1000, TZ)
    boundaries = (b.date()-a.date()).days
    return {
        "version": "staging-resource-summary-v1",
        "samples": count,
        "boot_id": first["boot_id"],
        "pid": first["pid"],
        "process_start_ticks": first["process_start_ticks"],
        "first_at_ms": first["sample_at_ms"],
        "last_at_ms": prev["sample_at_ms"],
        "elapsed_seconds": span,
        "taipei_day_boundaries": boundaries,
        "max_gap_seconds": max(gaps),
        "gap_budget_seconds": max_gap_seconds,
        "continuous_window_observed": span >= 86400 and boundaries >= 2 and max(gaps) <= max_gap_seconds,
        "rss_bytes": stats(rss),
        "cpu_percent_one_core": stats(cpu),
        "allocated_bytes": stats(disk),
        "min_filesystem_free_bytes": min(free),
        "sample_duration_seconds": stats(durations),
        "observed_capacity_ok": max(disk) < LIMIT and min(free) >= MIN_FREE,
        "oom_verified": False,
        "production_ready": False,
    }


def read_samples(path):
    with open(path, "rb") as f:
        while True:
            line = f.readline(16385)
            if not line:
                return
            if len(line) > 16384:
                raise ValueError("oversize sample")
            obj = json.loads(line, object_pairs_hook=no_duplicate)
            if not isinstance(obj, dict):
                raise ValueError("sample object required")
            yield obj


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("samples", type=pathlib.Path)
    p.add_argument("--max-gap-seconds", type=int, default=90)
    a = p.parse_args()
    try:
        print(json.dumps(summarize(read_samples(a.samples), a.max_gap_seconds), indent=2, sort_keys=True))
    except (OSError, ValueError, TypeError, OverflowError) as exc:
        p.exit(1, "summary failed: " + str(exc) + "\n")


if __name__ == "__main__":
    main()

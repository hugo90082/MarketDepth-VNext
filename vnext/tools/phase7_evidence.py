#!/usr/bin/env python3
"""Assemble Phase 7 evidence for human review, never approve deployment."""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import re
import stat

from resource_summary import summarize, read_samples, no_duplicate, TZ

ASSETS = ("BTC", "ETH", "SOL")
VENUES = ("binance", "bitfinex", "coinbase", "kraken")
EXPECTED = {(k, v, a): n for k, vs, n in (
    ("spot_depth", VENUES, 1440), ("futures_10s", ("",), 8640),
    ("futures_1m", ("",), 1440)) for v in vs for a in ASSETS}
BINS = ("0_100", "100_200", "200_300", "300_500", "500_750")
STATUSES = {"ok", "partial", "missing", "late", "recovered", "empty"}
REVIEW_REQUIRED = [
    "exchange_coverage_and_binance_750", "futures_repair_and_official_1m",
    "collector_events_and_failure_reasons", "oom_cgroup_and_restart_logs",
    "capacity_reservations_and_pressure", "real_drive_hourly_daily_restore",
    "concurrent_export_and_collection", "v66_https_proxy_and_auth",
    "old_service_and_rollback", "historical_import_and_cutover",
]


def sha_file(path, limit):
    path = pathlib.Path(path)
    st = path.lstat()
    if not stat.S_ISREG(st.st_mode) or not 0 < st.st_size <= limit:
        raise ValueError("bounded regular evidence file required")
    with path.open("rb") as f:
        data = f.read(limit+1)
    after = path.lstat()
    if len(data) != st.st_size or (st.st_ino, st.st_dev, st.st_mtime_ns, st.st_size) != (after.st_ino, after.st_dev, after.st_mtime_ns, after.st_size):
        raise ValueError("evidence changed")
    return data, hashlib.sha256(data).hexdigest()


def integer(v, lo=0, hi=2**63-1):
    if type(v) is not int or not lo <= v <= hi:
        raise ValueError("invalid evidence count")
    return v


def audit_day(d, producer):
    if d["contract_id"] != "MD-VNEXT-1" or d["producer_commit"] != producer or d["production_ready"] is not False or not re.fullmatch(r"[a-f0-9]{64}", d["raw_sha256"]):
        raise ValueError("day identity mismatch")
    day = dt.date.fromisoformat(d["day"])
    if day.isoformat() != d["day"]:
        raise ValueError("noncanonical date")
    start = int(dt.datetime.combine(day, dt.time(), TZ).timestamp()*1000)
    integer(d["sealed_at"], start+86400000)
    integer(d["revision"], 1)
    integer(d["events"])
    if len(d["streams"]) != 18:
        raise ValueError("missing streams")
    seen = set()
    total, missing_status, complete750 = 0, 0, {}
    for s in d["streams"]:
        key = s["kind"], s.get("venue", ""), s["asset"]
        if key not in EXPECTED or key in seen or s["expected"] != EXPECTED[key]:
            raise ValueError("invalid stream identity")
        seen.add(key)
        n = EXPECTED[key]
        present = integer(s["present"], 0, n)
        absent = integer(s["absent"], 0, n)
        if present + absent != n:
            raise ValueError("stream accounting")
        statuses = s["status_counts"]
        if not isinstance(statuses, dict) or not set(statuses) <= STATUSES or ("empty" in statuses and key[0] != "futures_10s"):
            raise ValueError("invalid status")
        if sum(integer(x, 1, present) for x in statuses.values()) != present:
            raise ValueError("status accounting")
        step = 86400000 // n
        last, missing = start-step, 0
        for gap in s["missing_intervals"]:
            a, b = integer(gap["from"], start, start+86400000), integer(gap["to"], start, start+86400000)
            if a <= last or b <= a or (a-start)%step or (b-start)%step or gap["reason"] != "grid_missing":
                raise ValueError("invalid or nonmerged missing interval")
            missing += (b-a)//step
            last = b
        if missing != absent:
            raise ValueError("gap accounting")
        lag = [s[k] for k in ("availability_lag_p50_ms", "availability_lag_p95_ms", "availability_lag_max_ms")]
        if present:
            if [integer(x) for x in lag] != sorted(lag):
                raise ValueError("invalid availability quantiles")
        elif lag != [None]*3:
            raise ValueError("unexpected lag")
        counts = [integer(s[k], 0, present) for k in (
            "bid_observed_750","ask_observed_750","bid_trusted_750","ask_trusted_750","paired_trusted_750","paired_complete_750")]
        if key[0] == "spot_depth":
            bins = s["paired_trusted_bins"]
            if set(bins) != set(BINS) or any(integer(v,0,present) < counts[5] for v in bins.values()) or counts[5] > counts[4] or counts[4] > min(counts[2:4]):
                raise ValueError("invalid paired coverage")
            complete750[key[1]+"/"+key[2]] = counts[5]
        elif any(counts) or s["paired_trusted_bins"] is not None:
            raise ValueError("unexpected futures depth")
        total += present
        missing_status += statuses.get("missing",0)
    if seen != set(EXPECTED) or d["expected"] != 47520 or d["present"] != total or d["absent"] != 47520-total or d["grid_complete"] is not (total==47520):
        raise ValueError("day accounting mismatch")
    all4=d["all4_paired_minutes_750"]
    if set(all4)!=set(ASSETS):
        raise ValueError("invalid ALL4 assets")
    for asset, count in all4.items():
        if integer(count,0,1440)*2 > sum(complete750[v+"/"+asset] for v in VENUES):
            raise ValueError("ALL4 count exceeds paired observations")
    return {"day":d["day"],"raw_sha256":d["raw_sha256"],"present":total,
            "absent":47520-total,"missing_status":missing_status,
            "paired_complete_750":complete750,"all4_paired_minutes_750":all4}


def build_report(resource_path, day_paths, producer, first_target_ms, max_gap_seconds=90):
    if not re.fullmatch(r"[a-f0-9]{40}",producer):
        raise ValueError("exact producer commit required")
    integer(first_target_ms,1)
    if first_target_ms%60000:
        raise ValueError("first target must be minute aligned")
    # Recompute summary from exactly the bytes hashed, not a supplied summary.
    resource_bytes, resource_sha = sha_file(resource_path, 64*1024*1024)
    def samples():
        for line in resource_bytes.splitlines():
            if len(line)>16384:
                raise ValueError("oversize resource sample")
            s=json.loads(line,object_pairs_hook=no_duplicate)
            if not isinstance(s,dict):
                raise ValueError("invalid resource sample")
            yield s
    resource = summarize(samples(), max_gap_seconds)
    a,b=resource["first_at_ms"],resource["last_at_ms"]
    if not a<=first_target_ms<=b:
        raise ValueError("first target outside resource observation")
    start=dt.datetime.fromtimestamp(first_target_ms/1000,TZ)
    end=dt.datetime.fromtimestamp(b/1000,TZ)
    day=start.date()
    if start.time()!=dt.time():
        day+=dt.timedelta(days=1)
    expected=[]
    while day<end.date():
        expected.append(day.isoformat())
        day+=dt.timedelta(days=1)
    if len(day_paths)>31:
        raise ValueError("too many day reports")
    results={}
    for path in day_paths:
        data,digest=sha_file(path,8*1024*1024)
        row=audit_day(json.loads(data,object_pairs_hook=no_duplicate),producer)
        day=row["day"]
        if day in results or day not in expected:
            raise ValueError("duplicate or outside full-day observation")
        row["audit_sha256"]=digest
        results[day]=row
    blockers=[]
    if not resource["continuous_window_observed"]:
        blockers.append("continuous_resource_window_not_observed")
    if not resource["observed_capacity_ok"]:
        blockers.append("sampled_capacity_violation")
    if not expected:
        blockers.append("no_fully_observed_calendar_day")
    if set(expected)!=set(results):
        blockers.append("missing_full_day_audits")
    if any(r["absent"] for r in results.values()):
        blockers.append("grid_gaps_require_review")
    if any(r["missing_status"] for r in results.values()):
        blockers.append("missing_market_rows_require_review")
    return {"version":"phase7-evidence-review-v1","producer_commit":producer,
            "resource_sha256":resource_sha,"resource":resource,
            "first_target_ms":first_target_ms,"expected_full_days":expected,
            "days":[results[k] for k in sorted(results)],
            "observed_blockers":blockers,
            "manual_evidence_required":REVIEW_REQUIRED,
            "evidence_status":"review_required","production_ready":False,
            "deployment_approved":False,"cutover_approved":False}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--resources",required=True)
    p.add_argument("--day-audit",action="append",default=[])
    p.add_argument("--producer-commit",required=True)
    p.add_argument("--first-target-ms",type=int,required=True)
    p.add_argument("--max-gap-seconds",type=int,default=90)
    a=p.parse_args()
    try:
        r=build_report(a.resources,a.day_audit,a.producer_commit,a.first_target_ms,a.max_gap_seconds)
        print(json.dumps(r,indent=2,sort_keys=True))
    except (OSError,ValueError,KeyError,TypeError,OverflowError) as e:
        p.exit(1,"evidence review failed: "+type(e).__name__+"\n")


if __name__=="__main__":
    main()

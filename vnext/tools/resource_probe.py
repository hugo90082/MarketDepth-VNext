#!/usr/bin/env python3
"""Linux staging-only read-only process and allocated-disk observations.

Each invocation prints exactly one JSON sample. No scheduling, database
access, credentials, process control, or production-readiness assertion.
The caller owns cadence and retention outside the data directory.
"""
import argparse
import json
import os
import pathlib
import stat
import time


MARKER = b"MARKETDEPTH-VNEXT-STAGING-1\n"
HARD_BYTES = 1_000_000_000


def proc_stat(text):
    # comm is enclosed in parentheses and may itself contain spaces or ')'.
    fields = text[text.rfind(")") + 2:].split()
    if len(fields) < 22:
        raise ValueError("incomplete proc stat")
    # fields[0] is Linux stat field 3.
    return (int(fields[19]), int(fields[11]) + int(fields[12]), int(fields[21]))


def allocated(root):
    """Count allocated blocks, including temporary files and directories.
    Deduplicate hard links; refuse symlinks and nonregular special files.
    A changing tree is an incomplete observation, not a hard quota proof.
    """
    stack = [root]
    seen = set()
    total = 0
    while stack:
        path = stack.pop()
        st = path.lstat()
        if not (stat.S_ISREG(st.st_mode) or stat.S_ISDIR(st.st_mode)):
            raise ValueError("unexpected file type in staging root")
        key = st.st_dev, st.st_ino
        if key in seen:
            continue
        seen.add(key)
        if len(seen) > 100_000:
            raise ValueError("too many staging entries")
        total += st.st_blocks * 512
        if stat.S_ISDIR(st.st_mode):
            stack.extend(path.iterdir())
    return total


def sample(root, pid, expected_start):
    if pid <= 1 or expected_start <= 0:
        raise ValueError("explicit process PID and start ticks required")
    root = pathlib.Path(root)
    if not root.is_absolute() or root.resolve(strict=True) != root or root == pathlib.Path("/"):
        raise ValueError("absolute non-symlink staging root required")
    marker = root / ".marketdepth-vnext-staging"
    if not stat.S_ISREG(marker.lstat().st_mode) or marker.stat().st_size != len(MARKER) or marker.read_bytes() != MARKER:
        raise ValueError("invalid staging marker")
    proc = pathlib.Path("/proc") / str(pid)
    before = proc_stat((proc / "stat").read_text())
    if before[0] != expected_start:
        raise ValueError("process identity changed")
    boot = pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    start_ns = time.monotonic_ns()
    used = allocated(root)
    fs = os.statvfs(root)
    after = proc_stat((proc / "stat").read_text())
    if before[0] != after[0] or after[1] < before[1] or after[2] < 0:
        raise ValueError("process identity/counters changed")
    end_ns = time.monotonic_ns()
    return {
        "version": "staging-resource-v1",
        "sample_at_ms": time.time_ns() // 1_000_000,
        "monotonic_ns": end_ns,
        "sample_duration_ns": end_ns - start_ns,
        "boot_id": boot,
        "pid": pid,
        "process_start_ticks": expected_start,
        "clock_ticks_per_second": os.sysconf("SC_CLK_TCK"),
        "cpu_ticks": after[1],
        "rss_bytes": after[2] * os.sysconf("SC_PAGE_SIZE"),
        "allocated_bytes": used,
        "filesystem_free_bytes": fs.f_bavail * fs.f_frsize,
        "capacity_limit_bytes": HARD_BYTES,
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", required=True)
    p.add_argument("--pid", type=int, required=True)
    p.add_argument("--start-ticks", type=int, required=True)
    args = p.parse_args()
    try:
        print(json.dumps(sample(args.root, args.pid, args.start_ticks), sort_keys=True))
    except (OSError, ValueError) as exc:
        p.exit(1, "sample failed: " + str(exc) + "\n")


if __name__ == "__main__":
    main()

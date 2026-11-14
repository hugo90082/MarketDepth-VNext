#!/usr/bin/env python3
"""Read-only Linux preflight for a NEW isolated MarketDepth staging root.

No mkdir, bind, launch, network call, credential contents, or service changes.
A clear observation is NOT permission to deploy or proof of sufficient RAM.
"""
import argparse
import hashlib
import json
import os
import pathlib
import platform
import re
import stat
import struct

HASH = re.compile(r"[0-9a-f]{64}")
MIN_FREE = 2_000_000_000
PORT = 18082


def clean_absolute(value):
    p = pathlib.Path(value)
    if not p.is_absolute() or str(p) != value or ".." in p.parts or p == pathlib.Path("/"):
        raise ValueError("explicit normalized absolute non-root path required")
    return p


def regular(path):
    if path.resolve(strict=True) != path:
        raise ValueError("symlink path refused")
    s = path.lstat()
    if not stat.S_ISREG(s.st_mode):
        raise ValueError("regular file required")
    return s


def binary_identity(path, expected):
    st = regular(path)
    if not HASH.fullmatch(expected) or not 0 < st.st_size <= 200_000_000:
        raise ValueError("bounded binary and SHA256 required")
    if st.st_mode & (stat.S_ISUID | stat.S_ISGID | 0o022) or not os.access(path, os.X_OK):
        raise ValueError("unsafe or nonexecutable binary")
    h = hashlib.sha256()
    with path.open("rb") as f:
        header = f.read(64)
        if len(header) < 64 or header[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<H", header, 18)[0] != 62:
            raise ValueError("expected Linux amd64 ELF")
        h.update(header)
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
        after = os.fstat(f.fileno())
        if (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise ValueError("binary changed during check")
    if h.hexdigest() != expected:
        raise ValueError("binary SHA256 mismatch")


def private_credential(path):
    st = regular(path)
    if st.st_uid != os.geteuid() or stat.S_IMODE(st.st_mode) != 0o600 or not 0 < st.st_size <= 1024 * 1024:
        raise ValueError("credential owner/mode/size invalid")
    # Deliberately do not read, hash, print or authenticate credential bytes.


def meminfo(text):
    vals = {}
    for line in text.splitlines():
        fields = line.split()
        if fields and fields[0] in ("MemTotal:", "MemAvailable:", "SwapTotal:", "SwapFree:"):
            if len(fields) != 3 or fields[2] != "kB" or fields[0] in vals:
                raise ValueError("invalid meminfo")
            vals[fields[0]] = int(fields[1]) * 1024
    if set(vals) != {"MemTotal:", "MemAvailable:", "SwapTotal:", "SwapFree:"} or min(vals.values()) < 0:
        raise ValueError("incomplete memory observation")
    return vals


def port_listeners(text, port=PORT):
    count = 0
    for line in text.splitlines()[1:]:
        cols = line.split()
        if len(cols) < 4:
            raise ValueError("invalid proc net table")
        if cols[3] == "0A" and int(cols[1].rsplit(":", 1)[1], 16) == port:
            count += 1
    return count


def inspect(root, old_root, binary, digest, credential=None):
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        raise ValueError("expected Linux amd64 host")
    root, old_root, binary = map(clean_absolute, (root, old_root, binary))
    if root.parent.resolve(strict=True) != root.parent or old_root.resolve(strict=True) != old_root or not old_root.is_dir():
        raise ValueError("existing non-symlink parent and old root required")
    if root == old_root or root in old_root.parents or old_root in root.parents:
        raise ValueError("staging and existing production roots overlap")
    if binary == root or root in binary.parents or old_root in binary.parents:
        raise ValueError("binary must be outside data roots")
    try:
        root.lstat()
    except FileNotFoundError:
        pass
    else:
        raise ValueError("staging root must not exist")
    parent = root.parent.stat()
    if not stat.S_ISDIR(parent.st_mode) or not os.access(root.parent, os.W_OK | os.X_OK):
        raise ValueError("staging parent not writable")
    if parent.st_mode & 0o022:
        raise ValueError("staging parent must not be group/world writable")
    binary_identity(binary, digest)
    if credential is not None:
        cp = clean_absolute(credential)
        if root in cp.parents or old_root in cp.parents or cp == binary:
            raise ValueError("credential must be outside data roots and binary")
        private_credential(cp)
    m = meminfo(pathlib.Path("/proc/meminfo").read_text())
    fs = os.statvfs(root.parent)
    free = fs.f_bavail * fs.f_frsize
    listeners = sum(port_listeners(pathlib.Path("/proc/net", name).read_text()) for name in ("tcp", "tcp6"))
    reasons = []
    if free < MIN_FREE:
        reasons.append("insufficient_free_disk_for_1GB_data_plus_1GB_reserve")
    if listeners:
        reasons.append("port_18082_already_listening")
    return {
        "version": "staging-host-preflight-v1",
        "binary_sha256": digest,
        "staging_root_absent": True,
        "old_root_disjoint": True,
        "credential_metadata_checked": credential is not None,
        "credential_contents_checked": False,
        "filesystem_free_bytes": free,
        "port_18082_listener_count": listeners,
        "mem_total_bytes": m["MemTotal:"],
        "mem_available_bytes": m["MemAvailable:"],
        "swap_total_bytes": m["SwapTotal:"],
        "swap_free_bytes": m["SwapFree:"],
        "logical_cpus": os.cpu_count(),
        "observed_blockers": reasons,
        "requires_memory_and_old_service_review": True,
        "deployment_approved": False,
        "production_ready": False,
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--new-root", required=True)
    p.add_argument("--old-root", required=True)
    p.add_argument("--binary", required=True)
    p.add_argument("--binary-sha256", required=True)
    p.add_argument("--credential")
    a = p.parse_args()
    try:
        result = inspect(a.new_root, a.old_root, a.binary, a.binary_sha256, a.credential)
        print(json.dumps(result, indent=2, sort_keys=True))
    except (OSError, ValueError) as e:
        # Never print path arguments or credential content.
        p.exit(1, "preflight failed: " + (str(e) if isinstance(e, ValueError) else type(e).__name__) + "\n")
    if result["observed_blockers"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()

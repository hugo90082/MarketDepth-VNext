"""Offline, read-only inventory of a legacy gzip JSONL export.

No mapping, no database writes, no cloud access. A successful inventory is
not an import approval. Limits are engineering defaults, not format assumptions.
"""
import argparse
import gzip
import hashlib
import json
import os
import stat
import sys
from collections import Counter

MAX_LINE = 4 * 1024 * 1024
MAX_KEYS = 512
MAX_DEPTH = 64


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def bad_constant(value):
    raise ValueError("nonfinite JSON constant: " + value)


def finite_float(value):
    import math
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("nonfinite JSON number")
    return result


def check_depth(value, depth=0):
    if depth > MAX_DEPTH:
        raise ValueError("JSON nesting limit")
    if isinstance(value, dict):
        for child in value.values():
            check_depth(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            check_depth(child, depth + 1)


def identity(st):
    return st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns


def inventory(path, max_uncompressed=20 * 1024**3):
    if max_uncompressed <= 0:
        raise ValueError("positive uncompressed limit required")
    # Open once, no following symlinks on platforms supporting O_NOFOLLOW.
    with open(path, "rb", opener=lambda p, flags: os.open(
            p, flags | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))) as raw:
        before = os.fstat(raw.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("regular input file required")
        compressed_hash = hashlib.sha256()
        while chunk := raw.read(1024 * 1024):
            compressed_hash.update(chunk)
        raw.seek(0)
        if raw.read(2) != b"\x1f\x8b":
            raise ValueError("gzip header required")
        raw.seek(0)
        digest = hashlib.sha256()
        keys = Counter()
        types = Counter()
        lines = total = objects = 0
        with gzip.GzipFile(fileobj=raw, mode="rb") as stream:
            while True:
                line = stream.readline(MAX_LINE + 1)
                if not line:
                    break
                lines += 1
                total += len(line)
                if len(line) > MAX_LINE or total > max_uncompressed:
                    raise ValueError("input expansion or line limit exceeded")
                digest.update(line)
                try:
                    value = json.loads(line.decode("utf-8"), object_pairs_hook=unique_object,
                                       parse_constant=bad_constant, parse_float=finite_float)
                    check_depth(value)
                except (ValueError, RecursionError) as exc:
                    raise ValueError(f"invalid JSON at line {lines}") from exc
                if not isinstance(value, dict):
                    raise ValueError(f"non-object record at line {lines}")
                objects += 1
                for key, item in value.items():
                    if key not in keys and len(keys) >= MAX_KEYS:
                        raise ValueError("too many distinct top-level keys")
                    if len(key) > 256:
                        raise ValueError("top-level key too long")
                    keys[key] += 1
                    types[(key, type(item).__name__)] += 1
        if not objects:
            raise ValueError("empty export")
        if identity(before) != identity(os.fstat(raw.fileno())):
            raise ValueError("input changed during inventory")
        return {
            "status": "inventory_only",
            "mapping_approved": False,
            "compressed_sha256": compressed_hash.hexdigest(),
            "uncompressed_sha256": digest.hexdigest(),
            "compressed_bytes": before.st_size,
            "uncompressed_bytes": total,
            "records": objects,
            "top_level_keys": dict(sorted(keys.items())),
            "top_level_types": {key: {typ: count for (k, typ), count in sorted(types.items())
                                      if k == key} for key in sorted(keys)},
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="immutable gzip JSONL input")
    parser.add_argument("--max-uncompressed-bytes", type=int, default=20 * 1024**3)
    args = parser.parse_args()
    try:
        result = inventory(args.input, args.max_uncompressed_bytes)
    except (OSError, EOFError, ValueError, RecursionError) as exc:
        print(f"inventory refused: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=True, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

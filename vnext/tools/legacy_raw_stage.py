"""Build a new offline raw-history staging database, never a live day DB."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys

from legacy_inventory import inventory

SCHEMA = """
CREATE TABLE stage_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE raw_payload(
    sha256 TEXT PRIMARY KEY, body BLOB NOT NULL
) WITHOUT ROWID;
CREATE TABLE occurrence(
    line_no INTEGER PRIMARY KEY CHECK(line_no > 0),
    sha256 TEXT NOT NULL REFERENCES raw_payload(sha256)
);
CREATE INDEX occurrence_sha ON occurrence(sha256);
"""
MARKER = ".legacy-stage-building"
DB_NAME = "legacy-raw.sqlite"


def build_stage(source, output, expected_sha256, max_uncompressed=20 * 1024**3):
    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise ValueError("expected compressed SHA256 required")
    root = Path(output)
    # A fresh directory is mandatory, even if an old stage exists.
    root.mkdir(mode=0o700, parents=False, exist_ok=False)
    marker = root / MARKER
    with marker.open("x", encoding="ascii") as f:
        f.write("incomplete\n")
        f.flush()
        os.fsync(f.fileno())
    path = root / DB_NAME
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    db = sqlite3.connect(path)
    try:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA journal_mode=DELETE")
        db.execute("PRAGMA synchronous=FULL")
        db.execute("PRAGMA cache_size=-8192")
        db.executescript(SCHEMA)
        db.execute("INSERT INTO stage_meta VALUES('state','building')")
        db.commit()
        db.execute("BEGIN IMMEDIATE")
        unique = 0
        duplicates = 0

        def accept(line_no, raw, value):
            nonlocal unique, duplicates
            digest = hashlib.sha256(raw).hexdigest()
            old = db.execute("SELECT body FROM raw_payload WHERE sha256=?", (digest,)).fetchone()
            if old is None:
                db.execute("INSERT INTO raw_payload VALUES(?,?)", (digest, raw))
                unique += 1
            elif old[0] == raw:
                duplicates += 1
            else:
                raise ValueError("raw SHA256 collision")
            db.execute("INSERT INTO occurrence VALUES(?,?)", (line_no, digest))

        report = inventory(source, max_uncompressed, on_record=accept)
        if report["compressed_sha256"] != expected_sha256:
            raise ValueError("source SHA256 differs from approved input")
        if report["records"] != unique + duplicates:
            raise ValueError("stage count mismatch")
        if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("stage foreign key check failed")
        if db.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
            raise ValueError("stage SQLite integrity check failed")
        result = {**report, "status": "raw_stage_only",
                  "unique_raw_lines": unique, "duplicate_raw_lines": duplicates}
        db.execute("INSERT INTO stage_meta VALUES('report',?)",
                   (json.dumps(result, sort_keys=True),))
        db.execute("UPDATE stage_meta SET value='complete' WHERE key='state'")
        db.commit()
    finally:
        db.close()
    # Complete is visible only after committed data and marker removal.
    # A crash with the marker present is deliberately not auto-resumed.
    with path.open("rb") as f:
        os.fsync(f.fileno())
    if os.name == "posix":
        dirfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dirfd)
            marker.unlink()
            os.fsync(dirfd)
        finally:
            os.close(dirfd)
    else:
        marker.unlink()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("--output-new-dir", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--max-uncompressed-bytes", type=int, default=20 * 1024**3)
    args = parser.parse_args()
    try:
        report = build_stage(args.source, args.output_new_dir,
                             args.expected_sha256, args.max_uncompressed_bytes)
    except (OSError, ValueError, EOFError, sqlite3.Error) as exc:
        print(f"raw stage refused: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())

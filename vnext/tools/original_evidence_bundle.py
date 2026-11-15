#!/usr/bin/env python3
"""Offline original-evidence bundle, never a Drive client or import approval."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest

BLOCK = 1 << 20
RAW_LIMIT = 20 << 30
SPECS = (
    ("historical_2026-11-13", "b9397b4f92b3c84d5d2271a411f47afe3eda0d24d3800e2f9176ec18c49f211e", None, None, None),
    ("candidate_2026-11-15", "88097e060d0c4cdd689971641e14b7a41c0857bcf2104b15ba119fe22d65e79b", 165937369, "d1d4cf64e04eb19bc7412d70d0cbb5904c8adb8ad867fcb79ce9caf70dec243e", 415340421),
)

def open_regular(p):
    p = Path(p)
    if p.resolve(strict=True) != p.absolute():
        raise ValueError("noncanonical or symlink path")
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError("regular file required")
        return os.fdopen(fd, "rb")
    except BaseException:
        os.close(fd)
        raise

def fingerprint(st):
    return (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)

def unchanged(f, p, before):
    if fingerprint(os.fstat(f.fileno())) != before or fingerprint(os.stat(p, follow_symlinks=False)) != before:
        raise ValueError("file changed during verification")

def examine(p, spec, copy_to=None):
    role, expected, size, raw_expected, raw_size = spec
    h = hashlib.sha256()
    n = 0
    with open_regular(p) as f:
        before = fingerprint(os.fstat(f.fileno()))
        # Copy original compressed bytes exactly, never recompress.
        out = None
        try:
            if copy_to is not None:
                fd = os.open(copy_to, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                out = os.fdopen(fd, "wb")
            while chunk := f.read(BLOCK):
                n += len(chunk)
                if n > (size if size is not None else RAW_LIMIT):
                    raise ValueError("compressed limit exceeded")
                h.update(chunk)
                if out:
                    out.write(chunk)
            unchanged(f, p, before)
            if n == 0 or h.hexdigest() != expected or (size is not None and n != size):
                raise ValueError("compressed evidence does not match pinned source")
            if out:
                out.flush()
                os.fsync(out.fileno())
        finally:
            if out:
                out.close()
        f.seek(0)
        raw = hashlib.sha256()
        count = 0
        with gzip.GzipFile(fileobj=f) as gz:
            while chunk := gz.read(BLOCK):
                count += len(chunk)
                if count > (raw_size if raw_size is not None else RAW_LIMIT):
                    raise ValueError("decompressed limit exceeded")
                raw.update(chunk)
        unchanged(f, p, before)
        if count == 0 or (raw_expected is not None and raw.hexdigest() != raw_expected) or (raw_size is not None and count != raw_size):
            raise ValueError("raw evidence does not match pinned source")
    return {"role": role, "name": expected + ".jsonl.gz", "sha256": expected,
            "bytes": n, "raw_sha256": raw.hexdigest(), "raw_bytes": count}

def manifest_bytes(rows):
    return (json.dumps({"contract": "MD-ORIGINAL-EVIDENCE-1",
                        "namespace_candidate": "MarketDepth-VNext-evidence",
                        "publication_approved": False, "production_ready": False,
                        "tail_status": "not_yet_reviewed",
                        "files": rows}, sort_keys=True, separators=(",", ":")) + "\n").encode()

def private_dir(p):
    p = Path(p)
    if p.resolve(strict=True) != p.absolute():
        raise ValueError("canonical evidence directory required")
    st = p.stat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.geteuid() or st.st_mode & 0o077:
        raise ValueError("private owner-only directory required")

def sync_dir(p):
    fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def verify(root, want, specs=SPECS):
    root = Path(root)
    private_dir(root)
    names = {"manifest.json"} | {s[1] + ".jsonl.gz" for s in specs}
    if {p.name for p in root.iterdir()} != names:
        raise ValueError("unexpected, incomplete, or missing evidence objects")
    with open_regular(root / "manifest.json") as f:
        before = fingerprint(os.fstat(f.fileno()))
        b = f.read(65537)
        unchanged(f, root / "manifest.json", before)
    if len(b) > 65536 or hashlib.sha256(b).hexdigest() != want:
        raise ValueError("manifest digest mismatch")
    rows = [examine(root / (s[1] + ".jsonl.gz"), s) for s in specs]
    if b != manifest_bytes(rows):
        raise ValueError("manifest not identical to independently verified evidence")
    return {"local_readback_verified": True, "manifest_sha256": want, "files": rows,
            "remote_verified": False, "publication_approved": False}

def prepare(root, sources, specs=SPECS):
    root = Path(root)
    if len(sources) != len(specs) or root.parent.resolve(strict=True) != root.parent.absolute():
        raise ValueError("explicit sources and canonical parent required")
    # Exclusive fresh directory: partial builds are retained and fail verify.
    root.mkdir(mode=0o700)
    rows = [examine(p, s, root / (s[1] + ".jsonl.gz")) for p, s in zip(sources, specs)]
    b = manifest_bytes(rows)
    with (root / "manifest.json").open("xb") as f:
        os.fchmod(f.fileno(), 0o600)
        f.write(b)
        f.flush()
        os.fsync(f.fileno())
    sync_dir(root)
    sync_dir(root.parent)
    return verify(root, hashlib.sha256(b).hexdigest(), specs)

class BundleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.sources = []
        self.specs = []
        for i in range(2):
            p = self.base / f"source{i}.gz"
            raw = (f'{{"v":{i}}}\n').encode()
            b = gzip.compress(raw, mtime=0)
            p.write_bytes(b)
            self.sources.append(p)
            self.specs.append((f"source{i}", hashlib.sha256(b).hexdigest(), len(b),
                               hashlib.sha256(raw).hexdigest(), len(raw)))
        self.root = self.base / "bundle"

    def test_exact_readback_and_no_overwrite(self):
        r = prepare(self.root, self.sources, self.specs)
        self.assertTrue(r["local_readback_verified"])
        self.assertFalse(r["remote_verified"])
        self.assertEqual(r, verify(self.root, r["manifest_sha256"], self.specs))
        for p, s in zip(self.sources, self.specs):
            self.assertEqual(p.read_bytes(), (self.root / (s[1] + ".jsonl.gz")).read_bytes())
        with self.assertRaises(FileExistsError):
            prepare(self.root, self.sources, self.specs)

    def test_wrong_source_fails_closed(self):
        with self.assertRaises(ValueError):
            prepare(self.root, self.sources[::-1], self.specs)
        with self.assertRaises(ValueError):
            verify(self.root, "0" * 64, self.specs)

    def test_corruption_and_extra_file(self):
        r = prepare(self.root, self.sources, self.specs)
        p = self.root / "extra"
        p.touch()
        with self.assertRaises(ValueError):
            verify(self.root, r["manifest_sha256"], self.specs)
        p.unlink()
        p = self.root / (self.specs[0][1] + ".jsonl.gz")
        p.write_bytes(b"bad")
        with self.assertRaises(ValueError):
            verify(self.root, r["manifest_sha256"], self.specs)

    def test_invalid_gzip_even_with_matching_compressed_hash(self):
        p = self.sources[0]
        b = p.read_bytes()[:-4]
        p.write_bytes(b)
        s = ("bad", hashlib.sha256(b).hexdigest(), len(b), None, None)
        with self.assertRaises((EOFError, OSError)):
            examine(p, s)

    def test_symlink_and_wrong_manifest(self):
        p = self.base / "link"
        p.symlink_to(self.sources[0])
        with self.assertRaises(ValueError):
            examine(p, self.specs[0])
        r = prepare(self.root, self.sources, self.specs)
        with self.assertRaises(ValueError):
            verify(self.root, "0" * 64, self.specs)
        self.assertFalse(r["publication_approved"])

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="mode", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--old", type=Path, required=True)
    p.add_argument("--candidate", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    v = sub.add_parser("verify")
    v.add_argument("--bundle", type=Path, required=True)
    v.add_argument("--manifest-sha256", required=True)
    sub.add_parser("self-test")
    a = ap.parse_args()
    if a.mode == "self-test":
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(BundleTest)
        raise SystemExit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
    r = prepare(a.output, [a.old, a.candidate]) if a.mode == "prepare" else verify(a.bundle, a.manifest_sha256)
    print(json.dumps(r, sort_keys=True))

if __name__ == "__main__":
    main()

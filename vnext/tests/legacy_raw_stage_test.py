import gzip
import hashlib
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from legacy_raw_stage import build_stage, DB_NAME, MARKER


class RawStageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / "source.gz"
        self.output = self.root / "stage"

    def put(self, raw):
        self.source.write_bytes(gzip.compress(raw, mtime=0))
        return hashlib.sha256(self.source.read_bytes()).hexdigest()

    def test_exact_bytes_duplicates_and_no_overwrite(self):
        line = b'{"t":123,"x":null,"id":9007199254740993}\n'
        other = b'{"t":123,"x":0,"id":9007199254740993}\n'
        raw = line + other + line
        sha = self.put(raw)
        source_before = self.source.read_bytes()
        result = build_stage(self.source, self.output, sha)
        self.assertEqual(result["records"], 3)
        self.assertEqual(result["unique_raw_lines"], 2)
        self.assertEqual(result["duplicate_raw_lines"], 1)
        self.assertFalse(result["mapping_approved"])
        self.assertFalse((self.output / MARKER).exists())
        with sqlite3.connect(self.output / DB_NAME) as db:
            rows = db.execute("SELECT p.body FROM occurrence o JOIN raw_payload p USING(sha256) ORDER BY line_no").fetchall()
            self.assertEqual(b"".join(row[0] for row in rows), raw)
            self.assertEqual(db.execute("SELECT value FROM stage_meta WHERE key='state'").fetchone(), ("complete",))
        with self.assertRaises(FileExistsError):
            build_stage(self.source, self.output, sha)
        self.assertEqual(self.source.read_bytes(), source_before)

    def test_bad_sha_is_incomplete(self):
        self.put(b'{"x":1}\n')
        with self.assertRaises(ValueError):
            build_stage(self.source, self.output, "0" * 64)
        self.assertTrue((self.output / MARKER).is_file())
        with sqlite3.connect(self.output / DB_NAME) as db:
            self.assertEqual(db.execute("SELECT value FROM stage_meta WHERE key='state'").fetchone(), ("building",))
            self.assertEqual(db.execute("SELECT count(*) FROM occurrence").fetchone(), (0,))

    def test_invalid_json_rolls_back_prior_rows(self):
        sha = self.put(b'{"x":1}\n{"x":NaN}\n')
        with self.assertRaises(ValueError):
            build_stage(self.source, self.output, sha)
        self.assertTrue((self.output / MARKER).is_file())
        with sqlite3.connect(self.output / DB_NAME) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM raw_payload").fetchone(), (0,))

    def test_truncated_gzip_and_existing_dir(self):
        self.put(b'{"x":1}\n')
        self.source.write_bytes(self.source.read_bytes()[:-4])
        sha = hashlib.sha256(self.source.read_bytes()).hexdigest()
        with self.assertRaises((EOFError, OSError)):
            build_stage(self.source, self.output, sha)
        self.assertTrue((self.output / MARKER).is_file())
        with self.assertRaises(FileExistsError):
            build_stage(self.source, self.output, sha)


if __name__ == "__main__":
    unittest.main()

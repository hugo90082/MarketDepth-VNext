"""Isolated synthetic fixtures only; no production data."""
import gzip
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "legacy_inventory", Path(__file__).resolve().parents[1] / "tools" / "legacy_inventory.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class InventoryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "fixture.jsonl.gz"

    def put(self, raw):
        self.path.write_bytes(gzip.compress(raw, mtime=0))

    def test_hash_counts_and_no_mutation(self):
        raw = b'{"t":0,"x":null}\n{"t":60,"x":0,"id":9007199254740993}\n'
        self.put(raw)
        original = self.path.read_bytes()
        result = mod.inventory(self.path)
        self.assertEqual(result["records"], 2)
        self.assertEqual(result["compressed_sha256"], hashlib.sha256(original).hexdigest())
        self.assertEqual(result["uncompressed_sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(result["top_level_types"]["x"], {"NoneType": 1, "int": 1})
        self.assertFalse(result["mapping_approved"])
        self.assertEqual(result, mod.inventory(self.path))
        self.assertEqual(original, self.path.read_bytes())

    def test_invalid_inputs(self):
        for raw in (b'', b'[]\n', b'\n', b'{"x":1,"x":2}\n',
                    b'{"x":{"a":1,"a":2}}\n', b'{"x":NaN}\n',
                    b'{"x":1e999}\n', b'{"x":', b'{"x":"\xff"}\n'):
            with self.subTest(raw=raw):
                self.put(raw)
                with self.assertRaises(ValueError):
                    mod.inventory(self.path)

    def test_corruption_and_bounds(self):
        self.put(b'{"x":0}\n')
        with self.assertRaises(ValueError):
            mod.inventory(self.path, 2)
        self.path.write_bytes(self.path.read_bytes()[:-4])
        with self.assertRaises((EOFError, OSError)):
            mod.inventory(self.path)
        self.path.write_bytes(b'not gzip')
        with self.assertRaises(ValueError):
            mod.inventory(self.path)
        self.put(b'{"x":"' + b'a' * mod.MAX_LINE + b'"}\n')
        with self.assertRaises(ValueError):
            mod.inventory(self.path)

    def test_concat_members(self):
        self.path.write_bytes(gzip.compress(b'{"x":1}\n') + gzip.compress(b'{"x":2}\n'))
        self.assertEqual(mod.inventory(self.path)["records"], 2)


if __name__ == "__main__":
    unittest.main()

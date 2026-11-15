#!/usr/bin/env python3
"""Generate a reviewed, non-secret SOURCE configuration snapshot; never runtime settings."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

# Exact reviewed Git blobs. Any drift requires reviewing metadata and updating pins.
PINS = {
    "contract/schema.sql": "29770d1f04825af309fee3d02b768259969611ec",
    "contract/openapi.json": "1bc4e50b6969648e5c26838604fcc43cd490ba0f",
    "internal/model/model.go": "a709e5cddc77e827436350c70e90e91115aab70a",
    "internal/httpapi/api.go": "3bac8da5e2fb74b13a87e179a0580514a9944736",
    "internal/collector/spot/depth.go": "b95ce02346d2bb560e06b309b5b001401a0b7d1f",
    "internal/collector/futures/rest.go": "737bf868c4fd844773b565cc3d582f616bf0fa65",
}
ASSETS = ["BTC", "ETH", "SOL"]

def git_blob(b):
    return hashlib.sha1(b"blob " + str(len(b)).encode() + b"\0" + b).hexdigest()

def source_hashes(root, pins):
    hashes = {}
    for name, want in sorted(pins.items()):
        p = root / name
        if p.resolve(strict=True) != p.absolute() or not p.is_file():
            raise ValueError("reviewed source file required")
        with p.open("rb") as f:
            b = f.read((4 << 20) + 1)
        if len(b) > 4 << 20 or git_blob(b) != want:
            raise ValueError("source drift; review configuration before export: " + name)
        hashes[name] = {"git_blob": want, "sha256": hashlib.sha256(b).hexdigest()}
    return hashes

def snapshot(root, producer, pins=PINS):
    if not re.fullmatch("[0-9a-f]{40}", producer):
        raise ValueError("exact Git commit required")
    hashes = source_hashes(root, pins)
    return {
        "evidence_contract": "MD-PUBLIC-SOURCE-CONFIG-1",
        "configuration_kind": "reviewed_source_baseline_not_runtime",
        "production_ready": False,
        "publication_approved": False,
        "producer_commit": producer,
        "market_contract": "MD-VNEXT-1",
        "timezone": "Asia/Taipei",
        "timestamp_unit": "epoch_ms",
        "assets": ASSETS,
        "spot_symbols": {
            "binance": ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
            "coinbase": ["BTC-USD", "ETH-USD", "SOL-USD"],
            "kraken": ["XBTUSD", "ETHUSD", "SOLUSD"],
            "bitfinex": ["tBTCUSD", "tETHUSD", "tSOLUSD"],
        },
        "futures_venue": "binance_usdm",
        "futures_symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
        "zones_bps_half_open": [[0,100],[100,200],[200,300],[300,500],[500,750]],
        "cadence_ms": {"spot_depth": 60000, "futures_10s": 10000, "futures_1m": 60000},
        "daily_expected_keys": {"spot_depth": 17280, "futures_10s": 25920, "futures_1m": 4320},
        "all4_min_venues": 2,
        "null_semantics": "unknown=null; confirmed empty=0",
        "normalization": {"mid": "(best_bid+best_ask)/2", "notional": "sum(price*qty)",
                          "bid_distance_bps": "(mid-price)/mid*10000",
                          "ask_distance_bps": "(price-mid)/mid*10000",
                          "coverage": "independent_side_observed_not_trusted",
                          "bitfinex": "P1_0_100_P2_deeper_no_cross_fill"},
        "reviewed_source_files": hashes,
    }

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(ConfigTest)
        raise SystemExit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
    root = Path(__file__).resolve().parents[1]
    producer = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    # Bind pinned working-tree blobs to the actual commit as well.
    for name, want in PINS.items():
        committed = subprocess.check_output(["git", "-C", str(root), "rev-parse", producer + ":vnext/" + name], text=True).strip()
        if committed != want:
            raise ValueError("commit source drift: " + name)
    print(json.dumps(snapshot(root, producer), sort_keys=True, separators=(",", ":")))

class ConfigTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.p = self.root / "reviewed"
        self.p.write_bytes(b"reviewed public data")
        self.pins = {"reviewed": git_blob(self.p.read_bytes())}
        (self.root / ".env").write_text("SECRET=must-not-appear")

    def test_only_fixed_public_fields(self):
        r = snapshot(self.root, "a"*40, self.pins)
        b = json.dumps(r)
        self.assertNotIn("must-not-appear", b)
        self.assertNotIn("reviewed public data", b)
        self.assertFalse(r["production_ready"])
        self.assertEqual(sum(r["daily_expected_keys"].values()), 47520)

    def test_drift_and_invalid_commit(self):
        with self.assertRaises(ValueError):
            snapshot(self.root, "secret", self.pins)
        self.p.write_bytes(b"changed")
        with self.assertRaises(ValueError):
            snapshot(self.root, "a"*40, self.pins)

    def test_symlink(self):
        other = self.root / "other"
        self.p.rename(other)
        self.p.symlink_to(other)
        with self.assertRaises(ValueError):
            snapshot(self.root, "a"*40, self.pins)

if __name__ == "__main__":
    main()

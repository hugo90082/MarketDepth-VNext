import datetime as dt
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/"tools"))
from phase7_evidence import audit_day, build_report, EXPECTED, BINS, TZ
from resource_probe_test import samples

PRODUCER="a"*40
DAY="2026-11-14"
START=int(dt.datetime(2026,11,14,tzinfo=TZ).timestamp()*1000)


def day_report():
    streams=[]
    for (kind,venue,asset),n in EXPECTED.items():
        s=dict(kind=kind,asset=asset,expected=n,present=n,absent=0,status_counts={"missing":n},
            missing_intervals=[],availability_lag_p50_ms=0,availability_lag_p95_ms=0,availability_lag_max_ms=0,
            bid_observed_750=0,ask_observed_750=0,bid_trusted_750=0,ask_trusted_750=0,
            paired_trusted_750=0,paired_complete_750=0,paired_trusted_bins={k:0 for k in BINS} if venue else None)
        if venue:s["venue"]=venue
        streams.append(s)
    return dict(contract_id="MD-VNEXT-1",producer_commit=PRODUCER,production_ready=False,raw_sha256="b"*64,
                day=DAY,sealed_at=START+86400000+300000,revision=1,events=0,streams=streams,
                expected=47520,present=47520,absent=0,grid_complete=True,
                all4_paired_minutes_750={"BTC":0,"ETH":0,"SOL":0})


class EvidenceTests(unittest.TestCase):
    def test_complete_grid_is_not_market_data(self):
        r=audit_day(day_report(),PRODUCER)
        self.assertEqual(r["missing_status"],47520)
        for mutate in (
            lambda d:d["streams"].pop(),
            lambda d:d["streams"].__setitem__(1,d["streams"][0]),
            lambda d:d["streams"][0]["status_counts"].update({"missing":1}),
            lambda d:d["streams"][0].update({"paired_complete_750":1}),
            lambda d:d.update({"production_ready":True}),
            lambda d:d.update({"grid_complete":False}),
            lambda d:d["all4_paired_minutes_750"].update({"BTC":1}),
        ):
            d=day_report();mutate(d)
            with self.assertRaises(ValueError):
                audit_day(d,PRODUCER)

    def test_gap_accounting(self):
        d=day_report();s=d["streams"][0]
        s["present"]-=1;s["absent"]=1;s["status_counts"]["missing"]-=1
        s["missing_intervals"]=[{"from":START,"to":START+60000,"reason":"grid_missing"}]
        d.update(present=47519,absent=1,grid_complete=False)
        self.assertEqual(audit_day(d,PRODUCER)["absent"],1)
        s["missing_intervals"][0]["to"]+=1
        with self.assertRaises(ValueError):audit_day(d,PRODUCER)

    def test_report_hashes_recomputed_and_no_approval(self):
        with tempfile.TemporaryDirectory() as td:
            root=pathlib.Path(td)
            resources=root/"resource.jsonl";report=root/"day.json"
            resources.write_text("".join(json.dumps(s)+"\n" for s in samples(1443)))
            report.write_text(json.dumps(day_report()))
            r=build_report(resources,[report],PRODUCER,START)
            self.assertEqual(r["expected_full_days"],[DAY])
            self.assertEqual(r["observed_blockers"],["missing_market_rows_require_review"])
            self.assertFalse(r["production_ready"])
            self.assertFalse(r["cutover_approved"])
            self.assertIn("oom_cgroup_and_restart_logs",r["manual_evidence_required"])
            self.assertIn("missing_full_day_audits",build_report(resources,[],PRODUCER,START)["observed_blockers"])
            with self.assertRaises(ValueError):build_report(resources,[report,report],PRODUCER,START)
            with self.assertRaises(ValueError):build_report(resources,[report],"c"*40,START)


if __name__=="__main__":
    unittest.main()

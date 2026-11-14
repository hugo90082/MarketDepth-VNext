import datetime
import os
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]/"tools"))
from resource_probe import allocated, proc_stat, sample, MARKER
from resource_summary import summarize


def samples(n=4, step=60):
    first = int(datetime.datetime(2026,11,13,23,59,0,tzinfo=datetime.timezone(datetime.timedelta(hours=8))).timestamp()*1000)
    for i in range(n):
        yield dict(version="staging-resource-v1",
            sample_at_ms=first+i*step*1000, monotonic_ns=10**9+i*step*10**9,
            sample_duration_ns=100_000, boot_id="12345678-1234-1234-1234-123456789abc",
            pid=100, process_start_ticks=123, clock_ticks_per_second=100,
            cpu_ticks=i*step*50, rss_bytes=100_000_000+i,
            allocated_bytes=200_000_000+i, filesystem_free_bytes=2_000_000_000,
            capacity_limit_bytes=1_000_000_000)


class ResourceTests(unittest.TestCase):
    def test_proc_and_real_one_shot(self):
        proc = pathlib.Path("/proc/self/stat")
        start, ticks, pages = proc_stat(proc.read_text())
        self.assertGreater(start, 0)
        self.assertGreater(pages, 0)
        with tempfile.TemporaryDirectory() as td:
            root=pathlib.Path(td).resolve()
            (root/".marketdepth-vnext-staging").write_bytes(MARKER)
            (root/"x").write_bytes(b"x"*4096)
            before=allocated(root)
            os.link(root/"x",root/"y")
            self.assertLessEqual(allocated(root)-before,4096)
            s=sample(root,os.getpid(),start)
            self.assertEqual(s["process_start_ticks"],start)
            self.assertGreater(s["rss_bytes"],0)
            with self.assertRaises(ValueError):
                sample(root,os.getpid(),start+1)
            (root/"link").symlink_to(root/"x")
            with self.assertRaises(ValueError):
                allocated(root)

    def test_summary_boundaries_capacity(self):
        data=list(samples(1442))
        r=summarize(data)
        self.assertTrue(r["continuous_window_observed"])
        self.assertEqual(r["taipei_day_boundaries"],2)
        self.assertEqual(r["cpu_percent_one_core"],{"p50":50.0,"p95":50.0,"max":50.0})
        self.assertTrue(r["observed_capacity_ok"])
        self.assertFalse(r["production_ready"])
        data[-1]["allocated_bytes"]=1_000_000_000
        self.assertFalse(summarize(data)["observed_capacity_ok"])
        self.assertFalse(summarize(samples())["continuous_window_observed"])
        self.assertFalse(summarize(samples(2,86460))["continuous_window_observed"])

    def test_restart_bad_clock_and_schema(self):
        for field,value in [("pid",101),("process_start_ticks",124),("cpu_ticks",-1),
                            ("sample_at_ms",1),("rss_bytes",True),("boot_id","bad")]:
            data=list(samples())
            data[-1][field]=value
            with self.assertRaises(ValueError):
                summarize(data)


if __name__=="__main__":
    unittest.main()

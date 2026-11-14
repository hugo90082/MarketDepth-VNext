import hashlib
import pathlib
import struct
import sys
import tempfile
import unittest

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/"tools"))
from staging_preflight import inspect, meminfo, port_listeners


class PreflightTests(unittest.TestCase):
    def test_observations_and_no_mutation(self):
        with tempfile.TemporaryDirectory() as td:
            base=pathlib.Path(td).resolve()
            old=base/"old";old.mkdir()
            root=base/"new"
            binary=base/"binary"
            elf=bytearray(64)
            elf[:6]=b"\x7fELF\x02\x01"
            struct.pack_into("<H",elf,18,62)
            binary.write_bytes(elf)
            binary.chmod(0o700)
            digest=hashlib.sha256(elf).hexdigest()
            credential=base/"cred";credential.write_bytes(b"not parsed")
            credential.chmod(0o600)
            args=(str(root),str(old),str(binary),digest,str(credential))
            report=inspect(*args)
            self.assertTrue(report["staging_root_absent"])
            self.assertTrue(report["credential_metadata_checked"])
            self.assertFalse(report["credential_contents_checked"])
            self.assertFalse(report["deployment_approved"])
            self.assertFalse(root.exists())
            self.assertEqual(credential.read_bytes(),b"not parsed")
            self.assertEqual(list(old.iterdir()),[])
            for i,bad in [(0,str(old/"child")),(3,"a"*64),(4,str(binary))]:
                altered=list(args);altered[i]=bad
                with self.assertRaises(ValueError):
                    inspect(*altered)
            credential.chmod(0o644)
            with self.assertRaises(ValueError):
                inspect(*args)
            credential.chmod(0o600)
            root.mkdir()
            with self.assertRaises(ValueError):
                inspect(*args)

    def test_proc_parsers(self):
        m=meminfo("MemTotal: 512000 kB\nMemAvailable: 400000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n")
        self.assertEqual(m["MemTotal:"],512000*1024)
        with self.assertRaises(ValueError):
            meminfo("MemTotal: 1 kB\n")
        self.assertEqual(port_listeners("header\n0: 0100007F:46A2 00000000:0000 0A\n"),1)
        self.assertEqual(port_listeners("header\n0: 0100007F:46A2 00000000:0000 01\n"),0)


if __name__=="__main__":
    unittest.main()

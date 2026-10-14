#!/usr/bin/env python3
"""Synthetic/local tamper checks for R142 immutable-origin gate."""
import os
import tempfile
from pathlib import Path
import unittest
from car02_r142_provenance_lock_isolated import git_blob_sha1,verify,ProvenanceError,LOCKED

class ReadOnlyProvenance(unittest.TestCase):
    def setUp(self):
        os.environ['CAR02_RELEASE_LOCK']='true';os.environ['R140_SYNTHETIC_QA']='yes'
    def test_01_expected_12_sources(self):self.assertEqual(len(LOCKED),12)
    def test_02_sha_git_object(self):
        self.assertEqual(git_blob_sha1(b'hello\n'),'ce013625030ba8dba906f756967f9e9ca394464a')
    def test_03_sha_rejects_non_bytes(self):
        with self.assertRaises(ProvenanceError):git_blob_sha1('hello')
    def test_04_valid_local(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d)/'fake').write_bytes(b'hello\n')
            p=verify(d,{'fake':git_blob_sha1(b'hello\n')})
            self.assertEqual(p['release'],'NO_GO');self.assertEqual(p['checked'],1)
            self.assertEqual(p['realWorldGatesOpen'],12)
    def test_05_changed_protected_file_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d)/'fake').write_bytes(b'NOT hello\n')
            with self.assertRaisesRegex(ProvenanceError,'R142_ORIGINAL_CHANGED'):
                verify(d,{'fake':git_blob_sha1(b'hello\n')})
    def test_06_missing_source_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ProvenanceError,'R142_MISSING_OR_UNSAFE_SOURCE'):
                verify(d,{'missing':'0'*40})
    def test_07_lock_required(self):
        old=os.environ.pop('CAR02_RELEASE_LOCK')
        try:
            with tempfile.TemporaryDirectory() as d:
                with self.assertRaisesRegex(ProvenanceError,'R142_NO_ISOLATION_LOCK'):verify(d,{})
        finally:os.environ['CAR02_RELEASE_LOCK']=old
    def test_08_r139_python_git_blob_matches_official(self):
        # Tests the known handoff byte SHA when the R139 file is available.
        p=Path(__file__).parent/'car02_r139_pg17_reconciliation_qa.py'
        if not p.exists():self.skipTest('R139 official fixture only in GitHub CI, not needed locally')
        self.assertEqual(git_blob_sha1(p.read_bytes()),LOCKED[p.name])
    def test_09_r139_test_git_blob_matches_official(self):
        p=Path(__file__).parent/'test_car02_r139_reconciliation.py'
        if not p.exists():self.skipTest('R139 official fixture only in GitHub CI, not needed locally')
        self.assertEqual(git_blob_sha1(p.read_bytes()),LOCKED[p.name])
    def test_10_no_production_approval(self):
        with tempfile.TemporaryDirectory() as d:
            p=verify(d,{})
            self.assertEqual(p['migration'],'HOLD');self.assertFalse(p['productionTouched'])

if __name__=='__main__':unittest.main()

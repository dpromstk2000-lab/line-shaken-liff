#!/usr/bin/env python3
"""R151: independent fail-closed adversarial checks for R150 QA proof reader."""
from __future__ import annotations
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import car02_r150_strict_bundle_isolated as s
from test_car02_r147_evidence_chain import fixture, SHA
import car02_r147_evidence_chain_isolated as old


def inputs():
    vals=fixture()
    chain=old.verify(*vals,SHA)
    return dict(zip(s.INPUT_FILES,vals)) | {'chain':chain}


class R151(unittest.TestCase):
    def setUp(self):
        self.ctx=patch.dict(os.environ,{'CAR02_RELEASE_LOCK':'true',
             'R138_DISPOSABLE_QA':'yes','R139_DISPOSABLE_QA':'yes',
             'R143_DISPOSABLE_QA':'yes'})
        self.ctx.start();self.addCleanup(self.ctx.stop)

    def report(self):return s.validate(inputs(),SHA)
    def reject(self,objects,reason='R150_CHAIN_RECOMPUTE',commit=SHA):
        with self.assertRaisesRegex(s.BundleGateError,reason):
            s.validate(objects,commit)
    def saved_files(self,tmp,objects=None):
        p=Path(tmp)/s.BASE
        p.mkdir()
        for key,name in s.FILES.items():
            (Path(tmp)/name).write_text(json.dumps((objects or inputs())[key],sort_keys=True)+'\n',encoding='utf8')
        return p
    def test_001_positive(self):self.assertEqual(self.report()['version'],'R150')
    def test_002_no_go(self):self.assertEqual(self.report()['release'],'NO_GO')
    def test_003_hold(self):self.assertEqual(self.report()['migration'],'HOLD')
    def test_004_gates_remain_open(self):self.assertEqual(self.report()['realWorldGatesOpen'],12)
    def test_005_no_production(self):self.assertFalse(self.report()['productionAuthorized'])
    def test_006_no_prod_data(self):self.assertFalse(self.report()['productionTouched'])
    def test_007_no_real_rls(self):self.assertFalse(self.report()['realRLSVerified'])
    def test_008_no_real_auth(self):self.assertFalse(self.report()['realAuthenticationVerified'])
    def test_009_no_external_witness(self):self.assertFalse(self.report()['externalWitnessVerified'])
    def test_010_no_external_signature(self):self.assertFalse(self.report()['externalSignatureVerified'])
    def test_011_strict_json(self):self.assertTrue(self.report()['duplicateJsonKeysRejected'])
    def test_012_nonfinite_flag(self):self.assertTrue(self.report()['nonFiniteNumbersRejected'])
    def test_013_strict_files(self):self.assertTrue(self.report()['strictFileAllowlist'])
    def test_014_proof_count(self):self.assertEqual(len(self.report()['inputDigests']),6)
    def test_015_recomputed(self):self.assertTrue(self.report()['r147VerifiedRecomputed'])
    def test_016_commit(self):self.assertEqual(self.report()['githubCommit'],SHA)
    def test_017_idempotence(self):self.assertEqual(self.report(),self.report())
    def test_018_no_embedded_private(self):
        code=Path(s.__file__).read_text(encoding='utf8')
        for string in ('psycopg','requests.get','subprocess.run','supabase.com'):
            with self.subTest(string=string):self.assertNotIn(string,code)
    def test_019_invalid_commit(self):self.reject(inputs(),'R150_COMMIT','main')
    def test_020_uppercase_commit(self):self.reject(inputs(),'R150_COMMIT',SHA.upper().replace('a','A'))
    def test_021_commit_mismatch(self):self.reject(inputs(),'R150_CHAIN_RECOMPUTE','b'*40)
    def test_022_missing_object(self):
        obj=inputs();obj.pop('probe');self.reject(obj,'R150_FILE_SET')
    def test_023_extra_object(self):
        obj=inputs();obj['other']={};self.reject(obj,'R150_FILE_SET')
    def test_024_non_dict(self):
        obj=inputs();obj['chain']=[];self.reject(obj,'R150_SHAPE')
    def test_025_wrong_manifest(self):
        obj=inputs();obj['chain']['version']='R99';self.reject(obj)
    def test_026_fake_manifest_sha(self):
        obj=inputs();obj['chain']['sha256']='0'*64;self.reject(obj)
    def test_027_manifest_claim_prod(self):
        obj=inputs();obj['chain']['productionAuthorized']=True;self.reject(obj)
    def test_028_claim_real_auth(self):
        obj=inputs();obj['chain']['realAuthenticationVerified']=True;self.reject(obj)
    def test_029_claim_real_rls(self):
        obj=inputs();obj['chain']['realRLSVerified']=True;self.reject(obj)
    def test_030_fake_external_witness(self):
        obj=inputs();obj['chain']['externalWitnessVerified']=True;self.reject(obj)
    def test_031_claim_closed_gate(self):
        obj=inputs();obj['chain']['realWorldGatesOpen']=0;self.reject(obj)
    def test_032_wrong_report_digest_input(self):
        obj=inputs();obj['chain']['inputDigests']['source']='z'*64;self.reject(obj)
    def test_033_source_corrupted(self):
        obj=inputs();obj['source']['release']='GO'
        with self.assertRaises(old.EvidenceGateError):s.validate(obj,SHA)
    def test_034_before_after_mismatch(self):
        obj=inputs();obj['after']['shops']['other_demo']['counts']['bookings']=20
        with self.assertRaises(old.EvidenceGateError):s.validate(obj,SHA)
    def test_035_probe_corrupted(self):
        obj=inputs();obj['probe']['realRLSVerified']=True
        with self.assertRaises(old.EvidenceGateError):s.validate(obj,SHA)
    def test_036_parity_corrupted(self):
        obj=inputs();obj['parity']['fiveTableParity']=False
        with self.assertRaises(old.EvidenceGateError):s.validate(obj,SHA)
    def test_037_lock_missing(self):
        with patch.dict(os.environ,{'CAR02_RELEASE_LOCK':'false'}):
            with self.assertRaises(old.EvidenceGateError):self.report()
    def test_038_r138_missing(self):
        with patch.dict(os.environ,{'R138_DISPOSABLE_QA':'no'}):
            with self.assertRaises(old.EvidenceGateError):self.report()
    def test_039_r139_missing(self):
        with patch.dict(os.environ,{'R139_DISPOSABLE_QA':'no'}):
            with self.assertRaises(old.EvidenceGateError):self.report()
    def test_040_r143_missing(self):
        with patch.dict(os.environ,{'R143_DISPOSABLE_QA':'no'}):
            with self.assertRaises(old.EvidenceGateError):self.report()
    def test_041_valid_json(self):self.assertEqual(s.parse_strict_bytes(b'{"one":1}'),{'one':1})
    def test_042_duplicate_top_key(self):
        with self.assertRaisesRegex(s.BundleGateError,'DUPLICATE_KEY'):
            s.parse_strict_bytes(b'{"release":"GO","release":"NO_GO"}')
    def test_043_duplicate_nested_key(self):
        with self.assertRaisesRegex(s.BundleGateError,'DUPLICATE_KEY'):
            s.parse_strict_bytes(b'{"meta":{"realRLSVerified":true,"realRLSVerified":false}}')
    def test_044_nan(self):
        with self.assertRaisesRegex(s.BundleGateError,'NON_FINITE'):
            s.parse_strict_bytes(b'{"n":NaN}')
    def test_045_inf(self):
        with self.assertRaisesRegex(s.BundleGateError,'NON_FINITE'):
            s.parse_strict_bytes(b'{"n":Infinity}')
    def test_046_neg_inf(self):
        with self.assertRaisesRegex(s.BundleGateError,'NON_FINITE'):
            s.parse_strict_bytes(b'{"n":-Infinity}')
    def test_047_trailing_garbage(self):
        with self.assertRaisesRegex(s.BundleGateError,'INVALID_JSON'):
            s.parse_strict_bytes(b'{"ok":true}{}')
    def test_048_invalid_utf8(self):
        with self.assertRaisesRegex(s.BundleGateError,'INVALID_JSON'):
            s.parse_strict_bytes(b'{"b":"\xff"}')
    def test_049_utf8_bom(self):
        with self.assertRaisesRegex(s.BundleGateError,'BOM'):
            s.parse_strict_bytes(b'\xef\xbb\xbf{}')
    def test_050_empty(self):
        with self.assertRaisesRegex(s.BundleGateError,'EMPTY'):
            s.parse_strict_bytes(b'')
    def test_051_list_denied(self):
        with self.assertRaisesRegex(s.BundleGateError,'OBJECT_REQUIRED'):
            s.parse_strict_bytes(b'[]')
    def test_052_number_denied(self):
        with self.assertRaisesRegex(s.BundleGateError,'OBJECT_REQUIRED'):
            s.parse_strict_bytes(b'42')
    def test_053_oversize(self):
        with self.assertRaisesRegex(s.BundleGateError,'OVERSIZE'):
            s.parse_strict_bytes(b'a'*(s.MAX_PROOF_BYTES+1))
    def test_054_missing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            cwd=os.getcwd()
            try:
                os.chdir(tmp);Path(s.BASE).mkdir()
                with self.assertRaisesRegex(s.BundleGateError,'MISSING_OR_SYMLINK'):
                    s.read_strict(s.INPUT_FILES['source'])
            finally:os.chdir(cwd)
    def test_055_unlisted_file(self):
        with self.assertRaisesRegex(s.BundleGateError,'PATH_OUTSIDE_ALLOWLIST'):
            s.read_strict('secrets.env')
    def test_056_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            cwd=os.getcwd()
            try:
                os.chdir(tmp);Path(s.BASE).mkdir()
                Path('source').write_text('{}')
                Path(s.INPUT_FILES['source']).symlink_to((Path(tmp)/'source').absolute())
                with self.assertRaisesRegex(s.BundleGateError,'MISSING_OR_SYMLINK'):
                    s.read_strict(s.INPUT_FILES['source'])
            finally:os.chdir(cwd)
    def test_057_parent_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            cwd=os.getcwd()
            try:
                os.chdir(tmp);Path('actual').mkdir()
                Path(s.BASE).symlink_to(Path('actual').absolute(),target_is_directory=True)
                with self.assertRaisesRegex(s.BundleGateError,'BASE_DIR'):
                    s.read_strict(s.INPUT_FILES['source'])
            finally:os.chdir(cwd)
    def test_058_roundtrip_actual_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            cwd=os.getcwd()
            try:
                os.chdir(tmp);self.saved_files(tmp)
                self.assertEqual(s.read_strict(s.INPUT_FILES['source']),inputs()['source'])
                report=self.report();report['sha256']=old.digest(report)
                s.write_report(report)
                self.assertEqual(s.read_back(s.OUTPUT_R150),report)
                self.assertEqual(s.OUTPUT_R150.stat().st_mode&0o777,0o600)
            finally:os.chdir(cwd)
    def test_059_no_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            cwd=os.getcwd()
            try:
                os.chdir(tmp);Path(s.BASE).mkdir();s.OUTPUT_R150.write_text('existing')
                with self.assertRaisesRegex(s.BundleGateError,'OUTPUT_EXISTS'):
                    s.write_report(self.report())
                self.assertEqual(s.OUTPUT_R150.read_text(),'existing')
            finally:os.chdir(cwd)
    def test_060_no_output_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            cwd=os.getcwd()
            try:
                os.chdir(tmp);Path(s.BASE).mkdir();Path('target').write_text('safe')
                s.OUTPUT_R150.symlink_to(Path(tmp)/'target')
                with self.assertRaisesRegex(s.BundleGateError,'OUTPUT_EXISTS'):
                    s.write_report(self.report())
                self.assertEqual(Path('target').read_text(),'safe')
            finally:os.chdir(cwd)
    def test_061_wrong_output(self):
        with self.assertRaisesRegex(s.BundleGateError,'OUTPUT_SCOPE'):
            s.write_report(self.report(), Path('private/output.json'))
    def test_062_cli_real_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            cwd=os.getcwd()
            try:
                os.chdir(tmp);self.saved_files(tmp)
                with patch('sys.argv',['r150','--commit',SHA]):s.main()
                got=json.loads(s.OUTPUT_R150.read_text())
                self.assertEqual(got['version'],'R150')
                self.assertEqual(got['sha256'],old.digest({k:v for k,v in got.items() if k!='sha256'}))
            finally:os.chdir(cwd)
    def test_063_cli_duplicate_key_denied_before_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            cwd=os.getcwd()
            try:
                os.chdir(tmp);self.saved_files(tmp)
                Path(s.INPUT_FILES['before']).write_bytes(b'{"release":"GO","release":"NO_GO"}')
                with patch('sys.argv',['r150','--commit',SHA]):
                    with self.assertRaisesRegex(s.BundleGateError,'DUPLICATE_KEY'):s.main()
                self.assertFalse(s.OUTPUT_R150.exists())
            finally:os.chdir(cwd)
    def test_064_cli_chain_corrupt_denied(self):
        with tempfile.TemporaryDirectory() as tmp:
            cwd=os.getcwd()
            try:
                os.chdir(tmp);self.saved_files(tmp)
                broken=inputs()['chain'];broken['githubCommit']='b'*40
                Path(s.FILES['chain']).write_text(json.dumps(broken))
                with patch('sys.argv',['r150','--commit',SHA]):
                    with self.assertRaisesRegex(s.BundleGateError,'CHAIN_RECOMPUTE'):s.main()
                self.assertFalse(s.OUTPUT_R150.exists())
            finally:os.chdir(cwd)

if __name__=='__main__':unittest.main()

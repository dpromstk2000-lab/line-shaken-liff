#!/usr/bin/env python3
"""R157 offline negative cases plus real temp file I/O for R156 artifact manifest.

No real PostgreSQL, secrets, or production network. Earlier R153 GitHub end-to-end
proof remains separate. Exercises R156 file and semantic contracts here.
"""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import car02_r156_artifact_inventory_isolated as r
from car02_r147_evidence_chain_isolated import digest

SHA = 'a'*40
GATE = dict(release='NO_GO',migration='HOLD',realWorldGatesOpen=12,
            syntheticOnly=True,productionTouched=False,productionAuthorized=False,
            externalWitnessVerified=False,realAuthenticationVerified=False,realRLSVerified=False)

def obj_sha(obj):
    obj['sha256']=digest(obj)
    return obj

def evidence():
    chain=obj_sha(dict(GATE, version='R147',githubCommit=SHA))
    strict=obj_sha(dict(GATE, version='R150', githubCommit=SHA,
                        externalSignatureVerified=False,r147Sha256=chain['sha256']))
    receipt=obj_sha(dict(GATE, version='R153', githubCommit=SHA,
                        externalSignatureVerified=False,r147Sha256=chain['sha256'],
                        r150Sha256=strict['sha256'],fixtureDatabaseRemaining=0,
                        fixtureRolesRemaining=0,postgres17ServiceCleanupQuerySucceeded=True,
                        r150RecomputedAfterCleanup=True))
    result={name:b'isolated synthetic test log\n' for name in r.EXPECTED}
    for name in r.REQUIRED_JSON:
        result[name]=b'{}\n'
    for name, value in [('r147-independent-evidence-chain.json',chain),
                        ('r150-strict-bundle.json',strict),
                        ('r153-post-cleanup-receipt.json',receipt)]:
        result[name]=(json.dumps(value,sort_keys=True)+'\n').encode()
    result['cleanup.log']=b'R143_ALL_DISPOSABLE_RESOURCES_DELETED\n'
    result['release-lock.log']=b'R143_R144_RELEASE_NO_GO_DB_MIGRATION_HOLD\n'
    return result

def mutate_obj(records,name,**edits):
    records=copy.deepcopy(records)
    obj=json.loads(records[name])
    obj.update(edits)
    obj_sha(obj)
    records[name]=(json.dumps(obj)+'\n').encode()
    return records


class EvidenceFixture(unittest.TestCase):
    def setUp(self):
        self.records=evidence()
    def fail(self,records=None,sha=SHA):
        with self.assertRaises(AssertionError):r.make_manifest(self.records if records is None else records,sha)
    def test_01_good_baseline(self):self.assertEqual(r.make_manifest(self.records,SHA)['version'],'R156')
    def test_02_file_count(self):self.assertEqual(r.make_manifest(self.records,SHA)['fileCount'],len(r.EXPECTED))
    def test_03_has_only_synthetic(self):self.assertIs(r.make_manifest(self.records,SHA)['syntheticOnly'],True)
    def test_04_hold(self):self.assertEqual(r.make_manifest(self.records,SHA)['migration'],'HOLD')
    def test_05_no_deployment(self):self.assertIs(r.make_manifest(self.records,SHA)['productionAuthorized'],False)
    def test_06_no_external_signature(self):self.assertIs(r.make_manifest(self.records,SHA)['externalSignatureVerified'],False)
    def test_07_no_external_witness(self):self.assertIs(r.make_manifest(self.records,SHA)['externalWitnessVerified'],False)
    def test_08_receipt_reference(self):
        out=r.make_manifest(self.records,SHA)
        self.assertEqual(out['r153Sha256'],json.loads(self.records['r153-post-cleanup-receipt.json'])['sha256'])
    def test_09_manifest_digest(self):
        out=r.make_manifest(self.records,SHA)
        self.assertEqual(out['sha256'],digest({k:v for k,v in out.items() if k!='sha256'}))
    def test_10_binary_bytes_digest(self):
        raw=self.records['schema.log'];out=r.make_manifest(self.records,SHA)
        import hashlib
        self.assertEqual(out['files']['schema.log']['sha256'],hashlib.sha256(raw).hexdigest())
    def test_11_missing_file(self):
        records=copy.deepcopy(self.records);records.pop('schema.log');self.fail(records)
    def test_12_extra_file(self):
        records=copy.deepcopy(self.records);records['.env']=b'SECRET=abc\n';self.fail(records)
    def test_13_bad_commit_length(self):self.fail(sha='a'*39)
    def test_14_bad_commit_case(self):self.fail(sha='A'*40)
    def test_15_bad_commit_type(self):self.fail(sha=None)
    def test_16_wrong_strict_commit(self):self.fail(mutate_obj(self.records,'r150-strict-bundle.json',githubCommit='b'*40))
    def test_17_wrong_receipt_commit(self):self.fail(mutate_obj(self.records,'r153-post-cleanup-receipt.json',githubCommit='b'*40))
    def test_18_wrong_chain_commit(self):self.fail(mutate_obj(self.records,'r147-independent-evidence-chain.json',githubCommit='b'*40))
    def test_19_release_go(self):self.fail(mutate_obj(self.records,'r153-post-cleanup-receipt.json',release='GO'))
    def test_20_migration_unheld(self):self.fail(mutate_obj(self.records,'r153-post-cleanup-receipt.json',migration='READY'))
    def test_21_prod_touched(self):self.fail(mutate_obj(self.records,'r150-strict-bundle.json',productionTouched=True))
    def test_22_prod_auth(self):self.fail(mutate_obj(self.records,'r153-post-cleanup-receipt.json',productionAuthorized=True))
    def test_23_witness_forgery(self):self.fail(mutate_obj(self.records,'r147-independent-evidence-chain.json',externalWitnessVerified=True))
    def test_24_signature_forgery(self):self.fail(mutate_obj(self.records,'r150-strict-bundle.json',externalSignatureVerified=True))
    def test_25_real_auth_claim(self):self.fail(mutate_obj(self.records,'r153-post-cleanup-receipt.json',realAuthenticationVerified=True))
    def test_26_real_rls_claim(self):self.fail(mutate_obj(self.records,'r150-strict-bundle.json',realRLSVerified=True))
    def test_27_gate_count_zero(self):self.fail(mutate_obj(self.records,'r150-strict-bundle.json',realWorldGatesOpen=0))
    def test_28_gate_bool(self):self.fail(mutate_obj(self.records,'r150-strict-bundle.json',realWorldGatesOpen=True))
    def test_29_no_synthetic_flag(self):self.fail(mutate_obj(self.records,'r147-independent-evidence-chain.json',syntheticOnly=False))
    def test_30_database_remaining(self):self.fail(mutate_obj(self.records,'r153-post-cleanup-receipt.json',fixtureDatabaseRemaining=1))
    def test_31_role_remaining(self):self.fail(mutate_obj(self.records,'r153-post-cleanup-receipt.json',fixtureRolesRemaining=2))
    def test_32_cleanup_not_queried(self):self.fail(mutate_obj(self.records,'r153-post-cleanup-receipt.json',postgres17ServiceCleanupQuerySucceeded=False))
    def test_33_r150_not_recomputed(self):self.fail(mutate_obj(self.records,'r153-post-cleanup-receipt.json',r150RecomputedAfterCleanup=False))
    def test_34_wrong_r147_link(self):self.fail(mutate_obj(self.records,'r153-post-cleanup-receipt.json',r147Sha256='f'*64))
    def test_35_wrong_r150_link(self):self.fail(mutate_obj(self.records,'r153-post-cleanup-receipt.json',r150Sha256='f'*64))
    def test_36_broken_chain_digest(self):
        records=copy.deepcopy(self.records);records['r147-independent-evidence-chain.json']=records['r147-independent-evidence-chain.json'].replace(b'R147',b'R146');self.fail(records)
    def test_37_wrong_cleanup_log(self):
        records=copy.deepcopy(self.records);records['cleanup.log']=b'R143_CLEANUP_FAILED\n';self.fail(records)
    def test_38_wrong_hold_log(self):
        records=copy.deepcopy(self.records);records['release-lock.log']=b'GO\n';self.fail(records)
    def test_39_embedded_nul_log(self):
        records=copy.deepcopy(self.records);records['schema.log']+=b'\0';self.fail(records)
    def test_40_malformed_json(self):
        records=copy.deepcopy(self.records);records['r138-source.json']=b'{invalid';self.fail(records)
    def test_41_duplicate_json_keys(self):
        records=copy.deepcopy(self.records);records['r138-source.json']=b'{"x":1,"x":2}';self.fail(records)
    def test_42_nonfinite(self):
        records=copy.deepcopy(self.records);records['r138-source.json']=b'{"x":NaN}';self.fail(records)
    def test_43_receipt_version(self):self.fail(mutate_obj(self.records,'r153-post-cleanup-receipt.json',version='R999'))
    def test_44_r150_version(self):self.fail(mutate_obj(self.records,'r150-strict-bundle.json',version='R155'))
    def test_45_r147_version(self):self.fail(mutate_obj(self.records,'r147-independent-evidence-chain.json',version='R148'))
    def test_46_newer_manifest_not_self_included(self):self.assertNotIn(r.OUTPUT,r.EXPECTED)
    def test_47_equal_records_recompute(self):
        out=r.make_manifest(self.records,SHA)
        self.assertTrue(r.validate_manifest(self.records,SHA,out))
    def test_48_reject_changed_manifest_hash(self):
        out=r.make_manifest(self.records,SHA);out['sha256']='0'*64
        with self.assertRaises(AssertionError):r.validate_manifest(self.records,SHA,out)
    def test_49_reject_changed_artifact(self):
        out=r.make_manifest(self.records,SHA);self.records['schema.log']+=b'MODIFIED\n'
        with self.assertRaises(AssertionError):r.validate_manifest(self.records,SHA,out)
    def test_50_reject_untracked_log(self):
        rec=copy.deepcopy(self.records);rec['unexpected-dump.log']=b'token';self.fail(rec)


class RealDiskIO(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.previous=Path.cwd();os.chdir(self.temp.name)
        self.addCleanup(lambda:os.chdir(self.previous))
        r.BASE.mkdir()
        for name,raw in evidence().items(): (r.BASE/name).write_bytes(raw)
    def test_51_real_folder_inventory(self):self.assertEqual(len(r.read_all(r.BASE)),len(r.EXPECTED))
    def test_52_real_manifest_write_and_roundtrip(self):
        report=r.make_manifest(r.read_all(r.BASE),SHA)
        r.write_manifest(r.BASE,report)
        self.assertEqual(r.read_generated(r.BASE/r.OUTPUT),report)
    def test_53_no_overwrite(self):
        data=r.make_manifest(r.read_all(r.BASE),SHA)
        r.write_manifest(r.BASE,data)
        with self.assertRaises(AssertionError):r.write_manifest(r.BASE,data)
    def test_54_owner_only_mode(self):
        r.write_manifest(r.BASE,r.make_manifest(r.read_all(r.BASE),SHA))
        self.assertEqual((r.BASE/r.OUTPUT).stat().st_mode & 0o777,0o600)
    def test_55_reject_unexpected_file(self):
        (r.BASE/'.env').write_text('FAKE_TOKEN=secret')
        with self.assertRaises(AssertionError):r.read_all(r.BASE)
    def test_56_reject_missing(self):
        (r.BASE/'schema.log').unlink()
        with self.assertRaises(AssertionError):r.read_all(r.BASE)
    def test_57_reject_symlink(self):
        p=r.BASE/'schema.log';p.unlink();p.symlink_to((r.BASE/'cleanup.log').resolve())
        with self.assertRaises(AssertionError):r.read_all(r.BASE)
    def test_58_reject_hardlink(self):
        p=r.BASE/'schema.log';p.unlink();os.link(r.BASE/'cleanup.log',p)
        with self.assertRaises(AssertionError):r.read_all(r.BASE)
    def test_59_reject_empty_file(self):
        (r.BASE/'schema.log').write_bytes(b'')
        with self.assertRaises(AssertionError):r.read_all(r.BASE)
    def test_60_reject_oversize_file(self):
        (r.BASE/'schema.log').write_bytes(b'0'*(r.MAX_FILE+1))
        with self.assertRaises(AssertionError):r.read_all(r.BASE)
    def test_61_reject_directory(self):
        p=r.BASE/'schema.log';p.unlink();p.mkdir()
        with self.assertRaises(AssertionError):r.read_all(r.BASE)
    def test_62_reject_symlink_base(self):
        r.BASE.rename('store');r.BASE.symlink_to(Path('store'),target_is_directory=True)
        with self.assertRaises(AssertionError):r.read_all(r.BASE)
    def test_63_disallow_absolute_base_write(self):
        with self.assertRaises(AssertionError):r.write_manifest(Path(self.temp.name),{})
    def test_64_reject_modified_manifest(self):
        report=r.make_manifest(r.read_all(r.BASE),SHA)
        r.write_manifest(r.BASE,report)
        (r.BASE/'schema.log').write_bytes(b'other')
        with self.assertRaises(AssertionError):r.validate_manifest(r.read_all(r.BASE),SHA,r.read_generated(r.BASE/r.OUTPUT))
    def test_65_reject_existing_manifest_in_inputs(self):
        r.write_manifest(r.BASE,r.make_manifest(r.read_all(r.BASE),SHA))
        with self.assertRaises(AssertionError):r.read_all(r.BASE)
    def test_66_file_always_closed(self):
        p=r.BASE/'schema.log';old=r.read_blob(r.BASE,'schema.log');self.assertEqual(old,p.read_bytes())
        p.unlink();self.assertFalse(p.exists())
    def test_67_no_write_after_existing_symlink(self):
        p=r.BASE/r.OUTPUT;p.symlink_to((r.BASE/'schema.log').resolve())
        with self.assertRaises(AssertionError):r.write_manifest(r.BASE,{})
    def test_69_after_manifest_expects_manifest(self):
        with self.assertRaises(AssertionError):r.read_all(r.BASE,after_manifest=True)
    def test_70_after_manifest_accepts_exact_set(self):
        r.write_manifest(r.BASE,r.make_manifest(r.read_all(r.BASE),SHA))
        self.assertEqual(len(r.read_all(r.BASE,after_manifest=True)),len(r.EXPECTED))
    def test_71_after_manifest_rejects_extras(self):
        r.write_manifest(r.BASE,r.make_manifest(r.read_all(r.BASE),SHA))
        (r.BASE/'payload.env').write_text('not a real secret')
        with self.assertRaises(AssertionError):r.read_all(r.BASE,after_manifest=True)
    def test_72_replay_after_manifest(self):
        r.write_manifest(r.BASE,r.make_manifest(r.read_all(r.BASE),SHA))
        self.assertTrue(r.validate_manifest(r.read_all(r.BASE,after_manifest=True),SHA,r.read_generated(r.BASE/r.OUTPUT)))
    def test_68_reject_changed_log_bytes(self):
        report=r.make_manifest(r.read_all(r.BASE),SHA)
        (r.BASE/'r152-workflow-contract.log').write_bytes(b'unexpected\n')
        with self.assertRaises(AssertionError):r.validate_manifest(r.read_all(r.BASE),SHA,report)

if __name__=='__main__':unittest.main()

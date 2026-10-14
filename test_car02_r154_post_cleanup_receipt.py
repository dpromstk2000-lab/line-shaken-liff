#!/usr/bin/env python3
"""R154 local negative and real-file I/O regression QA, no database/network."""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

import car02_r153_post_cleanup_receipt_isolated as r
from car02_r147_evidence_chain_isolated import digest

COMMIT='a'*40
LOG='R143_ALL_DISPOSABLE_RESOURCES_DELETED\n'
LOCK='R143_R144_RELEASE_NO_GO_DB_MIGRATION_HOLD\n'
PG={'databaseRemaining':0,'fixtureRolesRemaining':0,'directServiceQuery':True}


def data():
    objects={k:{'key':k} for k in ('source','before','after','probe','parity')}
    objects['chain']={'sha256':'b'*64}
    base={'version':'R150','release':'NO_GO','migration':'HOLD'}
    strict=dict(base);strict['sha256']=digest(base)
    return objects, strict, base


def build(objects=None,strict=None,commit=COMMIT,cleanup=LOG,hold=LOCK,pg=None):
    original,verified,reference=data()
    if objects is None:objects=original
    if strict is None:strict=verified
    if pg is None:pg=PG
    with mock.patch.object(r,'validate',return_value=reference):
        return r.construct_receipt(objects,strict,commit,cleanup,hold,pg)


class ReceiptContract(unittest.TestCase):
    def test_01_success(self):self.assertEqual(build()['version'],'R153')
    def test_02_release(self):self.assertEqual(build()['release'],'NO_GO')
    def test_03_migration(self):self.assertEqual(build()['migration'],'HOLD')
    def test_04_twelve_real_gates(self):self.assertEqual(build()['realWorldGatesOpen'],12)
    def test_05_only_synthetic(self):self.assertIs(build()['syntheticOnly'],True)
    def test_06_no_production(self):self.assertIs(build()['productionTouched'],False)
    def test_07_no_authorization(self):self.assertIs(build()['productionAuthorized'],False)
    def test_08_no_real_auth(self):self.assertIs(build()['realAuthenticationVerified'],False)
    def test_09_no_real_rls(self):self.assertIs(build()['realRLSVerified'],False)
    def test_10_no_external_witness(self):self.assertIs(build()['externalWitnessVerified'],False)
    def test_11_no_signature(self):self.assertIs(build()['externalSignatureVerified'],False)
    def test_12_db_zero(self):self.assertEqual(build()['fixtureDatabaseRemaining'],0)
    def test_13_roles_zero(self):self.assertEqual(build()['fixtureRolesRemaining'],0)
    def test_14_commit(self):self.assertEqual(build()['githubCommit'],COMMIT)
    def test_15_receipt_digest(self):
        x=build();self.assertEqual(x['sha256'],digest({k:v for k,v in x.items() if k!='sha256'}))
    def test_16_all_six_evidence_digests(self):self.assertEqual(len(build()['sourceEvidenceDigests']),6)
    def test_17_r150_hash(self):self.assertEqual(build()['r150Sha256'],data()[1]['sha256'])
    def test_18_r147_hash(self):self.assertEqual(build()['r147Sha256'],'b'*64)
    def test_19_revalidated(self):self.assertIs(build()['r150RecomputedAfterCleanup'],True)
    def test_20_direct_query(self):self.assertIs(build()['postgres17ServiceCleanupQuerySucceeded'],True)
    def test_21_wrong_commit(self):
        with self.assertRaises(AssertionError):build(commit='a'*39)
    def test_22_bad_commit_hex(self):
        with self.assertRaises(AssertionError):build(commit='z'*40)
    def test_23_commit_not_string(self):
        with self.assertRaises(AssertionError):build(commit=5)
    def test_24_wrong_r150_version(self):
        x=data()[1];x['version']='R149'
        with self.assertRaises(AssertionError):build(strict=x)
    def test_25_wrong_r150_hash(self):
        x=data()[1];x['sha256']='a'*64
        with self.assertRaises(AssertionError):build(strict=x)
    def test_26_r150_report_mutation(self):
        x=data()[1];x['release']='GO';x['sha256']=digest({k:v for k,v in x.items() if k!='sha256'})
        with self.assertRaises(AssertionError):build(strict=x)
    def test_27_r150_wrong_shape(self):
        with self.assertRaises(AssertionError):build(strict=[])
    def test_28_cleanup_line_missing(self):
        with self.assertRaises(AssertionError):build(cleanup='')
    def test_29_cleanup_forged_claim(self):
        with self.assertRaises(AssertionError):build(cleanup='R143_ALL_DISPOSABLE_RESOURCES_DELETED')
    def test_30_cleanup_extra_lines(self):
        with self.assertRaises(AssertionError):build(cleanup=LOG+'override\n')
    def test_31_hold_missing(self):
        with self.assertRaises(AssertionError):build(hold='')
    def test_32_hold_changed(self):
        with self.assertRaises(AssertionError):build(hold=LOCK.replace('NO_GO','GO'))
    def test_33_pg_database_still_exists(self):
        with self.assertRaises(AssertionError):build(pg={**PG,'databaseRemaining':1})
    def test_34_pg_role_still_exists(self):
        with self.assertRaises(AssertionError):build(pg={**PG,'fixtureRolesRemaining':1})
    def test_35_pg_query_not_performed(self):
        with self.assertRaises(AssertionError):build(pg={**PG,'directServiceQuery':False})
    def test_36_pg_extra_claim(self):
        with self.assertRaises(AssertionError):build(pg={**PG,'external':True})
    def test_37_untrusted_input_digest(self):
        objects=data()[0];x=build(objects=objects)
        self.assertEqual(x['sourceEvidenceDigests']['source'],digest(objects['source']))
    def test_38_actual_commit_not_derived_from_proof(self):
        self.assertEqual(build()['githubCommit'],COMMIT)


class PgQuerySafety(unittest.TestCase):
    def test_39_clean_status(self):self.assertTrue(r.check_pg_output('0|0\n'))
    def test_40_database_remains(self):
        with self.assertRaises(AssertionError):r.check_pg_output('1|0\n')
    def test_41_roles_remain(self):
        with self.assertRaises(AssertionError):r.check_pg_output('0|1\n')
    def test_42_no_response(self):
        with self.assertRaises(AssertionError):r.check_pg_output('')
    def test_43_whitespace_injection(self):
        with self.assertRaises(AssertionError):r.check_pg_output('0|0 \n')
    def test_44_extra_lines(self):
        with self.assertRaises(AssertionError):r.check_pg_output('0|0\n0|0\n')
    def test_45_nonstring(self):
        with self.assertRaises(AssertionError):r.check_pg_output(None)
    def test_46_bad_container_id(self):
        with self.assertRaises(AssertionError):r.query_disposable_pg('$(evil)')
    def test_47_short_container_id(self):
        with self.assertRaises(AssertionError):r.query_disposable_pg('abc')
    def test_48_valid_cid_and_argv(self):
        with mock.patch.object(r.subprocess,'run') as f:
            f.return_value.stdout='0|0\n';value=r.query_disposable_pg('f'*64)
        self.assertEqual(value,PG)
        args=f.call_args.args[0]
        self.assertEqual(args[:4],['docker','exec','-i','f'*64])
        self.assertEqual(args[-2],'-Atqc')
        self.assertIn('car02_r138_qa_ci',args[-1])
        self.assertEqual(f.call_args.kwargs['timeout'],20)
        self.assertIs(f.call_args.kwargs['check'],True)
    def test_49_database_error(self):
        with mock.patch.object(r.subprocess,'run',side_effect=subprocess.CalledProcessError(1,['docker'])):
            with self.assertRaises(AssertionError):r.query_disposable_pg('f'*64)
    def test_50_db_timeout(self):
        with mock.patch.object(r.subprocess,'run',side_effect=subprocess.TimeoutExpired(['docker'],20)):
            with self.assertRaises(AssertionError):r.query_disposable_pg('f'*64)


class FileBoundary(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.previous=Path.cwd();os.chdir(self.temp.name)
        self.addCleanup(lambda:os.chdir(self.previous))
        r.BASE.mkdir(parents=True,exist_ok=True)
    def mk(self,data=b'{}\n',name=None):
        path=r.OUTPUT_R150 if name is None else r.BASE/name
        path.write_bytes(data);return path
    def test_51_valid_file(self):
        self.mk();self.assertEqual(r.read_fixed(r.OUTPUT_R150,(r.OUTPUT_R150,)),{})
    def test_52_actual_write_and_read(self):
        payload=build();r.write_receipt(payload)
        self.assertEqual(r.read_fixed(r.OUTPUT_R153,(r.OUTPUT_R153,)),payload)
    def test_53_refuse_overwrite(self):
        payload=build();r.write_receipt(payload)
        with self.assertRaises(AssertionError):r.write_receipt(payload)
    def test_54_private_mode(self):
        r.write_receipt(build());self.assertEqual(r.OUTPUT_R153.stat().st_mode & 0o777,0o600)
    def test_55_symlink_file_refused(self):
        source=self.mk();r.OUTPUT_R153.symlink_to(source.resolve())
        with self.assertRaises(AssertionError):r.read_fixed(r.OUTPUT_R153,(r.OUTPUT_R153,))
    def test_56_symlink_dir_refused(self):
        p=self.mk();store=r.BASE.parent/'saved';r.BASE.rename(store);r.BASE.symlink_to(store, target_is_directory=True)
        with self.assertRaises(AssertionError):r.read_fixed(p,(p,))
    def test_57_outside_scope(self):
        p=Path('out.json');p.write_text('{}')
        with self.assertRaises(AssertionError):r.read_fixed(p,(p,))
    def test_58_must_be_allowlisted(self):
        p=self.mk()
        with self.assertRaises(AssertionError):r.read_fixed(p,(r.OUTPUT_R153,))
    def test_59_duplicate_json_keys(self):
        self.mk(b'{"a":1,"a":2}')
        with self.assertRaises(AssertionError):r.read_fixed(r.OUTPUT_R150,(r.OUTPUT_R150,))
    def test_60_reject_nan(self):
        self.mk(b'{"a":NaN}')
        with self.assertRaises(AssertionError):r.read_fixed(r.OUTPUT_R150,(r.OUTPUT_R150,))
    def test_61_refuse_bom(self):
        self.mk(b'\xef\xbb\xbf{}')
        with self.assertRaises(AssertionError):r.read_fixed(r.OUTPUT_R150,(r.OUTPUT_R150,))
    def test_62_oversize(self):
        self.mk(b'X'*(r.MAX_PROOF_BYTES+1))
        with self.assertRaises(AssertionError):r.read_fixed(r.OUTPUT_R150,(r.OUTPUT_R150,))
    def test_63_empty(self):
        self.mk(b'')
        with self.assertRaises(AssertionError):r.read_fixed(r.OUTPUT_R150,(r.OUTPUT_R150,))
    def test_64_invalid_utf8(self):
        self.mk(b'\xff')
        with self.assertRaises(AssertionError):r.read_fixed(r.OUTPUT_R150,(r.OUTPUT_R150,))
    def test_65_no_existing_file(self):
        with self.assertRaises(AssertionError):r.read_fixed(r.OUTPUT_R150,(r.OUTPUT_R150,))
    def test_66_real_log(self):
        p=self.mk(LOG.encode(),name='cleanup.log')
        self.assertEqual(r.read_fixed(p,(p,),json_document=False),LOG)
    def test_67_extra_log(self):
        p=self.mk((LOG+'error\n').encode(),name='cleanup.log')
        with self.assertRaises(AssertionError):r.check_logs(r.read_fixed(p,(p,),json_document=False),LOCK)
    def test_68_unsafe_output_dir(self):
        r.BASE.rmdir();r.BASE.symlink_to(self.previous,target_is_directory=True)
        with self.assertRaises(AssertionError):r.write_receipt(build())

if __name__=='__main__':unittest.main()

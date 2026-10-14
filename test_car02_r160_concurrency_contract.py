#!/usr/bin/env python3
"""R160 offline refusal tests for R159 real PG17 concurrent probe; no Docker required."""
import copy
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
import car02_r159_concurrent_booking_isolated as r

COMMIT='a'*40

def proof():
    d={'version':'R159','githubCommit':COMMIT,'mode':'DISPOSABLE_PG17_REAL_CONCURRENCY_SYNTHETIC_ONLY',
       'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,'syntheticOnly':True,
       'productionTouched':False,'productionAuthorized':False,'realAuthenticationVerified':False,
       'realRLSVerified':False,'externalWitnessVerified':False,'externalSignatureVerified':False,
       'independentProductionTest':False,'checks':{
       k:True for k in ('sameKey','sameSlot','crossTenant','competingMove','sameCancel','caseVsCancel','deniedWritesNoMutation')},
       'sameKeyResults':['CREATED']+['IDEMPOTENT']*7, 'sameSlotResults':['CREATED','SLOT_TAKEN'],
       'moveResults':['MOVED','REJECTED'],'cancelResults':['CANCELLED']+['IDEMPOTENT']*7,
       'caseCancelResults':['OPENED','REJECTED'],'fixtureRoles':5,'originalSqlUnchanged':True,'syntheticDb':'car02_r138_qa_ci'}
    d['sha256']=hashlib.sha256(json.dumps(d,sort_keys=True,ensure_ascii=True,separators=(',',':')).encode()).hexdigest()
    return d

def reseal(d):
    d['sha256']=hashlib.sha256(json.dumps({k:v for k,v in d.items() if k!='sha256'},sort_keys=True,ensure_ascii=True,separators=(',',':')).encode()).hexdigest()
    return d

class R160Offline(unittest.TestCase):
    def reject(self,data):
        with self.assertRaises(r.ProbeError):r.verify_release(data)
    def test_001_clean_report(self):self.assertTrue(r.verify_release(proof()))
    def test_002_commit_short(self):d=proof();d['githubCommit']='a';self.reject(reseal(d))
    def test_003_commit_uppercase(self):d=proof();d['githubCommit']='A'*40;self.reject(reseal(d))
    def test_004_commit_nonhex(self):d=proof();d['githubCommit']='g'*40;self.reject(reseal(d))
    def test_005_version_wrong(self):d=proof();d['version']='R160';self.reject(reseal(d))
    def test_006_no_go_to_go(self):d=proof();d['release']='GO';self.reject(reseal(d))
    def test_007_db_hold_broken(self):d=proof();d['migration']='READY';self.reject(reseal(d))
    def test_008_gate_count_wrong(self):d=proof();d['realWorldGatesOpen']=11;self.reject(reseal(d))
    def test_009_gate_count_string(self):d=proof();d['realWorldGatesOpen']='12';self.reject(reseal(d))
    def test_010_gate_count_bool(self):d=proof();d['realWorldGatesOpen']=True;self.reject(reseal(d))
    def test_011_prod_touch(self):d=proof();d['productionTouched']=True;self.reject(reseal(d))
    def test_012_prod_authorize(self):d=proof();d['productionAuthorized']=True;self.reject(reseal(d))
    def test_013_real_auth(self):d=proof();d['realAuthenticationVerified']=True;self.reject(reseal(d))
    def test_014_real_rls(self):d=proof();d['realRLSVerified']=True;self.reject(reseal(d))
    def test_015_real_witness(self):d=proof();d['externalWitnessVerified']=True;self.reject(reseal(d))
    def test_016_external_signature(self):d=proof();d['externalSignatureVerified']=True;self.reject(reseal(d))
    def test_017_real_db_claim(self):d=proof();d['independentProductionTest']=True;self.reject(reseal(d))
    def test_018_not_synthetic(self):d=proof();d['syntheticOnly']=False;self.reject(reseal(d))
    def test_019_wrong_mode(self):d=proof();d['mode']='LIVE';self.reject(reseal(d))
    def test_020_check_false(self):d=proof();d['checks']['sameKey']=False;self.reject(reseal(d))
    def test_021_check_extra(self):d=proof();d['checks']['fabricated']=True;self.reject(reseal(d))
    def test_022_check_missing(self):d=proof();del d['checks']['caseVsCancel'];self.reject(reseal(d))
    def test_023_check_numeric(self):d=proof();d['checks']['sameSlot']=1;self.reject(reseal(d))
    def test_024_sha_replaced(self):d=proof();d['sha256']='0'*64;self.reject(d)
    def test_025_sha_missing(self):d=proof();del d['sha256'];self.reject(d)
    def test_026_same_key_ok(self):self.assertEqual(r.expect_results(['CREATED']+['IDEMPOTENT']*7,{'CREATED':1,'IDEMPOTENT':7})['CREATED'],1)
    def test_027_same_key_duplicate(self):
        with self.assertRaises(r.ProbeError):r.expect_results(['CREATED']*2+['IDEMPOTENT']*6,{'CREATED':1,'IDEMPOTENT':7})
    def test_028_same_slot_ok(self):r.expect_results(['CREATED','SLOT_TAKEN'],{'CREATED':1,'SLOT_TAKEN':1})
    def test_029_same_slot_overbook(self):
        with self.assertRaises(r.ProbeError):r.expect_results(['CREATED','CREATED'],{'CREATED':1,'SLOT_TAKEN':1})
    def test_030_cancel_ok(self):r.expect_results(['CANCELLED']+['IDEMPOTENT']*7,{'CANCELLED':1,'IDEMPOTENT':7})
    def test_031_cancel_twice(self):
        with self.assertRaises(r.ProbeError):r.expect_results(['CANCELLED']*2+['IDEMPOTENT']*6,{'CANCELLED':1,'IDEMPOTENT':7})
    def test_032_move_ok(self):r.expect_results(['MOVED','REJECTED'],{'MOVED':1,'REJECTED':1})
    def test_033_move_double_win(self):
        with self.assertRaises(r.ProbeError):r.expect_results(['MOVED','MOVED'],{'MOVED':1,'REJECTED':1})
    def test_034_unknown_result(self):
        with self.assertRaises(r.ProbeError):r.expect_results(['HACK','MOVED'],{'MOVED':1,'REJECTED':1})
    def test_035_case_wins(self):r.check_case_cancel_outcome(['OPENED','REJECTED'])
    def test_036_cancel_wins(self):r.check_case_cancel_outcome(['CANCELLED','REJECTED'])
    def test_037_case_both_win(self):
        with self.assertRaises(r.ProbeError):r.check_case_cancel_outcome(['OPENED','CANCELLED'])
    def test_038_case_neither_win(self):
        with self.assertRaises(r.ProbeError):r.check_case_cancel_outcome(['REJECTED','REJECTED'])
    def test_039_missing_case_outcome(self):
        with self.assertRaises(r.ProbeError):r.check_case_cancel_outcome(['OPENED'])
    def test_040_sql_reject_wrong_cid(self):
        with self.assertRaises(r.ProbeError):r.concurrent_sql('prod','as','SELECT car02_r138_qa.abc();','X','OK')
    def test_041_sql_reject_unknown_role(self):
        with self.assertRaises(r.ProbeError):r.concurrent_sql('a'*12,'admin','SELECT car02_r138_qa.abc();','X','OK')
    def test_042_sql_reject_update(self):
        with self.assertRaises(r.ProbeError):r.concurrent_sql('a'*12,'as','UPDATE public.users SET x=1;','X','OK')
    def test_043_wrong_success_payload(self):
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=0,stdout='BOGUS\n',stderr='')):
            with self.assertRaises(r.ProbeError):r.concurrent_sql('a'*12,'as','SELECT car02_r138_qa.foo();','ERROR','MOVED')
    def test_044_correct_success_payload(self):
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=0,stdout='MOVED\n',stderr='')):
            self.assertEqual(r.concurrent_sql('a'*12,'as','SELECT car02_r138_qa.foo();','ERROR','MOVED'),'MOVED')
    def test_045_wrong_error_fails_closed(self):
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=1,stdout='',stderr='division by zero')):
            with self.assertRaises(r.ProbeError):r.concurrent_sql('a'*12,'as','SELECT car02_r138_qa.foo();','R138_STALE_BOOKING','MOVED')
    def test_046_correct_error_is_rejected(self):
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=1,stdout='',stderr='ERROR: R138_STALE_BOOKING')):
            self.assertEqual(r.concurrent_sql('a'*12,'as','SELECT car02_r138_qa.foo();','R138_STALE_BOOKING','MOVED'),'REJECTED')
    def test_047_path_disallow_output(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true','R159_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.ProbeError):r.probe('a'*12,COMMIT,'/tmp/exfiltrate.json')
    def test_048_guard_env_no_db(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R159_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.ProbeError):r.probe('a'*12,COMMIT,'qa-evidence-r159/r159-concurrency-proof.json')
    def test_049_day_future_not_sunday(self):
        dtv=__import__('datetime').date.fromisoformat(r.day_for_test())
        self.assertLessEqual((dtv-__import__('datetime').date.today()).days,12)
        self.assertNotEqual(dtv.isoweekday(),7)
    def test_050_unexpected_list_type(self):
        with self.assertRaises(r.ProbeError):r.expect_results('CREATED',{'CREATED':1})
    def test_051_fabricated_duplicate_same_key(self):
        d=proof();d['sameKeyResults']=['CREATED']*2+['IDEMPOTENT']*6;self.reject(reseal(d))
    def test_052_fake_slot_double_winner(self):
        d=proof();d['sameSlotResults']=['CREATED']*2;self.reject(reseal(d))
    def test_053_fake_race_both_winners(self):
        d=proof();d['caseCancelResults']=['OPENED','CANCELLED'];self.reject(reseal(d))
    def test_054_fabricated_real_database(self):
        d=proof();d['syntheticDb']='real_db';self.reject(reseal(d))
    def test_055_fabricated_unchanged_source(self):
        d=proof();d['originalSqlUnchanged']=False;self.reject(reseal(d))

if __name__=='__main__':unittest.main()

#!/usr/bin/env python3
"""R195: no-database negative QA, SQL statement guards, and real JSON roundtrip."""
from __future__ import annotations
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
import car02_r194_savepoint_atomicity_isolated as r

COMMIT='e'*40

def sample():
    snap={t:format(1200+i,'032x') for i,t in enumerate(r.TABLES)}
    ops={key:{'before':snap.copy(),'after':snap.copy(),'result':value}
         for key,value in zip(r.OPS,r.EXPECTED)}
    partial={
      'moveThenCancel':{'committed':'MOVED','undone':'CANCELLED','unchangedAuditCount':0,
                        'preservedVersion':2,'preservedState':'ACTIVE'},
      'reportThenQuote':{'committed':'REPORT_SAVED','undone':'QUOTE_PRESENTED',
                         'unchangedAuditCount':0,'preservedVersion':2,'preservedState':'REPORTED'}}
    d=dict(r.LOCK,githubCommit=COMMIT,savepointOperations=ops,
           partialRollbacks=partial,finalSnapshot=snap.copy())
    d['sha256']=r.seal(d)
    return d

class R195Negative(unittest.TestCase):
    def rejects(self,d,reseal=True):
        if reseal:d['sha256']=r.seal(d)
        with self.assertRaises(r.SavepointError):r.verify_report(d)
    def test_001_valid(self):self.assertTrue(r.verify_report(sample()))
    def test_002_eight(self):self.assertEqual(len(r.OPS),8)
    def test_003_unique(self):self.assertEqual(len(set(r.OPS)),8)
    def test_004_missing_op(self):
        d=sample();del d['savepointOperations']['quote'];self.rejects(d)
    def test_005_extra_op(self):
        d=sample();d['savepointOperations']['fabricated']={};self.rejects(d)
    def test_006_bool_operation(self):
        d=sample();d['savepointOperations']['quote']=True;self.rejects(d)
    def test_007_before_changed(self):
        d=sample();d['savepointOperations']['move']['before']['bookings']='f'*32;self.rejects(d)
    def test_008_after_changed(self):
        d=sample();d['savepointOperations']['cancel']['after']['audit_events']='f'*32;self.rejects(d)
    def test_009_bad_result(self):
        d=sample();d['savepointOperations']['case']['result']='IDEMPOTENT';self.rejects(d)
    def test_010_bad_op_field(self):
        d=sample();d['savepointOperations']['report']['madeUp']=True;self.rejects(d)
    def test_011_missing_snap_table(self):
        d=sample();del d['savepointOperations']['complete']['before']['bookings'];self.rejects(d)
    def test_012_fake_table(self):
        d=sample();d['finalSnapshot']['customer_secret']='0'*32;self.rejects(d)
    def test_013_invalid_sha(self):
        d=sample();d['sha256']='0'*64;self.rejects(d,False)
    def test_014_missing_sha(self):
        d=sample();del d['sha256'];self.rejects(d,False)
    def test_015_wrong_commit(self):
        d=sample();d['githubCommit']='!'*40;self.rejects(d)
    def test_016_upper_commit(self):
        d=sample();d['githubCommit']='A'*40;self.rejects(d)
    def test_017_extra_global(self):
        d=sample();d['productionReleaseApproved']=True;self.rejects(d)
    def test_018_partial_missing(self):
        d=sample();del d['partialRollbacks']['reportThenQuote'];self.rejects(d)
    def test_019_partial_extra(self):
        d=sample();d['partialRollbacks']['other']={};self.rejects(d)
    def test_020_undo_kept(self):
        d=sample();d['partialRollbacks']['moveThenCancel']['unchangedAuditCount']=1;self.rejects(d)
    def test_021_wrong_version(self):
        d=sample();d['partialRollbacks']['reportThenQuote']['preservedVersion']=3;self.rejects(d)
    def test_022_wrong_state(self):
        d=sample();d['partialRollbacks']['moveThenCancel']['preservedState']='CANCELLED';self.rejects(d)
    def test_023_bool_version(self):
        d=sample();d['partialRollbacks']['moveThenCancel']['preservedVersion']=True;self.rejects(d)
    def test_024_missing_partial_field(self):
        d=sample();del d['partialRollbacks']['moveThenCancel']['undone'];self.rejects(d)
    def test_025_wrong_partial_result(self):
        d=sample();d['partialRollbacks']['reportThenQuote']['undone']='IDEMPOTENT';self.rejects(d)
    def test_026_sql_guard_good(self):
        self.assertEqual(r.guard_sql('SELECT car02_r138_qa.open_case(\'abc\',1);'),"SELECT car02_r138_qa.open_case('abc',1);")
    def test_027_sql_guard_delete(self):
        with self.assertRaises(r.SavepointError):r.guard_sql('DELETE FROM public.users;')
    def test_028_sql_guard_injection(self):
        with self.assertRaises(r.SavepointError):r.guard_sql('SELECT car02_r138_qa.open_case(1,1); DROP TABLE public.x;')
    def test_029_sql_guard_unknown_function(self):
        with self.assertRaises(r.SavepointError):r.guard_sql('SELECT car02_r138_qa.danger(1);')
    def test_030_sql_guard_missing_semicolon(self):
        with self.assertRaises(r.SavepointError):r.guard_sql('SELECT car02_r138_qa.open_case(1,1)')
    def test_031_sql_guard_wrong_type(self):
        with self.assertRaises(r.SavepointError):r.guard_sql(None)
    def test_032_probe_bad_cid(self):
        with self.assertRaises(r.SavepointError):r.probe('production',COMMIT)
    def test_033_probe_bad_commit(self):
        with self.assertRaises(r.SavepointError):r.probe('a'*12,'nope')
    def test_034_probe_bad_output(self):
        with self.assertRaises(r.SavepointError):r.probe('a'*12,COMMIT,'/tmp/unsafe')
    def test_035_probe_bad_env(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R194_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.SavepointError):r.probe('a'*12,COMMIT)
    def test_036_tx_success(self):
        with patch.object(r,'psql',return_value='BEGIN\nSAVEPOINT\nCREATED\nROLLBACK\nCOMMIT') as p:
            self.assertEqual(r.transaction_sql('a'*12,'as','SELECT car02_r138_qa.claim_booking(1,2,3,4);','CREATED'),'CREATED')
            self.assertIn('ROLLBACK TO SAVEPOINT',p.call_args.args[3])
    def test_037_tx_missing_rollback(self):
        with patch.object(r,'psql',return_value='BEGIN\nSAVEPOINT\nCREATED\nCOMMIT'):
            with self.assertRaises(r.SavepointError):r.transaction_sql('a'*12,'as','SELECT car02_r138_qa.claim_booking(1,2,3,4);','CREATED')
    def test_038_tx_false_rollback(self):
        with patch.object(r,'psql',return_value='BEGIN\nSAVEPOINT\nCREATED\nROLLBACK\nROLLBACK'):
            with self.assertRaises(r.SavepointError):r.transaction_sql('a'*12,'as','SELECT car02_r138_qa.claim_booking(1,2,3,4);','CREATED')
    def test_039_tx_actor(self):
        with self.assertRaises(r.SavepointError):r.transaction_sql('a'*12,'postgres','SELECT car02_r138_qa.open_case(1,2);','OPENED')
    def test_040_tx_expected(self):
        with self.assertRaises(r.SavepointError):r.transaction_sql('a'*12,'as','SELECT car02_r138_qa.open_case(1,2);','GO')
    def test_041_partial_success(self):
        with patch.object(r,'psql',return_value='BEGIN\nMOVED\nSAVEPOINT\nCANCELLED\nROLLBACK\nCOMMIT'):
            self.assertTrue(r.partial_transaction('a'*12,'a1','SELECT car02_r138_qa.change_booking(1);','MOVED',
                                                   'SELECT car02_r138_qa.change_booking(2);','CANCELLED'))
    def test_042_partial_second_committed(self):
        with patch.object(r,'psql',return_value='BEGIN\nMOVED\nSAVEPOINT\nCANCELLED\nRELEASE\nCOMMIT'):
            with self.assertRaises(r.SavepointError):r.partial_transaction('a'*12,'a1',
                'SELECT car02_r138_qa.change_booking(1);','MOVED','SELECT car02_r138_qa.change_booking(2);','CANCELLED')
    def test_043_partial_bad_cid(self):
        with self.assertRaises(r.SavepointError):r.partial_transaction('live','a1',
                'SELECT car02_r138_qa.change_booking(1);','MOVED','SELECT car02_r138_qa.change_booking(2);','CANCELLED')
    def test_044_real_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'proof.json';r.safe_write(sample(),p)
            self.assertTrue(r.verify_report(json.loads(p.read_text(encoding='ascii'))))
    def test_045_reject_overwrite(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'proof.json';r.safe_write(sample(),p)
            with self.assertRaises(r.SavepointError):r.safe_write(sample(),p)
    def test_046_reject_symlink(self):
        with tempfile.TemporaryDirectory() as td:
            real=Path(td)/'real';real.write_text('preserved')
            link=Path(td)/'symlink';link.symlink_to(real)
            with self.assertRaises(r.SavepointError):r.safe_write(sample(),link)
            self.assertEqual(real.read_text(),'preserved')
    def test_047_missing_parent(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.SavepointError):r.safe_write(sample(),Path(td)/'missing'/'a.json')

def make_bad_lock(name,value):
    def f(self):
        d=sample();d[name]=value;self.rejects(d)
    return f
BAD={
    'version':'R195','mode':'PRODUCTION','release':'GO','migration':'READY',
    'realWorldGatesOpen':0,'syntheticOnly':False,'productionTouched':True,
    'productionAuthorized':True,'realAuthenticationVerified':True,'realRLSVerified':True,
    'externalWitnessVerified':True,'externalSignatureVerified':True,
    'independentProductionTest':True,'fixtureDb':'live','fixtureRoles':4,
    'allFiveTablesCovered':False,'priorR191SourceUnchanged':False,
    'originalR138BUnchanged':False,'savepointEightOperationsVerified':False,
    'partialCommittedPredecessorVerified':False,'partialRolledBackAuditAbsent':False,
    'productionReady':True,
}
for k,v in BAD.items():setattr(R195Negative,'test_lock_'+k,make_bad_lock(k,v))

def make_mutated_result(op):
    def f(self):
        d=sample();d['savepointOperations'][op]['result']='IDEMPOTENT';self.rejects(d)
    return f
for op in r.OPS:setattr(R195Negative,'test_wrong_result_'+op,make_mutated_result(op))

if __name__=='__main__':unittest.main()

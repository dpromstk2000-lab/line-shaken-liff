#!/usr/bin/env python3
"""R204 offline forged-evidence, deadlock arbitration, and actual file I/O checks."""
from __future__ import annotations
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock,patch
import car02_r203_deadlock_recovery_isolated as r

COMMIT='f'*40

def snap(n):
    return {name:format(n*100+i,'032x') for i,name in enumerate(r.TABLES)}

def sample(winner='a'):
    doc=dict(r.LOCK,githubCommit=COMMIT,winner=winner,loser='b' if winner=='a' else 'a',
             initial=snap(1),afterDeadlock=snap(2),afterStale=snap(2),finalSnapshot=snap(3),
             winnerOperationRows=2,loserOperationRows=0,winnerAuditRows=2,loserAuditRows=0,
             staleErrors=['R138_STALE_BOOKING']*2,freshRetryResults=['MOVED']*2,
             finalVersions=[3,3])
    doc['sha256']=r.seal(doc)
    return doc

class R204Tests(unittest.TestCase):
    def reject(self,doc,reseal=True):
        if reseal and 'sha256' in doc:doc['sha256']=r.seal(doc)
        with self.assertRaises(r.DeadlockQAError):r.validate_report(doc)
    def test_valid_a(self):self.assertTrue(r.validate_report(sample('a')))
    def test_valid_b(self):self.assertTrue(r.validate_report(sample('b')))
    def test_schema_order_independent(self):
        d=sample();d=dict(reversed(list(d.items())));self.assertTrue(r.validate_report(d))
    def test_missing_hash(self):
        d=sample();d.pop('sha256');self.reject(d,False)
    def test_wrong_hash(self):
        d=sample();d['sha256']='0'*64;self.reject(d,False)
    def test_extra_go(self):
        d=sample();d['releaseAllowed']=True;self.reject(d)
    def test_bad_commit(self):
        d=sample();d['githubCommit']='not-a-real-commit';self.reject(d)
    def test_same_winner_and_loser(self):
        d=sample();d['loser']='a';self.reject(d)
    def test_invalid_winner(self):
        d=sample();d['winner']='postgres';self.reject(d)
    def test_wrong_snap(self):
        d=sample();d['afterStale']=snap(4);self.reject(d)
    def test_missing_snap_table(self):
        d=sample();d['finalSnapshot'].pop('bookings');self.reject(d)
    def test_wrong_snap_type(self):
        d=sample();d['finalSnapshot']['bookings']=42;self.reject(d)
    def test_no_deadlock_write(self):
        d=sample();d['afterDeadlock']=copy.deepcopy(d['initial']);d['afterStale']=copy.deepcopy(d['initial']);self.reject(d)
    def test_no_fresh_retry(self):
        d=sample();d['finalSnapshot']=copy.deepcopy(d['afterStale']);self.reject(d)
    def test_boolean_counts(self):
        d=sample();d['winnerAuditRows']=True;self.reject(d)
    def test_negative_count(self):
        d=sample();d['loserOperationRows']=-1;self.reject(d)
    def test_stale_error_wrong(self):
        d=sample();d['staleErrors'][1]='R138_STALE_VERSION';self.reject(d)
    def test_fresh_result_wrong(self):
        d=sample();d['freshRetryResults'][0]='IDEMPOTENT';self.reject(d)
    def test_version_wrong(self):
        d=sample();d['finalVersions'][0]=2;self.reject(d)
    def test_real_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            dest=Path(td)/'proof.json';r.save(sample(),dest)
            self.assertEqual(json.loads(dest.read_text(encoding='ascii')),sample())
    def test_no_overwrite(self):
        with tempfile.TemporaryDirectory() as td:
            dest=Path(td)/'proof.json';r.save(sample(),dest)
            with self.assertRaises(r.DeadlockQAError):r.save(sample(),dest)
    def test_no_missing_parent(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.DeadlockQAError):r.save(sample(),Path(td)/'absent'/'a.json')
    def test_no_symlink(self):
        with tempfile.TemporaryDirectory() as td:
            dest=Path(td);original=dest/'actual.json';original.write_text('untouched')
            link=dest/'link.json';link.symlink_to(original)
            with self.assertRaises(r.DeadlockQAError):r.save(sample(),link)
            self.assertEqual(original.read_text(),'untouched')
    def test_probe_bad_cid_first(self):
        with self.assertRaises(r.DeadlockQAError):r.probe('production',COMMIT)
    def test_probe_bad_env_first(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R203_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.DeadlockQAError):r.probe('a'*12,COMMIT)
    def test_probe_bad_out_first(self):
        with self.assertRaises(r.DeadlockQAError):r.probe('a'*12,COMMIT,'/tmp/production.json')
    def test_client_wrong_sql(self):
        with self.assertRaises(r.DeadlockQAError):r.client('a'*12,'DROP TABLE users;','SELECT car02_r138_qa.change_booking(1);')
    def test_wrong_count_wait(self):
        with self.assertRaises(r.DeadlockQAError):r.wait_for('a'*12,1,Mock())
    def test_wrong_admin_query(self):
        with self.assertRaises(r.DeadlockQAError):r.admin('a'*12,'DELETE FROM public.users')
    def test_client_query_sequence_and_role(self):
        with patch.object(r.subprocess,'Popen',return_value=Mock()) as pop:
            first='SELECT car02_r138_qa.change_booking(1);'
            second='SELECT car02_r138_qa.change_booking(2);'
            r.client('a'*12,first,second)
            cmd=pop.call_args.args[0]
            sql=cmd[cmd.index('-c')+1]
            self.assertTrue(sql.startswith('BEGIN; '+first))
            self.assertLess(sql.index(first),sql.index('pg_advisory_xact_lock('+str(r.MARKER)+')'))
            self.assertLess(sql.index('pg_advisory_xact_lock('+str(r.MARKER)+')'),sql.index(second))
            self.assertTrue(sql.endswith('COMMIT;'))
            self.assertIn(r.ROLES['a1'],cmd)
            self.assertIn(r.DB,cmd)
    def test_holder_is_transaction_scoped(self):
        with patch.object(r.subprocess,'Popen',return_value=Mock()) as pop:
            r.admin_lock_holder('a'*12)
            cmd=pop.call_args.args[0]
            statement=cmd[cmd.index('-c')+1]
            self.assertIn('BEGIN;',statement)
            self.assertIn('pg_advisory_xact_lock('+str(r.MARKER)+')',statement)
            self.assertIn('ROLLBACK;',statement)
    def test_sqlstate_with_extraneous_digits_rejected(self):
        x={'a':{'exitCode':0,'stdout':'MOVED\nMOVED\nCOMMIT','stderr':''},
           'b':{'exitCode':3,'stdout':'','stderr':'ERROR: 40P011'}}
        with self.assertRaises(r.DeadlockQAError):r.evaluate_sessions(x)
    def test_two_good_sessions_a_wins(self):
        results={'a':{'exitCode':0,'stdout':'BEGIN\nMOVED\nMOVED\nCOMMIT\n','stderr':''},
                 'b':{'exitCode':3,'stdout':'BEGIN\nMOVED\n','stderr':'ERROR: 40P01\n'}}
        self.assertEqual(r.evaluate_sessions(results),('a','b'))
    def test_two_good_sessions_b_wins(self):
        results={'b':{'exitCode':0,'stdout':'BEGIN\nMOVED\nMOVED\nCOMMIT\n','stderr':''},
                 'a':{'exitCode':3,'stdout':'BEGIN\nMOVED\n','stderr':'ERROR:  40P01\n'}}
        self.assertEqual(r.evaluate_sessions(results),('b','a'))
    def test_two_winners_rejected(self):
        x={t:{'exitCode':0,'stdout':'MOVED\nMOVED\nCOMMIT','stderr':''} for t in r.NAMES}
        with self.assertRaises(r.DeadlockQAError):r.evaluate_sessions(x)
    def test_two_losers_rejected(self):
        x={t:{'exitCode':3,'stdout':'','stderr':'ERROR: 40P01'} for t in r.NAMES}
        with self.assertRaises(r.DeadlockQAError):r.evaluate_sessions(x)
    def test_wrong_sqlstate_rejected(self):
        x={'a':{'exitCode':0,'stdout':'MOVED\nMOVED\nCOMMIT','stderr':''},
           'b':{'exitCode':3,'stdout':'','stderr':'ERROR: 55P03'}}
        with self.assertRaises(r.DeadlockQAError):r.evaluate_sessions(x)
    def test_one_write_winner_rejected(self):
        x={'a':{'exitCode':0,'stdout':'MOVED\nCOMMIT','stderr':''},
           'b':{'exitCode':3,'stdout':'','stderr':'ERROR: 40P01'}}
        with self.assertRaises(r.DeadlockQAError):r.evaluate_sessions(x)
    def test_loser_commit_rejected(self):
        x={'a':{'exitCode':0,'stdout':'MOVED\nMOVED\nCOMMIT','stderr':''},
           'b':{'exitCode':3,'stdout':'COMMIT','stderr':'ERROR: 40P01'}}
        with self.assertRaises(r.DeadlockQAError):r.evaluate_sessions(x)

def generate_gate(field,bad):
    def test(self):
        doc=sample();doc[field]=bad;self.reject(doc)
    return test
GATE_BAD={
    'version':'R204','mode':'PRODUCTION','release':'GO','migration':'APPLY',
    'realWorldGatesOpen':11,'syntheticOnly':False,'productionTouched':True,
    'productionAuthorized':True,'realAuthenticationVerified':True,'realRLSVerified':True,
    'externalWitnessVerified':True,'externalSignatureVerified':True,
    'independentProductionTest':True,'productionReady':True,'fixtureDb':'production',
    'fixtureRoles':6,'fiveTablesCovered':False,'deadlockSqlstate':'55P03',
    'deadlockVictimRolledBack':False,'winnerAuditExactlyOnce':False,
    'staleRetryRejected':False,'freshVersionRetryExactlyOnce':False,
    'originalR138BUnchanged':False,'priorR200Unchanged':False,
}
for name,bad in GATE_BAD.items():
    setattr(R204Tests,'test_lock_'+name,generate_gate(name,bad))

def tamper_counts(field,value):
    def test(self):
        doc=sample();doc[field]=value;self.reject(doc)
    return test
for f,val in [('winnerOperationRows',1),('loserOperationRows',1),('winnerAuditRows',1),('loserAuditRows',1)]:
    setattr(R204Tests,'test_tamper_'+f,tamper_counts(f,val))

if __name__=='__main__':unittest.main()

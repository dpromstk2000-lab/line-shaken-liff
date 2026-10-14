#!/usr/bin/env python3
"""R198: offline regression tests for failed statement SAVEPOINT recovery evidence."""
from __future__ import annotations
import copy
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch
import car02_r197_error_recovery_isolated as r

COMMIT='a'*40

def example():
    operations={}
    for i,(name,(state,reason,success)) in enumerate(r.EXPECTED.items()):
        before={t:f'{i+100+j:032x}' for j,t in enumerate(r.TABLES)}
        after={t:f'{i+200+j:032x}' for j,t in enumerate(r.TABLES)}
        operations[name]={'rejectedSqlstate':state,'rejectedReason':reason,
            'committedResult':success,'before':before,'after':after,
            'failedKeyCount':0,'successfulKeyCount':1,'auditCount':1}
    doc=dict(r.LOCK,githubCommit=COMMIT,operations=operations,
             finalSnapshot=copy.deepcopy(operations['complete']['after']))
    doc['sha256']=r.seal(doc)
    return doc

class R198Tests(unittest.TestCase):
    def reject(self,payload,reseal=True):
        if reseal:payload['sha256']=r.seal(payload)
        with self.assertRaises(r.RecoveryError):r.verify_report(payload)
    def test_good_proof(self):self.assertTrue(r.verify_report(example()))
    def test_exact_eight(self):self.assertEqual(len(r.OPS),8)
    def test_matrix_fully_covered(self):self.assertEqual(set(r.OPS),set(r.EXPECTED))
    def test_missing_operation(self):
        x=example();x['operations'].pop('move');self.reject(x)
    def test_extra_operation(self):
        x=example();x['operations']['production']=x['operations']['move'];self.reject(x)
    def test_wrong_type(self):
        x=example();x['operations']=[];self.reject(x)
    def test_reordering_does_not_change_proof(self):
        x=example();x['operations']=dict(reversed(list(x['operations'].items())));x['sha256']=r.seal(x)
        self.assertTrue(r.verify_report(x))
    def test_unchanged_after_success_rejected(self):
        x=example();x['operations']['quote']['after']=copy.deepcopy(x['operations']['quote']['before']);self.reject(x)
    def test_wrong_final_snapshot(self):
        x=example();x['finalSnapshot']['bookings']='f'*32;self.reject(x)
    def test_missing_final_table(self):
        x=example();x['finalSnapshot'].pop('audit_events');self.reject(x)
    def test_unsigned_commit(self):
        x=example();x['githubCommit']='g'*40;self.reject(x)
    def test_short_commit(self):
        x=example();x['githubCommit']='a'*39;self.reject(x)
    def test_uppercase_commit(self):
        x=example();x['githubCommit']='A'*40;self.reject(x)
    def test_unsealed_change_rejected(self):
        x=example();x['sha256']='0'*64;self.reject(x,False)
    def test_missing_seal_rejected(self):
        x=example();x.pop('sha256');self.reject(x,False)
    def test_extra_evidence_rejected(self):
        x=example();x['productionOk']=True;self.reject(x)
    def test_sql_allowlist(self):
        self.assertEqual(r.allowed_call("SELECT car02_r138_qa.claim_booking('key');"),"SELECT car02_r138_qa.claim_booking('key');")
    def test_sql_delete_denied(self):
        with self.assertRaises(r.RecoveryError):r.allowed_call('DELETE FROM public.customers;')
    def test_sql_second_statement_denied(self):
        with self.assertRaises(r.RecoveryError):r.allowed_call('SELECT car02_r138_qa.claim_booking(1); DROP TABLE foo;')
    def test_sql_unknown_function_denied(self):
        with self.assertRaises(r.RecoveryError):r.allowed_call('SELECT car02_r138_qa.disable_rls();')
    def test_sql_comment_denied(self):
        with self.assertRaises(r.RecoveryError):r.allowed_call('SELECT car02_r138_qa.claim_booking(); -- bypass')
    def test_error_recovery_sequence(self):
        res=SimpleNamespace(returncode=0,stdout='BEGIN\nSAVEPOINT\nROLLBACK\nCREATED\nRELEASE\nCOMMIT\n',
             stderr='psql:<stdin>:3: ERROR:  22023: R138_INVALID_BOOKING\nCONTEXT: synthetic\n')
        with patch.object(r.subprocess,'run',return_value=res) as run:
            good='SELECT car02_r138_qa.claim_booking(1);'
            self.assertEqual(r.execute_recovery('a'*12,'as',good,good,'22023','R138_INVALID_BOOKING','CREATED'),'CREATED')
            self.assertIn('ROLLBACK TO SAVEPOINT r197_guard;',run.call_args.kwargs['input'])
            self.assertIn('VERBOSITY=verbose',run.call_args.args[0])
            self.assertIn('ON_ERROR_STOP=off',run.call_args.args[0])
    def test_error_missing(self):
        res=SimpleNamespace(returncode=0,stdout='BEGIN\nSAVEPOINT\nROLLBACK\nCREATED\nRELEASE\nCOMMIT\n',stderr='')
        with patch.object(r.subprocess,'run',return_value=res):
            with self.assertRaises(r.RecoveryError):r.execute_recovery('a'*12,'as','SELECT car02_r138_qa.claim_booking(1);','SELECT car02_r138_qa.claim_booking(2);','22023','R138_INVALID_BOOKING','CREATED')
    def test_no_rollback_sequence(self):
        res=SimpleNamespace(returncode=0,stdout='BEGIN\nSAVEPOINT\nCREATED\nCOMMIT\n',stderr='ERROR:  22023: R138_INVALID_BOOKING\n')
        with patch.object(r.subprocess,'run',return_value=res):
            with self.assertRaises(r.RecoveryError):r.execute_recovery('a'*12,'as','SELECT car02_r138_qa.claim_booking(1);','SELECT car02_r138_qa.claim_booking(2);','22023','R138_INVALID_BOOKING','CREATED')
    def test_wrong_sqlstate(self):
        res=SimpleNamespace(returncode=0,stdout='BEGIN\nSAVEPOINT\nROLLBACK\nCREATED\nRELEASE\nCOMMIT\n',stderr='ERROR:  42501: R138_INVALID_BOOKING\n')
        with patch.object(r.subprocess,'run',return_value=res):
            with self.assertRaises(r.RecoveryError):r.execute_recovery('a'*12,'as','SELECT car02_r138_qa.claim_booking(1);','SELECT car02_r138_qa.claim_booking(2);','22023','R138_INVALID_BOOKING','CREATED')
    def test_duplicate_error(self):
        res=SimpleNamespace(returncode=0,stdout='BEGIN\nSAVEPOINT\nROLLBACK\nCREATED\nRELEASE\nCOMMIT\n',stderr='ERROR:  22023: R138_INVALID_BOOKING\nERROR:  22023: R138_INVALID_BOOKING\n')
        with patch.object(r.subprocess,'run',return_value=res):
            with self.assertRaises(r.RecoveryError):r.execute_recovery('a'*12,'as','SELECT car02_r138_qa.claim_booking(1);','SELECT car02_r138_qa.claim_booking(2);','22023','R138_INVALID_BOOKING','CREATED')
    def test_psql_nonzero_rejected(self):
        res=SimpleNamespace(returncode=3,stdout='',stderr='ERROR:  22023: R138_INVALID_BOOKING\n')
        with patch.object(r.subprocess,'run',return_value=res):
            with self.assertRaises(r.RecoveryError):r.execute_recovery('a'*12,'as','SELECT car02_r138_qa.claim_booking(1);','SELECT car02_r138_qa.claim_booking(2);','22023','R138_INVALID_BOOKING','CREATED')
    def test_no_role_postgres(self):
        with self.assertRaises(r.RecoveryError):r.execute_recovery('a'*12,'postgres','SELECT car02_r138_qa.claim_booking(1);','SELECT car02_r138_qa.claim_booking(2);','22023','R138_INVALID_BOOKING','CREATED')
    def test_container_validation(self):
        with self.assertRaises(r.RecoveryError):r.execute_recovery('live-container','as','SELECT car02_r138_qa.claim_booking(1);','SELECT car02_r138_qa.claim_booking(2);','22023','R138_INVALID_BOOKING','CREATED')
    def test_real_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'proof.json'
            r.save_report(example(),path)
            self.assertTrue(r.verify_report(json.loads(path.read_text(encoding='ascii'))))
    def test_file_no_overwrite(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'proof.json';r.save_report(example(),path)
            with self.assertRaises(r.RecoveryError):r.save_report(example(),path)
    def test_file_symlink_denied(self):
        with tempfile.TemporaryDirectory() as td:
            target=Path(td)/'target';target.write_text('original')
            shortcut=Path(td)/'link';shortcut.symlink_to(target)
            with self.assertRaises(r.RecoveryError):r.save_report(example(),shortcut)
            self.assertEqual(target.read_text(),'original')
    def test_file_parent_missing(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.RecoveryError):r.save_report(example(),Path(td)/'missing'/'proof.json')
    def test_probe_fails_before_db_for_wrong_output(self):
        with self.assertRaises(r.RecoveryError):r.probe('a'*12,COMMIT,'/tmp/live.json')
    def test_probe_fails_before_db_for_wrong_env(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R197_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.RecoveryError):r.probe('a'*12,COMMIT)

def make_bad_lock(k,v):
    def test(self):
        x=example();x[k]=v;self.reject(x)
    return test

BAD_LOCK={
 'version':'R198','mode':'PRODUCTION', 'release':'GO','migration':'GO',
 'realWorldGatesOpen':0,'syntheticOnly':False,'productionTouched':True,
 'productionAuthorized':True,'realAuthenticationVerified':True,
 'realRLSVerified':True,'externalWitnessVerified':True,'externalSignatureVerified':True,
 'independentProductionTest':True,'fixtureDb':'production','fixtureRoles':4,
 'allFiveTablesCovered':False,'originalR138BUnchanged':False,
 'priorR194Unchanged':False,'exactlyOneSuccessfulAuditPerOperation':False,
 'failedCommandsLeaveNoJournal':False,'transactionConnectionRecovered':False,
 'productionReady':True,
}
for k,v in BAD_LOCK.items():setattr(R198Tests,'test_bad_lock_'+k,make_bad_lock(k,v))

def make_bad_field(op,key,value):
    def test(self):
        d=example();d['operations'][op][key]=value;self.reject(d)
    return test
for op in r.OPS:
    for key,value in [('rejectedSqlstate','99999'),('rejectedReason','WRONG'),
            ('committedResult','FAILED'),('failedKeyCount',1),('successfulKeyCount',0),
            ('auditCount',2),('after',None)]:
        setattr(R198Tests,f'test_bad_{op}_{key}',make_bad_field(op,key,value))

if __name__=='__main__':unittest.main()

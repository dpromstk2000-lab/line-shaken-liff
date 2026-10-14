#!/usr/bin/env python3
"""R201: offline falsification of the R200 disposable row-lock timeout proof."""
from __future__ import annotations
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock
import car02_r200_lock_timeout_isolated as r

COMMIT='f'*40

def snap(n):
    return {name:format(n*100+i,'032x') for i,name in enumerate(r.TABLES)}

def sample():
    scenarios={}
    for index,name in enumerate(r.SCENARIOS):
        scenarios[name]=dict(before=snap(index+1),afterTimeout=snap(index+1),
            afterRetry=snap(index+2),timeoutSqlstate='55P03',retryResult=r.ANSWERS[name],
            operationRows=1,auditRows=1)
    doc=dict(r.LOCK,githubCommit=COMMIT,scenarios=scenarios,
             finalSnapshot=copy.deepcopy(scenarios['decide']['afterRetry']))
    doc['sha256']=r.seal(doc)
    return doc

class R201Tests(unittest.TestCase):
    def invalid(self,x,reseal=True):
        if reseal and 'sha256' in x:x['sha256']=r.seal(x)
        with self.assertRaises((r.LockTimeoutError,AssertionError)):
            r.verify_report(x)
    def test_valid(self):self.assertTrue(r.verify_report(sample()))
    def test_four_scenarios(self):self.assertEqual(r.SCENARIOS,('move','cancel','quote','decide'))
    def test_timeout_sqlstate(self):self.assertEqual(r.LOCK['timeoutSQLSTATE'],'55P03')
    def test_no_prod(self):
        self.assertEqual((r.LOCK['release'],r.LOCK['migration'],r.LOCK['realWorldGatesOpen']),('NO_GO','HOLD',12))
    def test_mutated_snapshot(self):
        s=sample();s['scenarios']['move']['afterTimeout']['bookings']='f'*32;self.invalid(s)
    def test_missing_snapshot_table(self):
        s=sample();del s['scenarios']['cancel']['before']['audit_events'];self.invalid(s)
    def test_extra_snapshot_table(self):
        s=sample();s['scenarios']['quote']['afterRetry']['secrets']='0'*32;self.invalid(s)
    def test_boolean_snapshot_hash(self):
        s=sample();s['scenarios']['decide']['before']['bookings']=True;self.invalid(s)
    def test_same_post_retry(self):
        s=sample();s['scenarios']['move']['afterRetry']=copy.deepcopy(s['scenarios']['move']['before']);self.invalid(s)
    def test_missing_case(self):
        s=sample();del s['scenarios']['quote'];self.invalid(s)
    def test_fake_case(self):
        s=sample();s['scenarios']['deleted']=s['scenarios']['move'];self.invalid(s)
    def test_wrong_scenarios_type(self):
        s=sample();s['scenarios']=[];self.invalid(s)
    def test_wrong_sqlstate(self):
        s=sample();s['scenarios']['move']['timeoutSqlstate']='57014';self.invalid(s)
    def test_wrong_result(self):
        s=sample();s['scenarios']['quote']['retryResult']='MOVED';self.invalid(s)
    def test_boolean_audit(self):
        s=sample();s['scenarios']['decide']['auditRows']=True;self.invalid(s)
    def test_extra_audit(self):
        s=sample();s['scenarios']['quote']['auditRows']=2;self.invalid(s)
    def test_missing_audit(self):
        s=sample();s['scenarios']['move']['auditRows']=0;self.invalid(s)
    def test_missing_op(self):
        s=sample();s['scenarios']['cancel']['operationRows']=0;self.invalid(s)
    def test_wrong_final_snapshot(self):
        s=sample();s['finalSnapshot']['audit_events']='f'*32;self.invalid(s)
    def test_commit_wrong(self):
        s=sample();s['githubCommit']='z'*40;self.invalid(s)
    def test_commit_uppercase(self):
        s=sample();s['githubCommit']='A'*40;self.invalid(s)
    def test_extra_report_field(self):
        s=sample();s['productionApproved']=True;self.invalid(s)
    def test_missing_digest(self):
        s=sample();del s['sha256'];self.invalid(s,False)
    def test_changed_digest(self):
        s=sample();s['sha256']='0'*64;self.invalid(s,False)
    def test_invalid_hash_type(self):
        s=sample();s['sha256']=True;self.invalid(s,False)
    def test_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            output=Path(td)/'proof.json';r.safe_write(sample(),output)
            self.assertTrue(r.verify_report(json.loads(output.read_text())))
    def test_no_overwrite(self):
        with tempfile.TemporaryDirectory() as td:
            output=Path(td)/'proof.json';r.safe_write(sample(),output)
            with self.assertRaises(r.LockTimeoutError):r.safe_write(sample(),output)
    def test_reject_symlink_file(self):
        with tempfile.TemporaryDirectory() as td:
            base=Path(td);p=base/'data.json';p.write_text('original')
            symlink=base/'alias.json';symlink.symlink_to(p)
            with self.assertRaises(r.LockTimeoutError):r.safe_write(sample(),symlink)
            self.assertEqual(p.read_text(),'original')
    def test_reject_missing_directory(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.LockTimeoutError):r.safe_write(sample(),Path(td)/'absent'/'proof.json')
    def test_probe_env_guard_before_database(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R200_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.LockTimeoutError):r.probe('a'*12,COMMIT)
    def test_probe_output_guard_before_database(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true','R200_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.LockTimeoutError):r.probe('a'*12,COMMIT,'/tmp/production.json')
    def test_probe_container_guard(self):
        with self.assertRaises(r.LockTimeoutError):r.probe('production',COMMIT)
    def test_lock_holder_bad_target(self):
        with self.assertRaises(r.LockTimeoutError):r.lock_holder('a'*12,'production',1,200001)
    def test_lock_holder_bad_marker(self):
        with self.assertRaises(r.LockTimeoutError):r.lock_holder('a'*12,'bookings',1,100)
    def test_lock_holder_bad_entity(self):
        with self.assertRaises(r.LockTimeoutError):r.lock_holder('a'*12,'bookings',0,200001)
    def test_await_lock_bad_marker(self):
        with self.assertRaises(r.LockTimeoutError):r.await_lock('a'*12,1,Mock())
    def test_release_lock_bad_pid(self):
        with self.assertRaises(r.LockTimeoutError):r.release_lock('a'*12,0,Mock())
    def test_admin_rejects_bad_container(self):
        with self.assertRaises(r.LockTimeoutError):r.admin_sql('production','SELECT 1;')
    def test_sql_denies_delete(self):
        with self.assertRaises(r.LockTimeoutError):r.timed_out('a'*12,'a1','DELETE FROM public.users;')
    def test_sql_denies_injection(self):
        with self.assertRaises(r.LockTimeoutError):r.timed_out('a'*12,'a1','SELECT car02_r138_qa.change_booking(1); DELETE FROM public.users;')
    def test_sql_denies_unknown_function(self):
        with self.assertRaises(r.LockTimeoutError):r.timed_out('a'*12,'a1','SELECT car02_r138_qa.admin_op(1);')
    def test_timed_out_wrong_role(self):
        with self.assertRaises(r.LockTimeoutError):r.timed_out('a'*12,'postgres','SELECT car02_r138_qa.change_booking(1);')
    def test_timed_out_correct_sqlstate(self):
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=3,stderr='ERROR:  55P03\n',stdout='')) as call:
            self.assertEqual(r.timed_out('a'*12,'a1','SELECT car02_r138_qa.change_booking(1);'),'55P03')
            self.assertIn('VERBOSITY=sqlstate',call.call_args.args[0]);self.assertIn('300ms',call.call_args.args[0][-1])
    def test_timed_out_other_code_denied(self):
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=3,stderr='ERROR:  42501\n',stdout='')):
            with self.assertRaises(r.LockTimeoutError):r.timed_out('a'*12,'a1','SELECT car02_r138_qa.change_booking(1);')
    def test_timed_out_false_success_denied(self):
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=0,stderr='',stdout='MOVED')):
            with self.assertRaises(r.LockTimeoutError):r.timed_out('a'*12,'a1','SELECT car02_r138_qa.change_booking(1);')
    def test_holder_sql_readonly_lock(self):
        with patch.object(r.subprocess,'Popen',return_value=Mock()) as mock:
            r.lock_holder('a'*12,'bookings',12,200001)
            stmt=mock.call_args.args[0][-1]
            self.assertIn('FOR UPDATE',stmt);self.assertIn('pg_advisory_xact_lock(200001)',stmt)
            self.assertNotIn('INSERT ',stmt);self.assertNotIn('DELETE ',stmt)
    def test_await_lock_observes_marker(self):
        with patch.object(r,'admin_sql',return_value='12345'):
            self.assertEqual(r.await_lock('a'*12,200001,Mock(poll=Mock(return_value=None))),12345)
    def test_cancel_live_backend(self):
        holder=Mock(poll=Mock(return_value=1),communicate=Mock(return_value=('','ERROR: canceling statement due to user request')))
        holder.returncode=3
        with patch.object(r,'admin_sql',return_value='t') as m:
            r.release_lock('a'*12,12345,holder)
            self.assertIn('pg_cancel_backend(12345)',m.call_args.args[1])


def reject_gate(name,value):
    def test(self):
        d=sample();d[name]=value;self.invalid(d)
    return test

GATES={
 'version':'R201','mode':'PRODUCTION','release':'GO','migration':'READY',
 'realWorldGatesOpen':0,'syntheticOnly':False,'productionTouched':True,
 'productionAuthorized':True,'realAuthenticationVerified':True,'realRLSVerified':True,
 'externalWitnessVerified':True,'externalSignatureVerified':True,
 'independentProductionTest':True,'fixtureDb':'production','fixtureRoles':6,
 'fiveTablesCovered':False,'timeoutSQLSTATE':'42501','timeoutLeavesNoBusinessWrites':False,
 'retryAuditExactlyOnce':False,'sourceR138BUnchanged':False,
 'priorR197Unchanged':False,'productionReady':True,
}
for k,v in GATES.items():setattr(R201Tests,'test_gate_'+k,reject_gate(k,v))

def reject_case(name,field,value):
    def test(self):
        d=sample();d['scenarios'][name][field]=value;self.invalid(d)
    return test
for name in r.SCENARIOS:
    setattr(R201Tests,'test_bad_result_'+name,reject_case(name,'retryResult','REJECTED'))
    setattr(R201Tests,'test_bad_state_'+name,reject_case(name,'timeoutSqlstate','40001'))
    setattr(R201Tests,'test_bad_op_'+name,reject_case(name,'operationRows',2))
    setattr(R201Tests,'test_bad_audit_'+name,reject_case(name,'auditRows',0))

if __name__=='__main__':unittest.main()

#!/usr/bin/env python3
"""R207: adversarial, deterministic and real-file checks for R206 proof."""
from __future__ import annotations
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import car02_r206_disconnect_atomicity_isolated as r

COMMIT='a'*40

def snap(n):
    return {name:format(n*100+i,'032x') for i,name in enumerate(r.TABLES)}

def valid():
    records={}
    for i,name in enumerate(r.SCENARIOS):
        records[name]=dict(before=snap(i+1),afterTermination=snap(i+1),
            afterRetry=snap(i+2),disconnectSqlstate=r.SQLSTATE,
            retryResult=r.ANSWERS[name],operationRows=0 if name=='booking' else 1,auditRows=1)
    doc=dict(r.LOCK,githubCommit=COMMIT,scenarios=records,
             finalSnapshot=copy.deepcopy(records['decide']['afterRetry']))
    doc['sha256']=r.seal(doc)
    return doc

class R207Tests(unittest.TestCase):
    def reject(self,doc,reseal=True):
        if reseal and 'sha256' in doc:doc['sha256']=r.seal(doc)
        with self.assertRaises(r.DisconnectQAError):r.verify_report(doc)
    def test_valid(self):self.assertTrue(r.verify_report(valid()))
    def test_four_scenarios(self):self.assertEqual(r.SCENARIOS,('booking','move','quote','decide'))
    def test_expected_results(self):self.assertEqual(set(r.ANSWERS),set(r.SCENARIOS))
    def test_missing_scenario(self):
        x=valid();del x['scenarios']['quote'];self.reject(x)
    def test_extra_scenario(self):
        x=valid();x['scenarios']['custom']=x['scenarios']['quote'];self.reject(x)
    def test_empty_scenarios(self):
        x=valid();x['scenarios']={};self.reject(x)
    def test_wrong_scenarios_type(self):
        x=valid();x['scenarios']=[];self.reject(x)
    def test_bad_commit_length(self):
        x=valid();x['githubCommit']='a'*39;self.reject(x)
    def test_bad_commit_char(self):
        x=valid();x['githubCommit']='z'*40;self.reject(x)
    def test_missing_sha(self):
        x=valid();del x['sha256'];self.reject(x,False)
    def test_bad_sha(self):
        x=valid();x['sha256']='0'*64;self.reject(x,False)
    def test_unknown_field(self):
        x=valid();x['productionAllowed']=True;self.reject(x)
    def test_no_final_table(self):
        x=valid();x['finalSnapshot'].pop('audit_events');self.reject(x)
    def test_final_drift(self):
        x=valid();x['finalSnapshot']['bookings']='f'*32;self.reject(x)
    def test_evidence_order_not_semantic(self):
        x=valid();x['scenarios']=dict(reversed(list(x['scenarios'].items())));x['sha256']=r.seal(x)
        self.assertTrue(r.verify_report(x))
    def test_admin_invalid_cid(self):
        with self.assertRaises(r.DisconnectQAError):r.admin('prod','SELECT 1')
    def test_admin_injection(self):
        with self.assertRaises(r.DisconnectQAError):r.admin('a'*12,'SELECT 1; DROP TABLE users;')
    def test_client_bad_cid(self):
        with self.assertRaises(r.DisconnectQAError):r.client('PRODUCTION','a1','booking','SELECT car02_r138_qa.claim_booking(1);')
    def test_client_bad_actor(self):
        with self.assertRaises(r.DisconnectQAError):r.client('a'*12,'postgres','booking','SELECT car02_r138_qa.claim_booking(1);')
    def test_client_bad_case(self):
        with self.assertRaises(r.DisconnectQAError):r.client('a'*12,'a1','erase','SELECT car02_r138_qa.claim_booking(1);')
    def test_client_bad_sql(self):
        with self.assertRaises(r.DisconnectQAError):r.client('a'*12,'a1','booking','DELETE FROM users;')
    def test_client_multiple_sql(self):
        with self.assertRaises(r.DisconnectQAError):r.client('a'*12,'a1','booking','SELECT car02_r138_qa.claim_booking(1); SELECT 1;')
    def test_admin_query_failed(self):
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=1,stdout='',stderr='connection lost')):
            with self.assertRaises(r.DisconnectQAError):r.admin('a'*12,'SELECT 1')
    def test_admin_readonly_cmd(self):
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=0,stdout='123\n',stderr='')) as fake:
            self.assertEqual(r.admin('a'*12,'SELECT 123'),'123')
            self.assertEqual(fake.call_args.args[0][:2],['docker','exec'])
    def test_wait_terminated_early(self):
        with patch.object(r,'admin',return_value=''):
            with self.assertRaises(r.DisconnectQAError):r.await_sleep('a'*12,'booking',Mock(poll=Mock(return_value=1)),0.1)
    def test_wait_invalid_seconds(self):
        with self.assertRaises(r.DisconnectQAError):r.await_sleep('a'*12,'booking',Mock(),0)
    def test_wait_sees_sleep(self):
        with patch.object(r,'admin',return_value='911') as fake:
            self.assertEqual(r.await_sleep('a'*12,'booking',Mock(poll=Mock(return_value=None)),1),911)
            self.assertIn("wait_event='PgSleep'",fake.call_args.args[1])
    def test_wait_timeout(self):
        with patch.object(r,'admin',return_value=''):
            with self.assertRaises(r.DisconnectQAError):r.await_sleep('a'*12,'booking',Mock(poll=Mock(return_value=None)),0.01)
    def test_client_has_begin_sleep_commit(self):
        with patch.object(r.subprocess,'Popen',return_value=Mock()) as fake:
            r.client('a'*12,'as','booking','SELECT car02_r138_qa.claim_booking(1);')
            cmd=fake.call_args.args[0]
            script=cmd[-1]
            self.assertLess(script.index('BEGIN;'),script.index('SELECT car02_r138_qa'))
            self.assertLess(script.index('SELECT car02_r138_qa'),script.index('pg_sleep(30)'))
            self.assertLess(script.index('pg_sleep(30)'),script.index('COMMIT;'))
    def test_terminate_success(self):
        proc=Mock(returncode=1)
        proc.poll.return_value=1
        proc.communicate.return_value=('BEGIN\nCREATED\n','FATAL:  57P01\n')
        with patch.object(r,'client',return_value=proc),patch.object(r,'await_sleep',return_value=456),patch.object(r,'admin',return_value='t'):
            self.assertEqual(r.terminate('a'*12,'booking','as','SELECT car02_r138_qa.claim_booking(1);'),'57P01')
    def test_terminate_wrong_state(self):
        proc=Mock(returncode=1)
        proc.poll.return_value=1
        proc.communicate.return_value=('BEGIN\nCREATED\n','FATAL:  08006\n')
        with patch.object(r,'client',return_value=proc),patch.object(r,'await_sleep',return_value=456),patch.object(r,'admin',return_value='t'):
            with self.assertRaises(r.DisconnectQAError):r.terminate('a'*12,'booking','as','SELECT car02_r138_qa.claim_booking(1);')
    def test_terminate_illegal_success(self):
        proc=Mock(returncode=0)
        proc.poll.return_value=0
        proc.communicate.return_value=('BEGIN\nCREATED\nCOMMIT\n','')
        with patch.object(r,'client',return_value=proc),patch.object(r,'await_sleep',return_value=456),patch.object(r,'admin',return_value='t'):
            with self.assertRaises(r.DisconnectQAError):r.terminate('a'*12,'booking','as','SELECT car02_r138_qa.claim_booking(1);')
    def test_terminate_not_accepted(self):
        proc=Mock(returncode=1)
        proc.poll.return_value=1
        with patch.object(r,'client',return_value=proc),patch.object(r,'await_sleep',return_value=456),patch.object(r,'admin',return_value='f'):
            with self.assertRaises(r.DisconnectQAError):r.terminate('a'*12,'booking','as','SELECT car02_r138_qa.claim_booking(1);')
    def test_invalid_environment(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R206_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.DisconnectQAError):r.probe('a'*12,COMMIT)
    def test_invalid_output(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true','R206_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.DisconnectQAError):r.probe('a'*12,COMMIT,'/tmp/production.json')
    def test_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            dest=Path(td)/'proof.json';r.safe_write(valid(),dest)
            self.assertTrue(r.verify_report(json.loads(dest.read_text())))
    def test_file_no_overwrite(self):
        with tempfile.TemporaryDirectory() as td:
            dest=Path(td)/'proof.json';r.safe_write(valid(),dest)
            with self.assertRaises(r.DisconnectQAError):r.safe_write(valid(),dest)
    def test_symlink_reject(self):
        with tempfile.TemporaryDirectory() as td:
            dest=Path(td)/'real.json';dest.write_text('preserve')
            link=Path(td)/'linked.json';link.symlink_to(dest)
            with self.assertRaises(r.DisconnectQAError):r.safe_write(valid(),link)
            self.assertEqual(dest.read_text(),'preserve')
    def test_parent_missing(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.DisconnectQAError):r.safe_write(valid(),Path(td)/'missing'/'proof.json')


def mutate_field(key,value):
    def test(self):
        d=valid();d[key]=value;self.reject(d)
    return test

BAD={
    'version':'R999','mode':'PRODUCTION','release':'GO','migration':'GO','realWorldGatesOpen':0,
    'syntheticOnly':False,'productionTouched':True,'productionAuthorized':True,
    'realAuthenticationVerified':True,'realRLSVerified':True,'externalWitnessVerified':True,
    'externalSignatureVerified':True,'independentProductionTest':True,'productionReady':True,
    'fixtureDb':'production','fixtureRoles':6,'allFiveTablesCovered':False,
    'disconnectSQLSTATE':'00000','noUncommittedBusinessRows':False,'retryExactlyOnce':False,
    'sourceR138BUnchanged':False,'priorR203Unchanged':False,
}
for key,value in BAD.items():setattr(R207Tests,'test_gate_'+key,mutate_field(key,value))

def mutate_scenario(name,field,value):
    def test(self):
        d=valid();d['scenarios'][name][field]=value;self.reject(d)
    return test

for name in r.SCENARIOS:
    for field,val in [('disconnectSqlstate','08006'),('retryResult','IDEMPOTENT'),('operationRows',2),('auditRows',2),
        ('afterTermination',snap(99)),('afterRetry',snap(99))]:
        setattr(R207Tests,'test_case_'+name+'_'+field,mutate_scenario(name,field,val))

if __name__=='__main__':unittest.main()

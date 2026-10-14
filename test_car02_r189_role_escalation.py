#!/usr/bin/env python3
"""R189: offline falsification of R188 PG17 denial matrix and proof I/O."""
import copy
import json
import os
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch, Mock
import car02_r188_role_escalation_isolated as r

COMMIT='f'*40


def sample():
    owner={t:({'bookings':2,'service_cases':1,'case_operations':2,
               'booking_operations':1,'audit_events':4}[t]) for t in r.TABLES}
    baseline={'a1':owner.copy(),'a2':owner.copy(),'b1':owner.copy(),
              'as':{k:2*v for k,v in owner.items()},'bs':owner.copy()}
    counts={k:x.copy() for k,x in baseline.items()}
    snap={table:format(1000+i,'032x') for i,table in enumerate(r.TABLES)}
    doc=dict(r.LOCK,githubCommit=COMMIT,baseline=baseline,after=counts,
             dataBefore=snap.copy(),dataAfter=snap.copy(),
             denials={case:r.SQLSTATE for case in r.CASE_MATRIX})
    doc['sha256']=r.seal(doc)
    return doc

class R189Tests(unittest.TestCase):
    def fail_proof(self, candidate,reseal=True):
        if reseal:candidate['sha256']=r.seal(candidate)
        with self.assertRaises((r.RoleEscalationError,AssertionError)):
            r.verify_report(candidate)
    def test_valid(self):self.assertTrue(r.verify_report(sample()))
    def test_exact_matrix(self):
        self.assertEqual(len(r.CASE_MATRIX),40)
        self.assertEqual(len(set(r.CASE_MATRIX)),len(r.CASE_MATRIX))
    def test_matrix_covers_all_roles(self):
        for actor in r.ACTORS:
            self.assertEqual(sum(k.startswith(actor+':') for k in r.CASE_MATRIX),8)
            self.assertIn(actor+':session_auth:postgres',r.CASE_MATRIX)
    def test_valid_denial_fakes(self):
        for statement in r.CASE_MATRIX.values():
            self.assertTrue(statement.endswith(';'))
            self.assertNotIn('public.',statement)
    def test_changed_count(self):
        p=sample();p['after']['a1']['bookings']+=1;self.fail_proof(p)
    def test_changed_baseline(self):
        p=sample();p['baseline']['as']['bookings']+=1;self.fail_proof(p)
    def test_false_boolean_count(self):
        p=sample();p['baseline']['a1']['bookings']=True;self.fail_proof(p)
    def test_negative_count(self):
        p=sample();p['baseline']['a1']['bookings']=-1;self.fail_proof(p)
    def test_unknown_role(self):
        p=sample();p['baseline']['postgres']={};self.fail_proof(p)
    def test_changed_data(self):
        p=sample();p['dataAfter']['bookings']='0'*32;self.fail_proof(p)
    def test_missing_table(self):
        p=sample();del p['dataAfter']['service_cases'];self.fail_proof(p)
    def test_add_table(self):
        p=sample();p['dataAfter']['login_secrets']='0'*32;self.fail_proof(p)
    def test_upper_hash(self):
        p=sample();p['dataBefore']['bookings']='F'*32;self.fail_proof(p)
    def test_missing_digest(self):
        p=sample();del p['sha256'];self.fail_proof(p,reseal=False)
    def test_wrong_digest(self):
        p=sample();p['sha256']='0'*64;self.fail_proof(p,reseal=False)
    def test_add_unauthorized_field(self):
        p=sample();p['productionApproved']=True;self.fail_proof(p)
    def test_not_hex_commit(self):
        p=sample();p['githubCommit']='z'*40;self.fail_proof(p)
    def test_wrong_commit_length(self):
        p=sample();p['githubCommit']='f'*39;self.fail_proof(p)
    def test_bad_actor_call(self):
        with self.assertRaises(r.RoleEscalationError):
            r.denied_sql('a'*12,'postgres','SET ROLE car02_r138_a_one_ci;')
    def test_bad_cid_call(self):
        with self.assertRaises(r.RoleEscalationError):
            r.denied_sql('production','a1','SET ROLE postgres;')
    def test_arbitrary_statement_denied(self):
        with self.assertRaises(r.RoleEscalationError):
            r.denied_sql('a'*12,'a1','DELETE FROM public.users;')
    def test_expected_psql_acl_denial(self):
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=3,stderr='ERROR:  42501\n',stdout='')) as exec_mock:
            self.assertEqual(r.denied_sql('a'*12,'a1','SET ROLE postgres;'),'42501')
            command=exec_mock.call_args.args[0]
            self.assertEqual(command[0:2],['docker','exec'])
            self.assertIn('VERBOSITY=sqlstate',command)
    def test_success_is_not_denial(self):
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=0,stderr='',stdout='SET\n')):
            with self.assertRaises(r.RoleEscalationError):
                r.denied_sql('a'*12,'a1','SET ROLE postgres;')
    def test_wrong_sqlstate(self):
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=3,stderr='ERROR:  42601\n',stdout='')):
            with self.assertRaises(r.RoleEscalationError):
                r.denied_sql('a'*12,'a1','SET ROLE postgres;')
    def test_error_message_without_sqlstate(self):
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=3,stderr='ERROR: permission denied\n',stdout='')):
            with self.assertRaises(r.RoleEscalationError):
                r.denied_sql('a'*12,'a1','SET ROLE postgres;')
    def test_probe_guards_env_before_db(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R188_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.RoleEscalationError):r.probe('a'*12,COMMIT)
    def test_probe_guards_path_before_db(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true','R188_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.RoleEscalationError):r.probe('a'*12,COMMIT,'/tmp/unsafe.json')
    def test_real_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            target=Path(td)/'proof.json'
            r.safe_write(sample(),target)
            self.assertTrue(r.verify_report(json.loads(target.read_text())))
    def test_no_overwrite(self):
        with tempfile.TemporaryDirectory() as td:
            target=Path(td)/'proof.json';r.safe_write(sample(),target)
            with self.assertRaises(r.RoleEscalationError):r.safe_write(sample(),target)
    def test_symlink_denied(self):
        with tempfile.TemporaryDirectory() as td:
            original=Path(td)/'real.json';original.write_text('original')
            shortcut=Path(td)/'link.json';shortcut.symlink_to(original)
            with self.assertRaises(r.RoleEscalationError):r.safe_write(sample(),shortcut)
            self.assertEqual(original.read_text(),'original')
    def test_output_parent_missing(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.RoleEscalationError):r.safe_write(sample(),Path(td)/'missing'/'proof.json')


def gate_test(field,original):
    def test(self):
        proof=sample()
        proof[field]=original
        self.fail_proof(proof)
    return test

BAD={
  'version':'R189','mode':'REAL_PRODUCTION', 'release':'GO','migration':'GO',
  'realWorldGatesOpen':0,'syntheticOnly':False,'productionTouched':True,
  'productionAuthorized':True,'realAuthenticationVerified':True,'realRLSVerified':True,
  'externalWitnessVerified':True,'externalSignatureVerified':True,
  'independentProductionTest':True,'fixtureDb':'retained', 'fixtureRoles':6,
  'allFiveTablesCovered':False,'originalR138BUnchanged':False,
  'priorR185Unchanged':False,'liveAuthorizationEstablished':True,
}
for key,val in BAD.items():
    setattr(R189Tests,'test_bad_gate_'+key,gate_test(key,val))

def denied_case_test(key):
    def test(self):
        doc=sample();doc['denials'][key]='42601';self.fail_proof(doc)
    return test
for index,key in enumerate(r.CASE_MATRIX):
    setattr(R189Tests,f'test_denial_{index:02}',denied_case_test(key))

def snapshot_hash_test(name):
    def test(self):
        d=sample();d['dataAfter'][name]='f'*32;self.fail_proof(d)
    return test
for name in r.TABLES:
    setattr(R189Tests,'test_snapshot_'+name,snapshot_hash_test(name))

if __name__=='__main__':unittest.main()

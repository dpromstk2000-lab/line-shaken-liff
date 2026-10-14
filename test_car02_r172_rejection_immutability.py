#!/usr/bin/env python3
"""R172: offline destructive-proof, input-guard, and real file I/O tests for R171."""
from __future__ import annotations
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import car02_r171_rejection_immutability_isolated as r

COMMIT='f'*40
EMPTY={table:'0'*32 for table in r.TABLES}
FINAL={table:'a'*32 for table in r.TABLES}
AUDITS={owner:{k:(0 if k=='COMPLETE' and owner=='a2' else 1) for k in ('REPORT','QUOTE','DECIDE','COMPLETE')}
        for owner in ('a1','a2','b1')}

def sample():
    doc=dict(r.LOCK,githubCommit=COMMIT,
             denied=copy.deepcopy(r.CHECK_REASON),
             denialSnapshots={k:{'before':copy.deepcopy(EMPTY),'after':copy.deepcopy(EMPTY)} for k in r.REQUIRED_CHECKS},
             snapshots={'initial':copy.deepcopy(EMPTY),'final':copy.deepcopy(FINAL)},
             audits=copy.deepcopy(AUDITS))
    doc['sha256']=r.seal(doc)
    return doc

def change(d,mutate):
    mutate(d);d['sha256']=r.seal(d)
    return d

class R172Report(unittest.TestCase):
    def reject(self,d):
        with self.assertRaises(r.RegressionError):r.verify_report(d)
    def test_valid(self):self.assertTrue(r.verify_report(sample()))
    def test_missing_field(self):self.reject(change(sample(),lambda d:d.pop('audits')))
    def test_unknown_field(self):self.reject(change(sample(),lambda d:d.update(backdoor='GO')))
    def test_sha_corruption(self):d=sample();d['sha256']='0'*64;self.reject(d)
    def test_sha_removed(self):d=sample();d.pop('sha256');self.reject(d)
    def test_commit_short(self):self.reject(change(sample(),lambda d:d.update(githubCommit='a')))
    def test_commit_uppercase(self):self.reject(change(sample(),lambda d:d.update(githubCommit='F'*40)))
    def test_commit_nonhex(self):self.reject(change(sample(),lambda d:d.update(githubCommit='z'*40)))
    def test_missing_case(self):self.reject(change(sample(),lambda d:d['denied'].pop('otherCustomerDecision')))
    def test_extra_case(self):self.reject(change(sample(),lambda d:d['denied'].update(privileged='GO')))
    def test_unknown_reason(self):self.reject(change(sample(),lambda d:d['denied'].update(reportEmpty='FAKE_REASON')))
    def test_nonstring_reason(self):self.reject(change(sample(),lambda d:d['denied'].update(reportEmpty=1)))
    def test_direct_write_reason(self):self.reject(change(sample(),lambda d:d['denied'].update(directWrite='R138_ROLE_DENIED')))
    def test_missing_denial_evidence(self):self.reject(change(sample(),lambda d:d['denialSnapshots'].pop('reportEmpty')))
    def test_denial_evidence_mutation(self):self.reject(change(sample(),lambda d:d['denialSnapshots']['reportEmpty']['after'].update(bookings='f'*32)))
    def test_denial_evidence_extra_field(self):self.reject(change(sample(),lambda d:d['denialSnapshots']['reportEmpty'].update(ignored=True)))
    def test_missing_snapshot(self):self.reject(change(sample(),lambda d:d['snapshots'].pop('initial')))
    def test_extra_snapshot(self):self.reject(change(sample(),lambda d:d['snapshots'].update(before={})))
    def test_missing_table_digest(self):self.reject(change(sample(),lambda d:d['snapshots']['final'].pop('audit_events')))
    def test_extra_table_digest(self):self.reject(change(sample(),lambda d:d['snapshots']['initial'].update(users='0'*32)))
    def test_bad_digest(self):self.reject(change(sample(),lambda d:d['snapshots']['initial'].update(bookings='x'*32)))
    def test_uppercase_digest(self):self.reject(change(sample(),lambda d:d['snapshots']['final'].update(bookings='A'*32)))
    def test_missing_audit_owner(self):self.reject(change(sample(),lambda d:d['audits'].pop('b1')))
    def test_wrong_audit_count(self):self.reject(change(sample(),lambda d:d['audits']['a1'].update(QUOTE=2)))
    def test_audit_count_bool(self):self.reject(change(sample(),lambda d:d['audits']['b1'].update(COMPLETE=True)))
    def test_audit_missing_action(self):self.reject(change(sample(),lambda d:d['audits']['a2'].pop('REPORT')))
    def test_declined_complete_forged(self):self.reject(change(sample(),lambda d:d['audits']['a2'].update(COMPLETE=1)))
    def test_reason_for_direct_dml_only(self):self.reject(change(sample(),lambda d:d['denied'].update(reportEmpty='DIRECT_DML_DENIED',directWrite='R138_ROLE_DENIED')))
    def test_reseal_is_not_signature(self):
        d=sample();d['snapshots']['final']['bookings']='b'*32;d['sha256']=r.seal(d)
        # Local checksum is self-consistent but not an external tamper-proof signature.
        self.assertTrue(r.verify_report(d))
    def test_real_json_save_and_reopen(self):
        with tempfile.TemporaryDirectory() as td:
            dest=Path(td)/'r171.json';r.save(sample(),dest)
            self.assertTrue(r.verify_report(json.loads(dest.read_text(encoding='ascii'))))
    def test_refuse_overwrite(self):
        with tempfile.TemporaryDirectory() as td:
            dest=Path(td)/'r171.json';r.save(sample(),dest)
            with self.assertRaises(r.RegressionError):r.save(sample(),dest)
    def test_refuse_symlink(self):
        with tempfile.TemporaryDirectory() as td:
            dest=Path(td)/'original';dest.write_text('unchanged')
            alias=Path(td)/'alias';alias.symlink_to(dest)
            with self.assertRaises(r.RegressionError):r.save(sample(),alias)
            self.assertEqual(dest.read_text(),'unchanged')
    def test_refuse_missing_parent(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.RegressionError):r.save(sample(),Path(td)/'missing'/'report.json')
    def test_bad_container_before_db(self):
        with self.assertRaises(r.RegressionError):r.probe('production-db',COMMIT)
    def test_bad_commit_before_db(self):
        with self.assertRaises(r.RegressionError):r.probe('a'*12,'oops')
    def test_output_scope_before_db(self):
        with self.assertRaises(r.RegressionError):r.probe('a'*12,COMMIT,'/tmp/prod.json')
    def test_release_lock_before_db(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R171_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.RegressionError):r.probe('a'*12,COMMIT)
    def test_full_snapshot_digest_is_five_tables(self):
        self.assertEqual(len(r.TABLES),5)
        self.assertEqual(len(set(r.TABLES)),5)
    def test_snapshot_rejects_bad_cid_before_docker(self):
        with self.assertRaises(r.RegressionError):r.snapshot('production')
    def test_snapshot_no_database_calls_in_report_verifier(self):
        with patch.object(r,'snapshot',side_effect=AssertionError('called')):
            self.assertTrue(r.verify_report(sample()))
    def test_sql_step_rejects_negative_case(self):
        with self.assertRaises(r.RegressionError):r.sql_step('key',0,'REPORT',1)
    def test_sql_step_rejects_bool_case(self):
        with self.assertRaises(r.RegressionError):r.sql_step('key',True,'REPORT',1)
    def test_sql_step_rejects_wrong_version(self):
        with self.assertRaises(r.RegressionError):r.sql_step('key',1,'REPORT',0)
    def test_sql_step_only_scoped_function(self):
        self.assertTrue(r.sql_step('r172_valid_key',5,'REPORT',1,note='valid note').startswith('SELECT car02_r138_qa.case_step('))
        # GitHub PG17 run #2: the original comma caused R138_BAD_LITERAL before SQL.
        self.assertEqual(r.lit(r.REPORT_NOTE), "'Synthetic brake pads checked with no user data'")
        self.assertIn(r.lit(r.REPORT_NOTE), r.sql_step('r172_valid_report',5,'REPORT',1,note=r.REPORT_NOTE))
        with self.assertRaisesRegex(AssertionError,'R138_BAD_LITERAL'):
            r.lit('Synthetic brake pads checked, no user data')
        # The next negative-quote probe needs a literal -1 for DB-level validation;
        # R138B lit() continues to reject it for all other callers.
        with self.assertRaisesRegex(AssertionError,'R138_BAD_NUMBER'):
            r.lit(-1)
        self.assertIn(',-1,100,NULL', r.sql_step('r172_negative_quote',5,'QUOTE',2,part=-1,labor=100))
        with self.assertRaisesRegex(AssertionError,'R138_BAD_NUMBER'):
            r.sql_step('r172_bad_amount',5,'QUOTE',2,part=-2,labor=100)
    def test_no_mutation_refuses_invalid_reason_without_db(self):
        with self.assertRaises(r.RegressionError):r.no_mutation('a'*12,'a1','DELETE...','UNTRUSTED')
    def test_no_mutation_accepts_expected_rejection(self):
        with patch.object(r,'snapshot',side_effect=[copy.deepcopy(EMPTY),copy.deepcopy(EMPTY)]),patch.object(r,'psql',return_value='REJECTED') as p:
            self.assertEqual(r.no_mutation('a'*12,'a1','SELECT car02_r138_qa.case_step(...);','R138_ROLE_DENIED'),'R138_ROLE_DENIED')
            self.assertEqual(p.call_count,1)
    def test_no_mutation_catches_modified_table(self):
        changed=copy.deepcopy(EMPTY);changed['audit_events']='a'*32
        with patch.object(r,'snapshot',side_effect=[copy.deepcopy(EMPTY),changed]),patch.object(r,'psql',return_value='REJECTED'):
            with self.assertRaises(r.RegressionError):r.no_mutation('a'*12,'a1','SELECT car02_r138_qa.case_step(...);','R138_ROLE_DENIED')
    def test_no_mutation_catches_false_success(self):
        with patch.object(r,'snapshot',side_effect=[copy.deepcopy(EMPTY)]),patch.object(r,'psql',return_value='APPROVED'):
            with self.assertRaises(r.RegressionError):r.no_mutation('a'*12,'a1','SELECT car02_r138_qa.case_step(...);','R138_ROLE_DENIED')

# Verify each immutable gate is type-sensitive and cannot be self-resealed to GO.
BAD_LOCK={
    'version':'R170', 'mode':'PRODUCTION', 'release':'GO','migration':'READY',
    'realWorldGatesOpen':0,'syntheticOnly':False,'productionTouched':True,
    'productionAuthorized':True,'realAuthenticationVerified':True,
    'realRLSVerified':True,'externalWitnessVerified':True,
    'externalSignatureVerified':True,'independentProductionTest':True,
    'externalEvidenceWitness':True,'syntheticDb':'prod', 'fixtureRoles':4,
    'fiveTablesCovered':False,'rejectedCommandsDoNotMutate':False,
    'validAuditExactlyOnce':False,'sameShopDifferentCustomerDenied':False,
    'crossShopDenied':False,'immutableR138BFixture':False,'priorR168Unchanged':False,
}
for key,value in BAD_LOCK.items():
    def make_test(k,v):
        def test(self):
            d=sample();d[k]=v;d['sha256']=r.seal(d);self.reject(d)
        return test
    setattr(R172Report,'test_lock_'+key,make_test(key,value))

if __name__=='__main__':unittest.main()

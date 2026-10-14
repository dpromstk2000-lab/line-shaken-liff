#!/usr/bin/env python3
"""R192: local fail-closed proof, SQL guard, and real file I/O tests for R191."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import car02_r191_transaction_rollback_isolated as r

COMMIT='a'*40

def fixture():
    d={k:v for k,v in r.LOCK.items()}
    operations={name:{'before':{t:format(1000+i,'032x') for i,t in enumerate(r.TABLES)},
                      'after':{t:format(1000+i,'032x') for i,t in enumerate(r.TABLES)},
                      'rollbackResult':expect} for name,expect in zip(r.OPS,r.EXPECTED)}
    doc=dict(d,githubCommit=COMMIT,operations=operations,
             finalSnapshot={t:format(2000+i,'032x') for i,t in enumerate(r.TABLES)})
    doc['sha256']=r.seal(doc)
    return doc

class R192Tests(unittest.TestCase):
    def bad(self,d,reseal=True):
        if reseal:d['sha256']=r.seal(d)
        with self.assertRaises(r.RollbackError):r.verify_report(d)
    def test_valid(self):self.assertTrue(r.verify_report(fixture()))
    def test_exact_eight_operations(self):self.assertEqual(len(r.OPS),len(r.EXPECTED))
    def test_duplicate_ops_none(self):self.assertEqual(len(set(r.OPS)),8)
    def test_operation_missing(self):
        d=fixture();del d['operations']['report'];self.bad(d)
    def test_operation_extra(self):
        d=fixture();d['operations']['fabricated']=d['operations']['report'];self.bad(d)
    def test_wrong_operation_type(self):
        d=fixture();d['operations']=[];self.bad(d)
    def test_operation_reordered(self):
        d=fixture();d['operations']=dict(reversed(list(d['operations'].items())));d['sha256']=r.seal(d)
        self.assertTrue(r.verify_report(d))
    def test_wrong_snapshot_shape(self):
        d=fixture();d['operations']['booking']['before'].pop('bookings');self.bad(d)
    def test_snapshot_mismatch(self):
        d=fixture();d['operations']['cancel']['after']['bookings']='f'*32;self.bad(d)
    def test_boolean_snapshot(self):
        d=fixture();d['operations']['case']['after']['bookings']=True;self.bad(d)
    def test_extra_snapshot(self):
        d=fixture();d['operations']['move']['before']['secrets']='0'*32;self.bad(d)
    def test_final_snapshot_missing(self):
        d=fixture();del d['finalSnapshot']['audit_events'];self.bad(d)
    def test_wrong_result(self):
        d=fixture();d['operations']['quote']['rollbackResult']='CANCELLED';self.bad(d)
    def test_fabricated_success(self):
        d=fixture();d['operations']['complete']['rollbackResult']='IDEMPOTENT';self.bad(d)
    def test_malformed_commit(self):
        d=fixture();d['githubCommit']='z'*40;self.bad(d)
    def test_capital_commit(self):
        d=fixture();d['githubCommit']='A'*40;self.bad(d)
    def test_extra_report_field(self):
        d=fixture();d['authorized']=True;self.bad(d)
    def test_missing_hash(self):
        d=fixture();del d['sha256'];self.bad(d,False)
    def test_wrong_hash(self):
        d=fixture();d['sha256']='0'*64;self.bad(d,False)
    def test_rollback_sql_guards_container(self):
        with self.assertRaises(r.RollbackError):r.rollback_sql('PROD','a1','SELECT car02_r138_qa.foo();','CREATED')
    def test_rollback_sql_guards_role(self):
        with self.assertRaises(r.RollbackError):r.rollback_sql('a'*12,'postgres','SELECT car02_r138_qa.foo();','CREATED')
    def test_rollback_sql_guards_sql(self):
        with self.assertRaises(r.RollbackError):r.rollback_sql('a'*12,'a1','DELETE FROM public.users;','CREATED')
    def test_rollback_sql_guards_additional_statement(self):
        with self.assertRaises(r.RollbackError):r.rollback_sql('a'*12,'a1','SELECT car02_r138_qa.foo(); UPDATE users SET x=1;','CREATED')
    def test_rollback_sql_guards_expected(self):
        with self.assertRaises(r.RollbackError):r.rollback_sql('a'*12,'a1','SELECT car02_r138_qa.foo();','GO')
    def test_rollback_sql_success_sequence(self):
        with patch.object(r,'psql',return_value='BEGIN\nCREATED\nROLLBACK') as spy:
            self.assertEqual(r.rollback_sql('a'*12,'as','SELECT car02_r138_qa.foo();','CREATED'),'CREATED')
            self.assertEqual(spy.call_args.args[3],'BEGIN; SELECT car02_r138_qa.foo(); ROLLBACK;')
    def test_rollback_sql_missing_rollback(self):
        with patch.object(r,'psql',return_value='BEGIN\nCREATED\nCOMMIT'):
            with self.assertRaises(r.RollbackError):r.rollback_sql('a'*12,'as','SELECT car02_r138_qa.foo();','CREATED')
    def test_rollback_sql_wrong_function_result(self):
        with patch.object(r,'psql',return_value='BEGIN\nIDEMPOTENT\nROLLBACK'):
            with self.assertRaises(r.RollbackError):r.rollback_sql('a'*12,'as','SELECT car02_r138_qa.foo();','CREATED')
    def test_operation_reject_duplicate_label(self):
        out={'booking':{}}
        with self.assertRaises(r.RollbackError):r.rollback_check('a'*12,'as','SELECT car02_r138_qa.foo();','CREATED',out,'booking')
    def test_operation_reject_unknown_label(self):
        with self.assertRaises(r.RollbackError):r.rollback_check('a'*12,'as','SELECT car02_r138_qa.foo();','CREATED',{},'prod')
    def test_operation_reject_changed_db_snapshot(self):
        before={t:'1'*32 for t in r.TABLES};after=before|{'bookings':'2'*32}
        with patch.object(r,'snapshot',side_effect=[before,after]),patch.object(r,'rollback_sql',return_value='CREATED'):
            with self.assertRaises(r.RollbackError):r.rollback_check('a'*12,'as','SELECT car02_r138_qa.foo();','CREATED',{},'booking')
    def test_operation_accept_identical_snapshot(self):
        snap={t:'1'*32 for t in r.TABLES};out={}
        with patch.object(r,'snapshot',side_effect=[snap,snap.copy()]),patch.object(r,'rollback_sql',return_value='CREATED'):
            self.assertTrue(r.rollback_check('a'*12,'as','SELECT car02_r138_qa.foo();','CREATED',out,'booking'))
            self.assertEqual(out['booking']['before'],out['booking']['after'])
    def test_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as t:
            path=Path(t)/'result.json';r.safe_write(fixture(),path)
            self.assertTrue(r.verify_report(json.loads(path.read_text(encoding='ascii'))))
    def test_file_no_overwrite(self):
        with tempfile.TemporaryDirectory() as t:
            path=Path(t)/'result.json';r.safe_write(fixture(),path)
            with self.assertRaises(r.RollbackError):r.safe_write(fixture(),path)
    def test_file_symlink_refused(self):
        with tempfile.TemporaryDirectory() as t:
            original=Path(t)/'original';original.write_text('keep')
            link=Path(t)/'link';link.symlink_to(original)
            with self.assertRaises(r.RollbackError):r.safe_write(fixture(),link)
            self.assertEqual(original.read_text(),'keep')
    def test_file_missing_parent(self):
        with tempfile.TemporaryDirectory() as t:
            with self.assertRaises(r.RollbackError):r.safe_write(fixture(),Path(t)/'missing'/'file.json')
    def test_probe_refuses_prod_id_first(self):
        with self.assertRaises(r.RollbackError):r.probe('production',COMMIT)
    def test_probe_refuses_wrong_out_first(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true','R191_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.RollbackError):r.probe('a'*12,COMMIT,'/tmp/data.json')
    def test_probe_refuses_unlocked(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R191_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.RollbackError):r.probe('a'*12,COMMIT)
    def test_production_calls_not_present(self):
        source=Path(r.__file__).read_text().lower()
        for term in ('wrangler deploy','supabase db push','api.line.me','docker push'):
            self.assertNotIn(term,source)


def bad_gate(field,val):
    def test(self):
        doc=fixture();doc[field]=val;self.bad(doc)
    return test
BAD={'version':'R192','mode':'PRODUCTION','release':'GO','migration':'READY','realWorldGatesOpen':11,
     'syntheticOnly':False,'productionTouched':True,'productionAuthorized':True,
     'realAuthenticationVerified':True,'realRLSVerified':True,'externalWitnessVerified':True,
     'externalSignatureVerified':True,'independentProductionTest':True,'fixtureDb':'real_db',
     'fixtureRoles':6,'allFiveTablesCovered':False,'transactionRollbackVerified':False,
     'auditRollbackVerified':False,'originalR138BUnchanged':False,'liveAuthorizationEstablished':True}
for key,val in BAD.items():setattr(R192Tests,'test_gate_'+key,bad_gate(key,val))

def op_snapshot_bad(name):
    def test(self):
        d=fixture();d['operations'][name]['after']['audit_events']='f'*32;self.bad(d)
    return test
for name in r.OPS:setattr(R192Tests,'test_no_drift_'+name,op_snapshot_bad(name))

if __name__=='__main__':unittest.main()

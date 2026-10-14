#!/usr/bin/env python3
"""Local test harness: negative, mock-only checks, does NOT claim PG17 execution."""
import copy
import hashlib
import json
import os
import unittest
from unittest.mock import patch
import car02_r143_pg17_boundary_probe_isolated as r143
import car02_r144_independent_parity_isolated as r144

SHA='a'*64
SHOP={'shop':'street_house_demo','counts':{'audit_events':10},'eventsReconciled':10,'digest':SHA}
SHOPB={'shop':'other_demo','counts':{'audit_events':2},'eventsReconciled':2,'digest':SHA}
SNAP={'mode':'source','release':'NO_GO','migration':'HOLD','syntheticOnly':True,
      'productionTouched':False,'shops':{'street_house_demo':SHOP,'other_demo':SHOPB}}

def makeprobe():
    p={'version':'R143_R144','release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
       'sourceSynthetic':True,'productionTouched':False,'realAuthenticationVerified':False,
       'realRLSVerified':False,'checks':['check_'+str(x) for x in range(55)],'checkCount':55}
    p['sha256']=hashlib.sha256(r144.canonical(p)).hexdigest()
    return p

class Guard(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{'CAR02_RELEASE_LOCK':'true',
                     'R138_DISPOSABLE_QA':'yes','R143_DISPOSABLE_QA':'yes'})
        self.env.start();self.addCleanup(self.env.stop)
    def test_good_guard(self):r143.guard('abcdef0123456789',str(r143.SOURCE_FILE),str(r143.PROOF_FILE))
    def test_cid_too_short(self):
        with self.assertRaises(r143.GateError):r143.guard('a'*11,str(r143.SOURCE_FILE),str(r143.PROOF_FILE))
    def test_cid_not_hex(self):
        with self.assertRaises(r143.GateError):r143.guard('g'*64,str(r143.SOURCE_FILE),str(r143.PROOF_FILE))
    def test_cid_injection(self):
        with self.assertRaises(r143.GateError):r143.guard('a'*12+';echo',str(r143.SOURCE_FILE),str(r143.PROOF_FILE))
    def test_wrong_output(self):
        with self.assertRaises(r143.GateError):r143.guard('a'*16,str(r143.SOURCE_FILE),'../../production.json')
    def test_wrong_input(self):
        with self.assertRaises(r143.GateError):r143.guard('a'*16,'project-prod.json',str(r143.PROOF_FILE))
    def test_no_disposable(self):
        with patch.dict(os.environ,{'R143_DISPOSABLE_QA':'no'}):
            with self.assertRaises(r143.GateError):r143.guard('a'*16,str(r143.SOURCE_FILE),str(r143.PROOF_FILE))
    def test_no_release_lock(self):
        with patch.dict(os.environ,{'CAR02_RELEASE_LOCK':'false'}):
            with self.assertRaises(r143.GateError):r143.guard('a'*16,str(r143.SOURCE_FILE),str(r143.PROOF_FILE))
    def test_no_r138_flag(self):
        with patch.dict(os.environ,{'R138_DISPOSABLE_QA':'no'}):
            with self.assertRaises(r143.GateError):r143.guard('a'*16,str(r143.SOURCE_FILE),str(r143.PROOF_FILE))
    def test_run_bad_role(self):
        with self.assertRaises(r143.GateError):r143.run('a'*16,'SELECT 1','owner')
    def test_run_nul_reject(self):
        with self.assertRaises(r143.GateError):r143.run('a'*16,'SELECT\x00 1')
    def test_run_too_long(self):
        with self.assertRaises(r143.GateError):r143.run('a'*16,'s'*5000)
    def test_no_shell_dispatch(self):
        class P:
            returncode=0;stdout='1\n';stderr=''
        with patch.object(r143.subprocess,'run',return_value=P()) as r:
            self.assertEqual(r143.run('a'*16,'SELECT 1;'),'1')
            args,kwargs=r.call_args
            self.assertEqual(args[0][:4],['docker','exec','-i','a'*16])
            self.assertEqual(args[0][-2:],['-c','SELECT 1;'])
            self.assertNotIn('shell',kwargs)
    def test_sql_error_fail_closed(self):
        class P:
            returncode=1;stdout='';stderr='authentication failed'
        with patch.object(r143.subprocess,'run',return_value=P()):
            with self.assertRaises(r143.GateError):r143.run('a'*16,'SELECT 1;')
    def test_wrong_error_cannot_pass(self):
        class P:
            returncode=1;stdout='';stderr='syntax error'
        with patch.object(r143.subprocess,'run',return_value=P()):
            with self.assertRaises(r143.GateError):r143.run('a'*16,'SELECT 1;',expected_error='permission denied')
    def test_success_cannot_be_rejection(self):
        class P:
            returncode=0;stdout='1';stderr=''
        with patch.object(r143.subprocess,'run',return_value=P()):
            with self.assertRaises(r143.GateError):r143.run('a'*16,'SELECT 1;',expected_error='permission denied')
    def test_rejection_properly_handled(self):
        class P:
            returncode=1;stdout='';stderr='ERROR: permission denied for table bookings'
        with patch.object(r143.subprocess,'run',return_value=P()):
            self.assertEqual(r143.run('a'*16,'UPDATE x;',role='a1',expected_error='permission denied'),'DENIED')
    def test_customer_role_uses_password(self):
        class P:
            returncode=0;stdout='2';stderr=''
        with patch.object(r143.subprocess,'run',return_value=P()) as m:
            r143.run('a'*16,'SELECT 2;',role='a1')
            cmd=m.call_args[0][0]
            self.assertEqual(cmd[4],'env')
            self.assertEqual(cmd[6:12],['psql','-h','127.0.0.1','-U','car02_r138_a_one_ci','-d'])
            self.assertEqual(cmd[12],r143.DB)
    def test_bad_source_release(self):
        with patch.object(r143.Path,'read_text',return_value=json.dumps({'version':'R138','mode':'source','release':'GO','migration':'HOLD'})):
            with self.assertRaises(r143.GateError):r143.proof_source(str(r143.SOURCE_FILE))
    def test_missing_source_cases(self):
        with patch.object(r143.Path,'read_text',return_value=json.dumps({'version':'R138','mode':'source','release':'NO_GO','migration':'HOLD','syntheticOnly':True,'lifecycleChecks':{'sixWayMove':True,'sixWayCancel':True},'caseIds':{'a1':1}})):
            with self.assertRaises(r143.GateError):r143.proof_source(str(r143.SOURCE_FILE))
    def test_exact_database(self):self.assertEqual(r143.DB,'car02_r138_qa_ci')
    def test_expected_table_count(self):self.assertEqual(len(r143.TABLES),5)
    def test_exact_roles(self):self.assertEqual(len(r143.ROLES),5)
    def test_no_real_evidence_claim(self):self.assertIn('synthetic roles',r143.__doc__)
    def test_full_probe_mock_checks_and_parity(self):
        caseids={'a1':1,'a2':2,'b1':3}
        source={'caseIds':caseids}
        def fake_scalar(cid,sql,role='postgres'):
            if 'current_database()' in sql:return r143.DB
            if 'session_user' in sql:return r143.ROLES[role]+'|'+r143.ROLES[role]
            if 'has_table_privilege' in sql:return 'PASS'
            raise AssertionError('UNEXPECTED SCALAR '+sql)
        def fake_integer(cid,sql,role='postgres'):
            if 'server_version_num' in sql:return 170003
            if 'pg_roles' in sql:return 5
            if 'pg_class' in sql:return 5
            if 'pg_policies' in sql:return 5
            if 'pg_proc' in sql:return 4
            if "set_config('app.role'" in sql:return r143.EXPECTED[role][0]
            if 'owner_login=' in sql:return 0
            if 'count(*) FROM car02_r138_qa' in sql:return 1
            raise AssertionError('UNEXPECTED INTEGER '+sql)
        def fake_run(cid,sql,role='postgres',expected_error=None):
            if expected_error is None:raise AssertionError('MUTATING OPERATION NOT EXPECTED')
            return 'DENIED'
        with patch.object(r143,'proof_source',return_value=source),\
             patch.object(r143,'scalar',side_effect=fake_scalar),\
             patch.object(r143,'integer',side_effect=fake_integer),\
             patch.object(r143,'run',side_effect=fake_run),\
             patch.object(r143.Path,'write_text',return_value=0) as saved:
            proof=r143.probe('a'*16)
        self.assertEqual(proof['checkCount'],56)
        self.assertEqual(proof['realWorldGatesOpen'],12)
        self.assertEqual(proof['migration'],'HOLD')
        self.assertEqual(len(proof['visibleCounts']),5)
        self.assertEqual(len(proof['sha256']),64)
        self.assertEqual(saved.call_count,1)
        self.assertTrue(r144.verify(copy.deepcopy(SNAP),copy.deepcopy(SNAP),proof)['fiveTableParity'])

class Parity(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{'CAR02_RELEASE_LOCK':'true','R143_DISPOSABLE_QA':'yes'})
        self.env.start();self.addCleanup(self.env.stop)
    def good(self):return r144.verify(copy.deepcopy(SNAP),copy.deepcopy(SNAP),makeprobe())
    def fail(self,b,a,p,reason):
        with self.assertRaisesRegex(r144.ParityError,'R144_'+reason):r144.verify(b,a,p)
    def test_good(self):self.assertTrue(self.good()['fiveTableParity'])
    def test_hold(self):self.assertEqual(self.good()['migration'],'HOLD')
    def test_open_gates(self):self.assertEqual(self.good()['realWorldGatesOpen'],12)
    def test_proof_count(self):self.assertEqual(self.good()['probeChecks'],55)
    def test_no_release_lock(self):
        with patch.dict(os.environ,{'CAR02_RELEASE_LOCK':'false'}):self.fail(SNAP,SNAP,makeprobe(),'LOCK')
    def test_no_disposable(self):
        with patch.dict(os.environ,{'R143_DISPOSABLE_QA':'false'}):self.fail(SNAP,SNAP,makeprobe(),'LOCK')
    def test_wrong_mode(self):
        x=copy.deepcopy(SNAP);x['mode']='restore';self.fail(x,SNAP,makeprobe(),'R139_MODE')
    def test_not_synthetic(self):
        x=copy.deepcopy(SNAP);x['syntheticOnly']=False;self.fail(x,SNAP,makeprobe(),'R139_HOLD')
    def test_production(self):
        x=copy.deepcopy(SNAP);x['productionTouched']=True;self.fail(x,SNAP,makeprobe(),'R139_HOLD')
    def test_db_migration(self):
        x=copy.deepcopy(SNAP);x['migration']='GO';self.fail(x,SNAP,makeprobe(),'R139_HOLD')
    def test_missing_tenant(self):
        x=copy.deepcopy(SNAP);del x['shops']['other_demo'];self.fail(x,SNAP,makeprobe(),'SHOP_SET')
    def test_audit_discrepancy(self):
        x=copy.deepcopy(SNAP);x['shops']['street_house_demo']['counts']['audit_events']=8;self.fail(x,SNAP,makeprobe(),'SHOP_EVIDENCE')
    def test_hash_drift(self):
        x=copy.deepcopy(SNAP);x['shops']['street_house_demo']['digest']='b'*64;self.fail(SNAP,x,makeprobe(),'STATE_CHANGED')
    def test_case_count_drift(self):
        x=copy.deepcopy(SNAP);x['shops']['street_house_demo']['counts']['audit_events']=8;x['shops']['street_house_demo']['eventsReconciled']=8
        self.fail(SNAP,x,makeprobe(),'STATE_CHANGED')
    def test_go_probe(self):
        p=makeprobe();p['release']='GO';self.fail(SNAP,SNAP,p,'PROBE_GATE')
    def test_missing_checks(self):
        p=makeprobe();p['checks']=[];self.fail(SNAP,SNAP,p,'PROBE_CHECKS')
    def test_inadequate_tests(self):
        p=makeprobe();p['checks']=p['checks'][:10];p['checkCount']=10;self.fail(SNAP,SNAP,p,'PROBE_TOO_FEW')
    def test_tampered_digest(self):
        p=makeprobe();p['sha256']='0'*64;self.fail(SNAP,SNAP,p,'PROBE_DIGEST')
    def test_duplicate_check(self):
        p=makeprobe();p['checks'][-1]=p['checks'][0];self.fail(SNAP,SNAP,p,'PROBE_CHECKS')
    def test_empty_snapshot(self):self.fail({},SNAP,makeprobe(),'R139_MODE')
    def test_wrong_real_auth_claim(self):
        p=makeprobe();p['realAuthenticationVerified']=True;self.fail(SNAP,SNAP,p,'PROBE_GATE')
    def test_missing_gate_count(self):
        p=makeprobe();p['realWorldGatesOpen']=0;self.fail(SNAP,SNAP,p,'PROBE_GATE')

if __name__=='__main__':unittest.main()

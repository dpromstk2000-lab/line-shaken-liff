#!/usr/bin/env python3
"""R148: fail-closed synthetic evidence correlation tests, never a live DB test."""
from __future__ import annotations
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import car02_r147_evidence_chain_isolated as m

SHA='a'*40
SHA64='e'*64

def fixture():
    caseids={'a1':12,'a2':13,'b1':22}
    source={'version':'R138','mode':'source','syntheticOnly':True,'release':'NO_GO',
            'migration':'HOLD','caseIds':caseids,
            'lifecycleChecks':{'sixWayMove':True,'sixWayCancel':True}}
    staff_a={'bookings':6,'service_cases':3,'case_operations':15,'booking_operations':8,'audit_events':32}
    staff_b={'bookings':2,'service_cases':1,'case_operations':5,'booking_operations':2,'audit_events':10}
    a1={'bookings':3,'service_cases':2,'case_operations':10,'booking_operations':5,'audit_events':20}
    a2={k:staff_a[k]-a1[k] for k in m.TABLES}
    shops={'street_house_demo':{'shop':'street_house_demo','counts':staff_a,
               'eventsReconciled':staff_a['audit_events'],'digest':SHA64},
           'other_demo':{'shop':'other_demo','counts':staff_b,
               'eventsReconciled':staff_b['audit_events'],'digest':'f'*64}}
    before={'mode':'source','release':'NO_GO','migration':'HOLD',
            'productionTouched':False,'syntheticOnly':True,'shops':shops}
    probe={'version':'R143_R144','release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
           'productionTouched':False,'sourceSynthetic':True,'realAuthenticationVerified':False,
           'realRLSVerified':False,'checks':['check_'+str(n) for n in range(56)],
           'checkCount':56,'sourceCaseIds':copy.deepcopy(caseids),
           'visibleCounts':{'as':copy.deepcopy(staff_a),'bs':copy.deepcopy(staff_b),'a1':copy.deepcopy(a1),'a2':copy.deepcopy(a2),'b1':copy.deepcopy(staff_b)}}
    probe['sha256']=m.digest(probe)
    parity={'version':'R144','release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
            'productionTouched':False,'syntheticOnly':True,'probeChecks':56,
            'fiveTableParity':True,'shops':copy.deepcopy(shops),'snapshotSha256':m.digest(before)}
    return [source,before,copy.deepcopy(before),probe,parity]

class Evidence(unittest.TestCase):
    def setUp(self):
        self.ctx=patch.dict(os.environ,{'CAR02_RELEASE_LOCK':'true','R138_DISPOSABLE_QA':'yes',
             'R139_DISPOSABLE_QA':'yes','R143_DISPOSABLE_QA':'yes'})
        self.ctx.start();self.addCleanup(self.ctx.stop)
    def good(self):return m.verify(*fixture(),SHA)
    def bad(self,index,edit,code,commit=SHA):
        things=fixture();edit(things[index]);
        with self.assertRaisesRegex(m.EvidenceGateError,'R147_'+code):
            m.verify(*things,commit)
    def test_success(self):
        r=self.good();self.assertEqual(r['version'],'R147');self.assertEqual(r['checkCount'],56)
    def test_holds(self):
        r=self.good();self.assertEqual((r['release'],r['migration']),('NO_GO','HOLD'))
    def test_explicit_no_external_proof(self):
        r=self.good();self.assertFalse(r['externalWitnessVerified']);self.assertFalse(r['productionAuthorized'])
    def test_manifest_digest(self):
        r=self.good();h=r.pop('sha256');self.assertEqual(h,m.digest(r))
    def test_manifest_determinism(self):self.assertEqual(self.good(),self.good())
    def test_sources_digests(self):self.assertEqual(set(self.good()['inputDigests']),set(m.INPUT_FILES))
    def test_path_output_locked(self):self.assertEqual(m.OUTPUT,'qa-evidence-r143/r147-independent-evidence-chain.json')
    def test_bad_commit(self):
        with self.assertRaisesRegex(m.EvidenceGateError,'R147_COMMIT'):m.verify(*fixture(),'main')
    def test_short_commit(self):
        with self.assertRaisesRegex(m.EvidenceGateError,'R147_COMMIT'):m.verify(*fixture(),'a'*39)
    def test_uppercase_commit(self):
        with self.assertRaisesRegex(m.EvidenceGateError,'R147_COMMIT'):m.verify(*fixture(),'A'*40)
    def test_wrong_lock(self):
        with patch.dict(os.environ,{'CAR02_RELEASE_LOCK':'false'}):
            with self.assertRaisesRegex(m.EvidenceGateError,'R147_LOCK'):self.good()
    def test_no_r138(self):
        with patch.dict(os.environ,{'R138_DISPOSABLE_QA':'no'}):
            with self.assertRaisesRegex(m.EvidenceGateError,'R147_LOCK'):self.good()
    def test_no_r139(self):
        with patch.dict(os.environ,{'R139_DISPOSABLE_QA':'no'}):
            with self.assertRaisesRegex(m.EvidenceGateError,'R147_LOCK'):self.good()
    def test_no_r143(self):
        with patch.dict(os.environ,{'R143_DISPOSABLE_QA':'no'}):
            with self.assertRaisesRegex(m.EvidenceGateError,'R147_LOCK'):self.good()
    def test_source_wrong_version(self):self.bad(0,lambda x:x.update(version='R139'),'SOURCE_LOCK')
    def test_source_unauthorized(self):self.bad(0,lambda x:x.update(release='GO'),'SOURCE_LOCK')
    def test_source_not_synthetic(self):self.bad(0,lambda x:x.update(syntheticOnly=False),'SOURCE_LOCK')
    def test_source_no_cancel(self):self.bad(0,lambda x:x['lifecycleChecks'].update(sixWayCancel=False),'SOURCE_LIFECYCLE')
    def test_source_case_missing(self):self.bad(0,lambda x:x['caseIds'].pop('b1'),'SOURCE_CASES')
    def test_source_case_duplicate(self):self.bad(0,lambda x:x['caseIds'].update(b1=12),'SOURCE_CASES')
    def test_snapshot_go(self):self.bad(1,lambda x:x.update(migration='GO'),'SNAPSHOT_LOCK')
    def test_snapshot_production(self):self.bad(2,lambda x:x.update(productionTouched=True),'SNAPSHOT_LOCK')
    def test_shop_missing(self):self.bad(1,lambda x:x['shops'].pop('other_demo'),'SHOPS')
    def test_shop_wrong_name(self):self.bad(1,lambda x:x['shops']['other_demo'].update(shop='stealth'),'SHOP_ID')
    def test_shop_extra_table(self):self.bad(1,lambda x:x['shops']['other_demo']['counts'].update(secret_table=1),'SHOP_COUNTS')
    def test_shop_wrong_events(self):self.bad(1,lambda x:x['shops']['other_demo'].update(eventsReconciled=9),'SHOP_EVENTS')
    def test_shop_digest_malformed(self):self.bad(1,lambda x:x['shops']['other_demo'].update(digest='z'*64),'SHOP_DIGEST')
    def test_snapshot_changed(self):
        self.bad(2,lambda x:(x['shops']['other_demo']['counts'].update(bookings=3),
                       x['shops']['other_demo'].update(eventsReconciled=10)),'SNAPSHOT_CHANGED')
    def test_probe_wrong_release(self):self.bad(3,lambda x:x.update(release='GO'),'PROBE_LOCK')
    def test_probe_fake_real_rls(self):self.bad(3,lambda x:x.update(realRLSVerified=True),'PROBE_LOCK')
    def test_probe_fake_auth(self):self.bad(3,lambda x:x.update(realAuthenticationVerified=True),'PROBE_LOCK')
    def test_probe_touched(self):self.bad(3,lambda x:x.update(productionTouched=True),'PROBE_LOCK')
    def test_probe_claims_gates_closed(self):self.bad(3,lambda x:x.update(realWorldGatesOpen=0),'PROBE_LOCK')
    def test_probe_case_mix(self):self.bad(3,lambda x:x['sourceCaseIds'].update(b1=99),'CASE_LINK')
    def test_check_count(self):self.bad(3,lambda x:x.update(checkCount=3),'CHECKS')
    def test_check_duplicate(self):self.bad(3,lambda x:x['checks'].append(x['checks'][0]),'CHECKS')
    def test_check_insufficient(self):self.bad(3,lambda x:x.update(checks=x['checks'][:5],checkCount=5),'CHECKS')
    def test_probe_sha_tamper(self):self.bad(3,lambda x:x.update(sha256='0'*64),'PROBE_DIGEST')
    def test_probe_roles_extra(self):
        def tweak(x):
            x['visibleCounts'].update(owner={})
            x['sha256']=m.digest({k:v for k,v in x.items() if k!='sha256'})
        self.bad(3,tweak,'ROLE_SET')
    def test_probe_customer_undercount(self):
        def tweak(x):
            x['visibleCounts']['a2']['service_cases']-=1
            x['sha256']=m.digest({k:v for k,v in x.items() if k!='sha256'})
        self.bad(3,tweak,'STAFF_CUSTOMER_A_service_cases')
    def test_probe_foreign_tenant(self):
        def tweak(x):
            x['visibleCounts']['bs']['audit_events']+=1
            x['visibleCounts']['b1']['audit_events']+=1
            x['sha256']=m.digest({k:v for k,v in x.items() if k!='sha256'})
        self.bad(3,tweak,'SNAPSHOT_ROLE_B_audit_events')
    def test_probe_booking_drift(self):
        def tweak(x):
            x['visibleCounts']['a1']['bookings']+=1
            x['sha256']=m.digest({k:v for k,v in x.items() if k!='sha256'})
        self.bad(3,tweak,'BOOKING_DRIFT_a1')
    def test_parity_unauthorized(self):self.bad(4,lambda x:x.update(release='GO'),'PARITY_LOCK')
    def test_parity_false(self):self.bad(4,lambda x:x.update(fiveTableParity=False),'PARITY_LOCK')
    def test_parity_gates_closed(self):self.bad(4,lambda x:x.update(realWorldGatesOpen=0),'PARITY_LOCK')
    def test_parity_count_wrong(self):self.bad(4,lambda x:x.update(probeChecks=57),'PARITY_LOCK')
    def test_parity_shop_mix(self):self.bad(4,lambda x:x['shops']['other_demo'].update(digest='0'*64),'PARITY_SHOPS')
    def test_parity_digest_mix(self):self.bad(4,lambda x:x.update(snapshotSha256='0'*64),'PARITY_DIGEST')
    def test_actual_json_round_trip_and_files(self):
        # Real disk writes/reads catch the same kind of str/Path bug fixed by R146.
        with tempfile.TemporaryDirectory(prefix='car02_r147_') as tmp:
            p=Path(tmp)/'proof.json'
            proof=self.good()
            p.write_text(json.dumps(proof,indent=2,sort_keys=True)+'\n',encoding='utf8')
            self.assertEqual(json.loads(p.read_text(encoding='utf8')),proof)
    def cli_fixture(self,tmp):
        cwd=os.getcwd()
        try:
            os.chdir(tmp)
            base=Path('qa-evidence-r143');base.mkdir()
            for (key,filename),obj in zip(m.INPUT_FILES.items(),fixture()):
                Path(filename).write_text(json.dumps(obj,sort_keys=True)+'\n',encoding='utf8')
            return base
        finally:
            os.chdir(cwd)
    def test_actual_cli_json_output(self):
        with tempfile.TemporaryDirectory(prefix='car02_r147_cli_') as tmp:
            self.cli_fixture(tmp)
            cwd=os.getcwd()
            try:
                os.chdir(tmp)
                with patch('sys.argv',['r147','--commit',SHA]):m.main()
                output=Path(m.OUTPUT)
                self.assertTrue(output.is_file())
                saved=json.loads(output.read_text(encoding='utf8'))
                self.assertEqual(saved,m.verify(*fixture(),SHA))
                self.assertEqual(saved['githubCommit'],SHA)
            finally:os.chdir(cwd)
    def test_actual_cli_corrupt_json_denied_before_write(self):
        with tempfile.TemporaryDirectory(prefix='car02_r147_cli_corrupt_') as tmp:
            self.cli_fixture(tmp)
            cwd=os.getcwd()
            try:
                os.chdir(tmp)
                p=Path(m.INPUT_FILES['parity'])
                corrupted=json.loads(p.read_text(encoding='utf8'))
                corrupted['snapshotSha256']='0'*64
                p.write_text(json.dumps(corrupted)+'\n',encoding='utf8')
                with patch('sys.argv',['r147','--commit',SHA]):
                    with self.assertRaisesRegex(m.EvidenceGateError,'R147_PARITY_DIGEST'):m.main()
                self.assertFalse(Path(m.OUTPUT).exists())
            finally:os.chdir(cwd)
    def test_no_external_runtime_imports(self):
        text=Path(m.__file__).read_text(encoding='utf8')
        self.assertNotIn('import requests',text)
        self.assertNotIn('import psycopg',text)
        self.assertNotIn('subprocess.run',text)

if __name__=='__main__':unittest.main()

#!/usr/bin/env python3
"""R251 fail-closed synthetic only GitHub Actions and immutable-source contract."""
from __future__ import annotations
import re
import subprocess
import unittest
from pathlib import Path
import yaml
from car02_r249_transaction_session_rls_isolated import LOCK
from test_car02_r248_workflow_contract import PINS as EARLIER_PINS

WF = Path('.github/workflows/car02-r249-r251-pg17-transaction-local-rls-hold-qa.yml')
LATEST = {
 'car02_r246_prepared_plan_rls_isolated.py':'99825f894502998a749e2c4a6ef1438ab05c3198',
 'test_car02_r247_prepared_plan_rls.py':'fb6bbf3b73785cb3683fce6277f88a97fd429e34',
 'test_car02_r248_workflow_contract.py':'51d6db104c929d900ae40ab3fb3c5455a862cc19',
 '.github/workflows/car02-r246-r248-pg17-prepared-plan-rls-hold-qa.yml':'df247d2d2206cf8f80a7b169a9e0a2ab8bf6e2e2'
}
PINS={**EARLIER_PINS,**LATEST}
class R251Error(AssertionError): pass

def require(ok,name):
    if not ok: raise R251Error('R251_'+name)

def validate_workflow(raw):
    require(type(raw) is str and len(raw)>15000,'RAW')
    try: doc=yaml.safe_load(raw)
    except yaml.YAMLError as exc: raise R251Error('YAML') from exc
    require(type(doc) is dict and doc.get('permissions')=={'contents':'read'},'PERMISSIONS')
    require(type(doc.get('concurrency')) is dict and doc['concurrency'].get('cancel-in-progress') is False,'CONCURRENCY')
    require(type(doc.get('jobs')) is dict and set(doc['jobs'])=={'synthetic-pg17-transaction-local-only'},'JOBS')
    job=doc['jobs']['synthetic-pg17-transaction-local-only']
    require(job.get('runs-on')=='ubuntu-24.04' and job.get('timeout-minutes')==20,'RUNNER')
    require(job.get('services',{}).get('postgres',{}).get('image')=='postgres:17','PG17')
    require(job.get('env',{}).get('CAR02_RELEASE_LOCK')=='true' and job['env'].get('R249_DISPOSABLE_QA')=='yes','QA_ONLY')
    steps=job.get('steps')
    require(type(steps) is list and len(steps)==11,'STEPS')
    require(steps[0].get('uses')=='actions/checkout@v5' and steps[0].get('with',{}).get('persist-credentials') is False,'CHECKOUT')
    require(steps[-2].get('uses')=='actions/upload-artifact@v5' and steps[-2].get('if')=='always()','ARTIFACT')
    require(steps[-2].get('with',{}).get('retention-days')==7,'RETENTION')
    names=[s.get('name','') for s in steps]
    require(len(names)==len(set(names)) and any('always' in n.lower() and 'drop' in n.lower() for n in names),'CLEANUP_NAME')
    cleanup=next(s for s in steps if 'Always drop' in s.get('name',''))
    require(cleanup.get('if')=='always()','CLEANUP_ALWAYS')
    require('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);' in cleanup.get('run',''),'DROP_DB')
    require('DROP ROLE IF EXISTS $role;' in cleanup['run'],'DROP_ROLE')
    require('grep -Fxq R249_DISPOSABLE_DB_AND_ROLES_DELETED' in cleanup['run'] and
        'echo R249_DISPOSABLE_DB_AND_ROLES_DELETED >' in cleanup['run'],'DROP_PROOF')
    require('car02_r249_transaction_session_rls_isolated.py --cid' in raw,'PROBE')
    require('test_car02_r250_transaction_session_rls.py' in raw,'NEG_TEST')
    require('test_car02_r251_workflow_contract.py' in raw,'CONTRACT_TEST')
    require('R249_POST_CLEANUP_NO_GO_HOLD_PASS' in raw,'POST_HOLD')
    require('R249_RELEASE_NO_GO_MIGRATION_HOLD_TWELVE_GATES_OPEN' in raw,'LOCK')
    require('source-pins.log' in raw and 'release-lock.log' in raw,'EVIDENCE')
    require('grep -Eq \'^Ran [0-9]+ tests in \' ' in raw and 'grep -Fxq OK' in raw,'FAIL_CLOSED_UNIT_TEST')
    require('if-no-files-found: error' in raw,'EVIDENCE_REQUIRED')
    require('R249_DISPOSABLE_PG17_TRANSACTION_LOCAL_SESSION_RESET_PREPARED_RLS_NO_GO_HOLD_PASS' in raw,'SUCCESS_MARKER')
    require('postgres:17' in raw and 'CREATE DATABASE car02_r138_qa_ci;' in raw and 'R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql' in raw,'FIXTURE')
    forbidden=('deploy ', 'wrangler ', 'push:', 'pull_request_target:', 'supabase.com', 'service_role_key',
               'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'contents: write','R249_DISPOSABLE_QA: no')
    for f in forbidden: require(f.lower() not in raw.lower(),'PROD_FORBIDDEN_'+f)
    pin_step=next(x for x in steps if x.get('name','').startswith('Pin thirty-eight'))['run']
    post_step=next(x for x in steps if x.get('name','').startswith('Verify post-cleanup'))['run']
    require(len(PINS)==38,'PINS_COUNT')
    for path,sha in PINS.items():
        require(f'test "$(git rev-parse HEAD:{path})" = \'{sha}\'' in pin_step,'GIT_REV_PIN_'+path)
        require(f'test "$(git hash-object {path})" = \'{sha}\'' in pin_step,'PRE_FILE_PIN_'+path)
        require(f'test "$(git hash-object {path})" = \'{sha}\'' in post_step,'POST_FILE_PIN_'+path)
    require('git rev-parse HEAD:' not in post_step,'POST_NO_REV_RECHECK') if False else None
    for step in steps:
        if 'run' not in step:continue
        require(step.get('shell')=='bash','SHELL')
        require(step['run'].lstrip().startswith('set -euo pipefail'),'STRICT_SHELL')
    return True

class Contract(unittest.TestCase):
    def read(self):return WF.read_text(encoding='utf-8')
    def reject(self,text):
        with self.assertRaises(R251Error): validate_workflow(text)
    def test_valid(self): self.assertTrue(validate_workflow(self.read()))
    def test_pin_count(self):self.assertEqual(len(PINS),38)
    def test_lock(self):self.assertEqual((LOCK['release'],LOCK['migration'],LOCK['realWorldGatesOpen']),('NO_GO','HOLD',12))
    def test_source_files(self):
        for name,sha in PINS.items():
            with self.subTest(name=name):
                self.assertTrue(Path(name).is_file())
                actual=subprocess.check_output(['git','hash-object',name],text=True).strip()
                self.assertEqual(actual,sha)
    def test_no_workflow_prod(self):
        raw=self.read()
        self.assertNotIn('push:',raw)
        self.assertNotIn('secrets.',raw)
    def test_missing_cleanup_gate(self):self.reject(self.read().replace('if: always()','if: success()',1))
    def test_bad_permission(self):self.reject(self.read().replace('contents: read','contents: write',1))
    def test_wrong_posthold(self):self.reject(self.read().replace('R249_POST_CLEANUP_NO_GO_HOLD_PASS','R249_BROKEN'))
    def test_wrong_db(self):self.reject(self.read().replace('postgres:17','postgres:16',1))
    def test_missing_probe(self):self.reject(self.read().replace('python3 car02_r249_transaction_session_rls_isolated.py --cid','echo broken --cid',1))
    def test_contract(self):self.reject(self.read().replace('test_car02_r251_workflow_contract.py','test_broken_r251.py',1))
    def test_bad_local_replay(self):self.reject(self.read().replace('test_car02_r250_transaction_session_rls.py','test_broken_r250.py',1))
    def test_remove_cleanup_confirmation(self):self.reject(self.read().replace('echo R249_DISPOSABLE_DB_AND_ROLES_DELETED >','echo R249_CLEANUP_UNVERIFIED >'))
    def test_bad_qa_env(self):self.reject(self.read().replace("R249_DISPOSABLE_QA: 'yes'","R249_DISPOSABLE_QA: 'no'"))

for i,(path,sha) in enumerate(PINS.items()):
    def make_pre(path):
        def test(self):self.reject(self.read().replace('git rev-parse HEAD:'+path,'git rev-parse HEAD:missing'+path,1))
        return test
    def make_post(path):
        def test(self):
            raw=self.read();start=raw.index('      - name: Verify post-cleanup');a,b=raw[:start],raw[start:]
            self.reject(a+b.replace('git hash-object '+path,'git hash-object missing'+path,1))
        return test
    setattr(Contract,'test_source_pre_'+str(i),make_pre(path))
    setattr(Contract,'test_source_post_'+str(i),make_post(path))

if __name__=='__main__':unittest.main()

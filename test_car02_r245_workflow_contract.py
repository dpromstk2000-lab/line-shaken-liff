#!/usr/bin/env python3
"""R245: fail-closed source/workflow policy for disposable R243 PG17 QA."""
from __future__ import annotations
import copy
import hashlib
from pathlib import Path
import re
import subprocess
import unittest
import yaml
from test_car02_r242_workflow_contract import PINS as OLD_PINS

WF=Path('.github/workflows/car02-r243-r245-pg17-rls-aggregate-setops-hold-qa.yml')
PINS=dict(OLD_PINS)
PINS.update({
    'car02_r240_rls_query_shapes_isolated.py': '977b0b2dcec59916f3bc924dbe4b7d8cfb87a434',
    'test_car02_r241_rls_query_shapes.py': '67018301d1f72c08df95c9356bf6e3648c490524',
    'test_car02_r242_workflow_contract.py': 'f145c1ac61156363eb657f7c855d73fc6fde25a9',
    '.github/workflows/car02-r240-r242-pg17-rls-query-shapes-hold-qa.yml': 'bca508f181605ba1ac72ad78cd9766ce6a81a111',
})

class R245Error(AssertionError):pass

def require(condition,code):
    if not condition:raise R245Error('R245_'+code)

def check(doc):
    require(type(doc) is dict,'DOC')
    require(doc.get('on',doc.get(True))=={'workflow_dispatch':None},'MANUAL_TRIGGER')
    require(doc.get('permissions')=={'contents':'read'},'READ_ONLY_TOKEN')
    require(type(doc.get('concurrency')) is dict and
            doc['concurrency'].get('cancel-in-progress') is False,'CONCURRENCY')
    require(type(doc.get('jobs')) is dict and len(doc['jobs'])==1 and
            'disposable-pg17-rls-aggregate-setops-only' in doc['jobs'],'JOB')
    j=doc['jobs']['disposable-pg17-rls-aggregate-setops-only']
    require(j.get('runs-on')=='ubuntu-24.04' and j.get('timeout-minutes')==20,'RUNNER')
    require(j.get('services',{}).get('postgres',{}).get('image')=='postgres:17','PG17')
    require(j.get('env')=={'CAR02_RELEASE_LOCK':'true','R243_DISPOSABLE_QA':'yes',
                          'PYTHONDONTWRITEBYTECODE':'1'},'LOCK_ENV')
    steps=j.get('steps')
    require(type(steps) is list and len(steps)==11,'STEPS')
    require(steps[0].get('uses')=='actions/checkout@v5' and
            steps[0].get('with',{}).get('persist-credentials') is False,'READ_ONLY_CHECKOUT')
    require(steps[7].get('if')=='always()' and steps[7].get('name','').startswith('Always remove'),
            'CLEANUP_UNCONDITIONAL')
    require(steps[9].get('if')=='always()' and steps[9].get('uses')=='actions/upload-artifact@v5',
            'EVIDENCE_ON_FAILURE')
    require(steps[9].get('with')=={'name':'car02-r243-r245-synthetic-only-evidence',
            'path':'qa-evidence-r243/','retention-days':7,'if-no-files-found':'error'},
            'ARTIFACT_RETENTION')
    runs='\n'.join(step.get('run','') for step in steps)
    require('CREATE DATABASE car02_r138_qa_ci;' in runs and
            'DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);' in runs,
            'THROWAWAY_DB')
    require('for role in car02_r138_a_staff_ci car02_r138_a_one_ci car02_r138_a_two_ci car02_r138_b_staff_ci car02_r138_b_one_ci; do' in runs,
            'FIVE_ROLE_CLEANUP')
    for needle in ('R243_THROWAWAY_DATABASE_AND_FIVE_ROLES_DELETED',
                   'R243_NO_GO_HOLD_TWELVE_GATES_OPEN',
                   'R243_DISPOSABLE_PG17_RLS_AGGREGATE_SETOPS_CORRELATED_NO_GO_HOLD_PASS',
                   'python3 car02_r243_rls_aggregate_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',
                   'test_car02_r244_rls_aggregate.py','test_car02_r245_workflow_contract.py',
                   'from car02_r243_rls_aggregate_isolated import validate as verify',
                   "doc['githubCommit']==os.environ['GITHUB_SHA']",'retention-days',
                   'git config --local --get credential.helper'):
        require(needle in runs or needle in str(steps),'CONTRACT_'+needle[:25])
    require('^Ran 389 tests in ' in runs,'LOCAL_NEGATIVE_TEST_COUNT')
    for name,sha in PINS.items():
        require(f'test "$(git rev-parse HEAD:{name})" = \'{sha}\'' in steps[1]['run'],
                'PIN_HEAD_'+name)
        for n in (1,8):
            require(f'test "$(git hash-object {name})" = \'{sha}\'' in steps[n]['run'],
                    'PIN_WORKTREE_'+str(n)+'_'+name)
    for bad in ('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL',
                'wrangler deploy','git push','npm publish','curl -X POST',
                'cloudflare.com','supabase.co','actions/upload-artifact@v4'):
        require(bad not in runs,'PRODUCTION_BARRIER')
    for item in steps:
        if 'run' in item:
            require(item.get('shell')=='bash' and 'set -euo pipefail' in item['run'],
                    'FAIL_CLOSED_SHELL')
            r=subprocess.run(['bash','-n'],input=item['run'],text=True,capture_output=True)
            require(r.returncode==0,'SHELL_SYNTAX')
    return True

def verify_files():
    require(len(PINS)==30,'PIN_COUNT')
    for path,expected in PINS.items():
        data=Path(path).read_bytes()
        actual=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
        require(actual==expected,'PIN_DRIFT_'+path)
    return True

class WorkflowTests(unittest.TestCase):
    def doc(self):return yaml.safe_load(WF.read_text())
    def reject(self,doc):
        with self.assertRaises(R245Error):check(doc)
    def test_good(self):self.assertTrue(check(self.doc()))
    def test_30_pins(self):self.assertTrue(verify_files())
    def test_manual_only(self):
        d=self.doc();d['on']={'push':None};self.reject(d)
    def test_no_scheduled(self):self.assertNotIn('schedule',str(self.doc().get('on',self.doc().get(True))))
    def test_artifact_retention(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-aggregate-setops-only']['steps'][9]['with']['retention-days']=90;self.reject(d)
    def test_cleanup_always(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-aggregate-setops-only']['steps'][7]['if']='success()';self.reject(d)
    def test_permission_write(self):
        d=self.doc();d['permissions']={'contents':'write'};self.reject(d)
    def test_postgres_version(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-aggregate-setops-only']['services']['postgres']['image']='postgres:16';self.reject(d)
    def test_missing_probe(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-aggregate-setops-only']['steps'][6]['run']='set -euo pipefail\necho wrong';self.reject(d)
    def test_missing_cleanup(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-aggregate-setops-only']['steps'][7]['run']='set -euo pipefail\necho wrong';self.reject(d)
    def test_bad_shell(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-aggregate-setops-only']['steps'][6]['run']+='\nif then\n';self.reject(d)
    def test_stored_credentials(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-aggregate-setops-only']['steps'][0]['with']['persist-credentials']=True;self.reject(d)
    def test_skip_artifact_on_failure(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-aggregate-setops-only']['steps'][9]['if']='success()';self.reject(d)
    def test_added_secret(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-aggregate-setops-only']['env']['DATABASE_URL']='prod';self.reject(d)

# Each originally protected file requires HEAD, pre and post worktree guards.
def mutate_pin(path,stage):
    def test(self):
        d=self.doc()
        steps=d['jobs']['disposable-pg17-rls-aggregate-setops-only']['steps']
        ix=1 if stage in ('head','pre') else 8
        needle=('git rev-parse HEAD:'+path if stage=='head' else 'git hash-object '+path)
        lines=steps[ix]['run'].splitlines()
        target=next(i for i,x in enumerate(lines) if needle in x)
        lines.pop(target)
        steps[ix]['run']='\n'.join(lines)
        self.reject(d)
    return test
for name in PINS:
    norm=Path(name).stem.replace('-','_').replace('.','_')
    for stage in ('head','pre','post'):
        setattr(WorkflowTests,'test_missing_'+stage+'_'+norm,mutate_pin(name,stage))

if __name__=='__main__':unittest.main()

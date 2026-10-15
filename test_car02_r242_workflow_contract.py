#!/usr/bin/env python3
"""R242: fail-closed contract for disposable exact-row RLS CI workflow."""
from __future__ import annotations
import copy, hashlib, re, subprocess, unittest
from pathlib import Path
import yaml

WF=Path('.github/workflows/car02-r240-r242-pg17-rls-query-shapes-hold-qa.yml')
PINS={
    'R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql': '3784f8a28549bc40343646bf88657c9d9b0b80f2',
    'car02_r138_pg17_lifecycle_qa.py': 'ff98dd74916ff3ea77412b986138151a4fddab90',
    'car02_r159_concurrent_booking_isolated.py': '318921e951cf1578bb00f32eb77f2054ca350ed6',
    'car02_r162_booking_stress_isolated.py': 'd6dd3a48a48ffe045ce4ab5df3c2fdd86b3e0e5e',
    'car02_r171_rejection_immutability_isolated.py': '23f082a6b247d26cb772c6eee5084000f12d72a2',
    'car02_r188_role_escalation_isolated.py': 'd61fc9d6d2248e1851187a6b20dea4184fea564d',
    'car02_r191_transaction_rollback_isolated.py': '7bf3c1b690db14e6dcbe27831d18231488c91d5f',
    'car02_r194_savepoint_atomicity_isolated.py': 'b30b081cc019692739e8a4182be00bed73ed1ecc',
    'car02_r197_error_recovery_isolated.py': '561a282301a5133f37881a04a8459a0ca87b05e1',
    'car02_r200_lock_timeout_isolated.py': '565d6d0528b23202bbb61910b83bad0b8678370a',
    'car02_r203_deadlock_recovery_isolated.py': '084906c336dcd2011fdadc1eca8f264ccd423327',
    'car02_r206_disconnect_atomicity_isolated.py': '110c7640b9cdf233741ea9fdc59d903517f983eb',
    'car02_r209_commit_ack_loss_isolated.py': '72e0fd3bf6cdf536280c34fe0e8b19231b3bfe1a',
    'car02_r212_parallel_replay_isolated.py': '19264cdafa04685995bd9cf24e55b22685cd1dab',
    'car02_r215_first_write_race_isolated.py': '22f4a7678eac6bb87bb5c875e43d56bae13d3175',
    'car02_r218_tenant_namespace_race_isolated.py': 'c1bbe5cff75a4709df0d09791df1ab424bb9156f',
    'car02_r221_forged_owner_ops_isolated.py': '057f05639dcfda64585eb42089dbefceca9289ef',
    'car02_r224_used_key_auth_precedence_isolated.py': '6211db3cdda6623e1d77138e61ab0049e5bca0a9',
    'car02_r227_search_path_shadow_isolated.py': 'efc31b42dc982b0ba4efca968e697527140a3a87',
    'car02_r230_ddl_tamper_isolated.py': '9691a85583937e201f40e5d8fdb79640e96b06f1',
    'car02_r233_role_grant_isolated.py': '073dba18de205815c07815d01790b6be9f8fe896',
    'test_car02_r234_role_grant.py': '8f8a8c0395a56a8c58cd0d91e73d601427272783',
    'car02_r237_exact_row_rls_isolated.py': '06f321f6bfcaf94604dab2edb06fae10dc548471',
    'test_car02_r238_exact_row_rls.py': '69fb2274054e5660cbc6ad794e4f2d372704e8a7',
    'test_car02_r239_workflow_contract.py': '819eb66ac1b2be63fb55242a2f42c7083fffba44',
    '.github/workflows/car02-r237-r239-pg17-exact-row-rls-hold-qa.yml': 'f3d021a8d02a0d63f771b0aae247056dbd887aba',
}

class ContractError(AssertionError):pass

def require(condition,reason):
    if not condition:raise ContractError('R242_'+reason)

def contract(doc):
    require(type(doc) is dict,'DOCUMENT')
    triggers=doc.get('on',doc.get(True))
    require(type(triggers) is dict and set(triggers)=={'workflow_dispatch'},'MANUAL_ONLY')
    require(doc.get('permissions')=={'contents':'read'},'READ_ONLY_TOKEN')
    require(type(doc.get('concurrency')) is dict and doc['concurrency'].get('cancel-in-progress') is False,
            'CONCURRENT_PROTECTION')
    jobs=doc.get('jobs')
    require(type(jobs) is dict and set(jobs)=={'disposable-pg17-rls-query-shapes-only'},'JOBS')
    job=jobs['disposable-pg17-rls-query-shapes-only']
    require(job.get('runs-on')=='ubuntu-24.04' and job.get('timeout-minutes')==20,'RUNNER')
    require(job.get('services',{}).get('postgres',{}).get('image')=='postgres:17','PG17')
    require(job.get('env')=={'CAR02_RELEASE_LOCK':'true','R240_DISPOSABLE_QA':'yes',
                           'PYTHONDONTWRITEBYTECODE':'1'},'LOCK_ENV')
    steps=job.get('steps')
    require(type(steps) is list and len(steps)==11,'STEPS')
    require(steps[0].get('uses')=='actions/checkout@v5' and
            steps[0].get('with',{}).get('persist-credentials') is False,'CHECKOUT')
    require(steps[7].get('if')=='always()' and steps[7].get('name','').startswith('Always remove'),
            'ALWAYS_CLEANUP')
    require(steps[9].get('if')=='always()' and steps[9].get('uses')=='actions/upload-artifact@v5',
            'ARTIFACT')
    require(steps[9].get('with')=={'name':'car02-r240-r242-synthetic-only-evidence',
            'path':'qa-evidence-r240/','retention-days':7,'if-no-files-found':'error'},
            'ARTIFACT_POLICY')
    runs='\n'.join(s.get('run','') for s in steps)
    require('CREATE DATABASE car02_r138_qa_ci;' in runs and
            'DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);' in runs,'ONLY_THROWAWAY_DATABASE')
    require('R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql' in runs,'ORIGINAL_SCHEMA')
    require('for role in car02_r138_a_staff_ci car02_r138_a_one_ci car02_r138_a_two_ci car02_r138_b_staff_ci car02_r138_b_one_ci; do' in runs,
            'FIVE_ROLE_CLEANUP')
    require('R240_THROWAWAY_DATABASE_AND_FIVE_ROLES_DELETED' in runs and
            'R240_NO_GO_HOLD_TWELVE_GATES_OPEN' in runs,'NO_GO_HOLD')
    require('python3 car02_r240_rls_query_shapes_isolated.py --cid "$CID" --commit "$GITHUB_SHA"' in runs,
            'REAL_TEST')
    require("^Ran 202 tests in " in runs and 'test_car02_r241_rls_query_shapes.py' in runs,
            'NEGATIVE_TESTS')
    require('test_car02_r242_workflow_contract.py' in runs,'CONTRACT_RUN')
    require('verify(doc)' in runs and 'doc[\'githubCommit\']==os.environ[\'GITHUB_SHA\']' in runs,
            'INDEPENDENT_PROOF_VERIFICATION')
    require('git config --local --get credential.helper' in runs,'CREDENTIAL_CHECK')
    for path,sha in PINS.items():
        require('test "$(git rev-parse HEAD:'+path+')" = \''+sha+"'" in runs,
                'PIN_COMMIT_'+path)
        require('test "$(git hash-object '+path+')" = \''+sha+"'" in steps[8]['run'],
                'PIN_POST_CLEANUP_WORKTREE_'+path)
        require('test "$(git hash-object '+path+')" = \''+sha+"'" in steps[1]['run'],
                'PIN_PRE_WORKTREE_'+path)
    forbidden=('SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL',
               'wrangler deploy','cloudflare.com','supabase.co','curl -X POST',
               'actions/checkout@v4','actions/upload-artifact@v4',
               'git push','npm publish')
    require(all(word not in runs for word in forbidden),'NO_PRODUCTION_ACCESS')
    for s in steps:
        if 'run' in s:
            require(s.get('shell')=='bash','SHELL')
            require('set -euo pipefail' in s['run'],'FAIL_CLOSED_SHELL')
            p=subprocess.run(['bash','-n'],input=s['run'],text=True,capture_output=True)
            require(p.returncode==0,'SHELL_SYNTAX')
    return True

def verify_files():
    require(len(PINS)==26,'PIN_COUNT')
    for path,sha in PINS.items():
        data=Path(path).read_bytes()
        actual=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
        require(actual==sha,'LOCAL_PIN_DRIFT_'+path)
    return True

class WorkflowTests(unittest.TestCase):
    def doc(self):return yaml.safe_load(WF.read_text())
    def reject(self,d):
        with self.assertRaises(ContractError):contract(d)
    def test_valid(self):self.assertTrue(contract(self.doc()))
    def test_pins(self):self.assertTrue(verify_files())
    def test_26_pins(self):self.assertEqual(len(PINS),26)
    def test_manual_only(self):
        d=self.doc();d['on']={'push':{}};self.reject(d)
    def test_workflow_is_not_schedule(self):self.assertNotIn('schedule',str(self.doc().get('on',self.doc().get(True))))
    def test_job_count(self):self.assertEqual(len(self.doc()['jobs']),1)
    def test_db_scope(self):self.assertIn('car02_r138_qa_ci',WF.read_text())
    def test_artifact(self):self.assertIn('retention-days: 7',WF.read_text())
    def test_no_workflow_write(self):
        d=self.doc();d['permissions']={'contents':'write'};self.reject(d)
    def test_runner_os(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-query-shapes-only']['runs-on']='ubuntu-latest';self.reject(d)
    def test_pg_version(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-query-shapes-only']['services']['postgres']['image']='postgres:16';self.reject(d)
    def test_no_production_env(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-query-shapes-only']['env']['DATABASE_URL']='prod';self.reject(d)
    def test_cleanup_unconditional(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-query-shapes-only']['steps'][7]['if']='success()';self.reject(d)
    def test_artifact_unconditional(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-query-shapes-only']['steps'][9]['if']='success()';self.reject(d)
    def test_credential_persistence(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-query-shapes-only']['steps'][0]['with']['persist-credentials']=True;self.reject(d)
    def test_evidence_retention(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-query-shapes-only']['steps'][9]['with']['retention-days']=90;self.reject(d)
    def test_shell_failure(self):
        d=self.doc();d['jobs']['disposable-pg17-rls-query-shapes-only']['steps'][6]['run']+='\n  if then\n';self.reject(d)

# All 22 fixed sources must be present in both commit and worktree guards.
def drop_pin(path,source):
    def test(self):
        d=self.doc();steps=d['jobs']['disposable-pg17-rls-query-shapes-only']['steps']
        line=('test "$(git rev-parse HEAD:'+path+')" = ' if source=='commit' else
              'test "$(git hash-object '+path+')" = ')
        index=1 if source=='commit' else 8
        step=steps[index]
        step['run']='\n'.join(x for x in step['run'].split('\n') if line not in x)
        self.reject(d)
    return test
for name in PINS:
    base=Path(name).stem.replace('-','_')
    for kind in ('commit','worktree'):
        setattr(WorkflowTests,'test_missing_'+kind+'_'+base,drop_pin(name,kind))

if __name__=='__main__':unittest.main()

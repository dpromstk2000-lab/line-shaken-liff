#!/usr/bin/env python3
"""R248: fail-closed static CI and source immutability contract (no DB)."""
from __future__ import annotations
from pathlib import Path
import re, subprocess, unittest
import yaml
from car02_r246_prepared_plan_rls_isolated import LOCK
WF=Path('.github/workflows/car02-r246-r248-pg17-prepared-plan-rls-hold-qa.yml')
PINS={'R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql': '3784f8a28549bc40343646bf88657c9d9b0b80f2', 'car02_r138_pg17_lifecycle_qa.py': 'ff98dd74916ff3ea77412b986138151a4fddab90', 'car02_r159_concurrent_booking_isolated.py': '318921e951cf1578bb00f32eb77f2054ca350ed6', 'car02_r162_booking_stress_isolated.py': 'd6dd3a48a48ffe045ce4ab5df3c2fdd86b3e0e5e', 'car02_r171_rejection_immutability_isolated.py': '23f082a6b247d26cb772c6eee5084000f12d72a2', 'car02_r188_role_escalation_isolated.py': 'd61fc9d6d2248e1851187a6b20dea4184fea564d', 'car02_r191_transaction_rollback_isolated.py': '7bf3c1b690db14e6dcbe27831d18231488c91d5f', 'car02_r194_savepoint_atomicity_isolated.py': 'b30b081cc019692739e8a4182be00bed73ed1ecc', 'car02_r197_error_recovery_isolated.py': '561a282301a5133f37881a04a8459a0ca87b05e1', 'car02_r200_lock_timeout_isolated.py': '565d6d0528b23202bbb61910b83bad0b8678370a', 'car02_r203_deadlock_recovery_isolated.py': '084906c336dcd2011fdadc1eca8f264ccd423327', 'car02_r206_disconnect_atomicity_isolated.py': '110c7640b9cdf233741ea9fdc59d903517f983eb', 'car02_r209_commit_ack_loss_isolated.py': '72e0fd3bf6cdf536280c34fe0e8b19231b3bfe1a', 'car02_r212_parallel_replay_isolated.py': '19264cdafa04685995bd9cf24e55b22685cd1dab', 'car02_r215_first_write_race_isolated.py': '22f4a7678eac6bb87bb5c875e43d56bae13d3175', 'car02_r218_tenant_namespace_race_isolated.py': 'c1bbe5cff75a4709df0d09791df1ab424bb9156f', 'car02_r221_forged_owner_ops_isolated.py': '057f05639dcfda64585eb42089dbefceca9289ef', 'car02_r224_used_key_auth_precedence_isolated.py': '6211db3cdda6623e1d77138e61ab0049e5bca0a9', 'car02_r227_search_path_shadow_isolated.py': 'efc31b42dc982b0ba4efca968e697527140a3a87', 'car02_r230_ddl_tamper_isolated.py': '9691a85583937e201f40e5d8fdb79640e96b06f1', 'car02_r233_role_grant_isolated.py': '073dba18de205815c07815d01790b6be9f8fe896', 'test_car02_r234_role_grant.py': '8f8a8c0395a56a8c58cd0d91e73d601427272783', 'car02_r237_exact_row_rls_isolated.py': '06f321f6bfcaf94604dab2edb06fae10dc548471', 'test_car02_r238_exact_row_rls.py': '69fb2274054e5660cbc6ad794e4f2d372704e8a7', 'test_car02_r239_workflow_contract.py': '819eb66ac1b2be63fb55242a2f42c7083fffba44', '.github/workflows/car02-r237-r239-pg17-exact-row-rls-hold-qa.yml': 'f3d021a8d02a0d63f771b0aae247056dbd887aba', 'car02_r240_rls_query_shapes_isolated.py': '977b0b2dcec59916f3bc924dbe4b7d8cfb87a434', 'test_car02_r241_rls_query_shapes.py': '67018301d1f72c08df95c9356bf6e3648c490524', 'test_car02_r242_workflow_contract.py': 'f145c1ac61156363eb657f7c855d73fc6fde25a9', '.github/workflows/car02-r240-r242-pg17-rls-query-shapes-hold-qa.yml': 'bca508f181605ba1ac72ad78cd9766ce6a81a111', 'car02_r243_rls_aggregate_isolated.py': '2188b095fdfc0eb29b2a6a2214c9e89b235a3d56', 'test_car02_r244_rls_aggregate.py': 'ba1dfc37303981993f1bc764d6eec031c81eb41e', 'test_car02_r245_workflow_contract.py': '5ec2bdbaae404694d41348348ad49d26954eb1ab', '.github/workflows/car02-r243-r245-pg17-rls-aggregate-setops-hold-qa.yml': 'a43e3df16d28b95f77737ae33802b67574f05068'}

class R248Error(AssertionError):pass

def require(ok,code):
    if not ok:raise R248Error('R248_'+code)

def validate_workflow(raw):
    require(type(raw) is str and len(raw)>3000,'RAW')
    try:conf=yaml.safe_load(raw)
    except yaml.YAMLError as exc:raise R248Error('R248_YAML') from exc
    require(type(conf) is dict and type(conf.get('jobs')) is dict and
        set(conf['jobs'])=={'synthetic-pg17-prepared-plan-only'},'JOBS')
    require(conf.get('permissions')=={'contents':'read'},'PERMISSIONS')
    require(conf.get('concurrency',{}).get('cancel-in-progress') is False,'NO_CANCEL')
    job=conf['jobs']['synthetic-pg17-prepared-plan-only']
    require(job.get('runs-on')=='ubuntu-24.04','RUNNER')
    require(job.get('timeout-minutes')==20,'TIMEOUT')
    require(job.get('services',{}).get('postgres',{}).get('image')=='postgres:17','PG17')
    require(job.get('env',{}).get('CAR02_RELEASE_LOCK')=='true' and
        job['env'].get('R246_DISPOSABLE_QA')=='yes','ENV')
    steps=job.get('steps')
    require(type(steps) is list and len(steps)==11,'STEP_COUNT')
    require(steps[0].get('uses')=='actions/checkout@v5' and
        steps[0].get('with',{}).get('persist-credentials') is False,'CHECKOUT')
    require(steps[-2].get('uses')=='actions/upload-artifact@v5' and
        steps[-2].get('if')=='always()','EVIDENCE_ARTIFACT')
    require(steps[-2].get('with',{}).get('retention-days')==7 and
        steps[-2]['with'].get('if-no-files-found')=='error' and
        steps[-2]['with'].get('path')=='qa-evidence-r246/','ARTIFACT_SCOPE')
    require(steps[-3].get('name','').startswith('Verify post cleanup'),'POST_CLEANUP')
    require(steps[-4].get('if')=='always()' and
        'DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE)' in steps[-4].get('run','') and
        'DROP ROLE IF EXISTS $role' in steps[-4]['run'] and
        'R246_DISPOSABLE_DB_AND_ROLES_DELETED' in steps[-4]['run'],'DISPOSABLE_CLEANUP')
    require('R246_RELEASE_NO_GO_MIGRATION_HOLD_TWELVE_GATES_OPEN' in raw and
        'R246_POST_CLEANUP_NO_GO_HOLD_PASS' in raw,'HOLD')
    require('python3 car02_r246_prepared_plan_rls_isolated.py --cid' in raw and
        'test_car02_r247_prepared_plan_rls.py' in raw and
        'test_car02_r248_workflow_contract.py' in raw,'PROBE_TEST_NAMES')
    require('Ran 418 tests in ' in raw and
        'grep -Fxq OK' in raw,'NEGATIVE_TEST_GATE')
    require('SET' not in steps[0].get('run',''),'CHECKOUT_COMMAND')
    require('CAR02_RELEASE_LOCK' in job['env'] and len(PINS)==34,'SOURCE_PIN_COUNT')
    before=steps[1].get('run','');after=steps[-3].get('run','')
    for name,sha in PINS.items():
        require(f'git rev-parse HEAD:{name}' in before and
                f'git hash-object {name}' in before and
                before.count(sha)>=2,'PRE_PIN_'+name)
        require(f'git hash-object {name}' in after and sha in after,'POST_PIN_'+name)
    safe_tokens=('workflow_dispatch','CAR02_RELEASE_LOCK','R246_DISPOSABLE_QA')
    for token in safe_tokens:require(token in raw,'REQUIRED_TOKEN_'+token)
    for forbidden in ('secrets.', 'supabase.com','cloudflare.com','workers.dev','wrangler deploy',
                      'git push','pages: write','contents: write','id-token: write','pull_request_target',
                      'environment: production','service_role_key', 'pg_dump --dbname=postgresql://'):
        require(forbidden not in raw,'FORBIDDEN_'+forbidden)
    return True

class Contract(unittest.TestCase):
    def test_valid(self):self.assertTrue(validate_workflow(WF.read_text()))
    def test_pin_count(self):self.assertEqual(len(PINS),34)
    def test_lock(self):
        self.assertEqual((LOCK['release'],LOCK['migration'],LOCK['realWorldGatesOpen']),('NO_GO','HOLD',12))
        self.assertFalse(LOCK['productionTouched'])
    def test_source_files(self):
        for name,sha in PINS.items():
            with self.subTest(name=name):
                self.assertTrue(Path(name).is_file())
                actual=subprocess.check_output(['git','hash-object',name],text=True).strip()
                self.assertEqual(actual,sha)
    def test_workflow_name(self):self.assertEqual(WF.name,'car02-r246-r248-pg17-prepared-plan-rls-hold-qa.yml')
    def test_no_dangerous_writes(self):
        text=WF.read_text()
        for t in ('deploy ', 'POST /api/', 'service_role', 'pull_request_target', 'set-secret', 'wrangler '):
            self.assertNotIn(t,text)
    def reject(self,raw):
        with self.assertRaises(R248Error):validate_workflow(raw)
    def test_missing_cleanup(self):self.reject(WF.read_text().replace('if: always()','if: success()',1))
    def test_bad_permissions(self):self.reject(WF.read_text().replace('contents: read','contents: write'))
    def test_bad_posthold(self):self.reject(WF.read_text().replace('R246_POST_CLEANUP_NO_GO_HOLD_PASS','R246_UNSAFE'))
    def test_bad_fixture(self):self.reject(WF.read_text().replace('postgres:17','postgres:16'))
    def test_missing_probe(self):self.reject(WF.read_text().replace('python3 car02_r246_prepared_plan_rls_isolated.py --cid','echo broken --cid'))
    def test_missing_failure_gate(self):self.reject(WF.read_text().replace('Ran 418 tests in ','Ran 1 tests in '))

for index,(name,sha) in enumerate(PINS.items()):
    def make_pre(n,s):
        def test(self):self.reject(WF.read_text().replace('git rev-parse HEAD:'+n,'git rev-parse HEAD:wrong'+n))
        return test
    def make_post(n,s):
        def test(self):
            raw=WF.read_text();step='Verify post cleanup source pins and unconditional NO GO HOLD'
            head,tail=raw.split(step,1)
            tail=tail.replace('git hash-object '+n,'git hash-object missing'+n)
            self.reject(head+step+tail)
        return test
    setattr(Contract,'test_pre_pin_'+str(index),make_pre(name,sha))
    setattr(Contract,'test_post_pin_'+str(index),make_post(name,sha))

if __name__=='__main__':unittest.main()

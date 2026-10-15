#!/usr/bin/env python3
"""R235 local-only release lock, disposable workflow, source pin and shell checks."""
import hashlib, json, re, subprocess, unittest
from pathlib import Path
import yaml
ROOT=Path(__file__).resolve().parent
WF=ROOT/'.github/workflows/car02-r233-r235-pg17-role-grant-hold-qa.yml'
SOURCE=WF.read_text()
DOC=yaml.safe_load(SOURCE)
JOB=DOC['jobs']['disposable-pg17-role-grant-only']
STEPS=JOB['steps']
PINS={'R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql': '3784f8a28549bc40343646bf88657c9d9b0b80f2', 'car02_r138_pg17_lifecycle_qa.py': 'ff98dd74916ff3ea77412b986138151a4fddab90', 'car02_r159_concurrent_booking_isolated.py': '318921e951cf1578bb00f32eb77f2054ca350ed6', 'car02_r171_rejection_immutability_isolated.py': '23f082a6b247d26cb772c6eee5084000f12d72a2', 'car02_r188_role_escalation_isolated.py': 'd61fc9d6d2248e1851187a6b20dea4184fea564d', 'car02_r191_transaction_rollback_isolated.py': '7bf3c1b690db14e6dcbe27831d18231488c91d5f', 'car02_r194_savepoint_atomicity_isolated.py': 'b30b081cc019692739e8a4182be00bed73ed1ecc', 'car02_r197_error_recovery_isolated.py': '561a282301a5133f37881a04a8459a0ca87b05e1', 'car02_r200_lock_timeout_isolated.py': '565d6d0528b23202bbb61910b83bad0b8678370a', 'car02_r203_deadlock_recovery_isolated.py': '084906c336dcd2011fdadc1eca8f264ccd423327', 'car02_r206_disconnect_atomicity_isolated.py': '110c7640b9cdf233741ea9fdc59d903517f983eb', 'car02_r209_commit_ack_loss_isolated.py': '72e0fd3bf6cdf536280c34fe0e8b19231b3bfe1a', 'car02_r212_parallel_replay_isolated.py': '19264cdafa04685995bd9cf24e55b22685cd1dab', 'car02_r215_first_write_race_isolated.py': '22f4a7678eac6bb87bb5c875e43d56bae13d3175', 'car02_r218_tenant_namespace_race_isolated.py': 'c1bbe5cff75a4709df0d09791df1ab424bb9156f', 'car02_r221_forged_owner_ops_isolated.py': '057f05639dcfda64585eb42089dbefceca9289ef', 'car02_r224_used_key_auth_precedence_isolated.py': '6211db3cdda6623e1d77138e61ab0049e5bca0a9', 'car02_r227_search_path_shadow_isolated.py': 'efc31b42dc982b0ba4efca968e697527140a3a87', 'car02_r162_booking_stress_isolated.py': 'd6dd3a48a48ffe045ce4ab5df3c2fdd86b3e0e5e', 'car02_r230_ddl_tamper_isolated.py': '9691a85583937e201f40e5d8fdb79640e96b06f1'}

def scripts():return [s['run'] for s in STEPS if 'run' in s]
class Contract(unittest.TestCase):
    def test_filename(self):self.assertEqual(WF.name,'car02-r233-r235-pg17-role-grant-hold-qa.yml')
    def test_only_manual(self):self.assertIn('workflow_dispatch:',SOURCE)
    def test_permissions(self):self.assertEqual(DOC['permissions'],{'contents':'read'})
    def test_single_job(self):self.assertEqual(list(DOC['jobs']),['disposable-pg17-role-grant-only'])
    def test_no_push(self):self.assertNotIn('push:',SOURCE)
    def test_no_schedule(self):self.assertNotIn('schedule:',SOURCE)
    def test_no_deploy(self):self.assertNotIn('deploy',SOURCE.lower())
    def test_no_production_secrets(self):
        for v in ('SERVICE_ROLE_KEY','SUPABASE_URL','CLOUDFLARE_API_TOKEN','LINE_CHANNEL_ACCESS_TOKEN','DATABASE_URL'):
            self.assertNotIn(v,SOURCE)
    def test_checkout_v5(self):self.assertEqual(STEPS[0]['uses'],'actions/checkout@v5')
    def test_no_checkout_token(self):self.assertIs(STEPS[0]['with']['persist-credentials'],False)
    def test_no_oidc(self):self.assertNotIn('id-token: write',SOURCE)
    def test_service_pg17(self):self.assertEqual(JOB['services']['postgres']['image'],'postgres:17')
    def test_short_timeout(self):self.assertLessEqual(JOB['timeout-minutes'],20)
    def test_ubuntu_24(self):self.assertEqual(JOB['runs-on'],'ubuntu-24.04')
    def test_no_cancel(self):self.assertIs(DOC['concurrency']['cancel-in-progress'],False)
    def test_environment_hold(self):self.assertEqual(JOB['env']['CAR02_RELEASE_LOCK'],'true')
    def test_environment_isolated(self):self.assertEqual(JOB['env']['R233_DISPOSABLE_QA'],'yes')
    def test_ten_steps(self):self.assertEqual(len(STEPS),10)
    def test_cleanup_always(self):self.assertEqual(STEPS[7]['if'],'always()')
    def test_artifact_always(self):self.assertEqual(STEPS[9]['if'],'always()')
    def test_artifact_short(self):self.assertEqual(STEPS[-1]['with']['retention-days'],7)
    def test_artifact_only_scope(self):self.assertEqual(STEPS[-1]['with']['path'],'qa-evidence-r233/')
    def test_fixture_db(self):self.assertIn('car02_r138_qa_ci',SOURCE)
    def test_one_create_db(self):self.assertEqual(SOURCE.count('CREATE DATABASE '),1)
    def test_drop_only_throwaway_db(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE)',SOURCE)
    def test_drop_all_roles(self):self.assertIn('for role in car02_r138_a_staff_ci car02_r138_a_one_ci car02_r138_a_two_ci car02_r138_b_staff_ci car02_r138_b_one_ci',SOURCE)
    def test_cleanup_verified(self):self.assertIn('R233_ALL_THROWAWAY_RESOURCES_DELETED',SOURCE)
    def test_empty_tables(self):self.assertIn('R233_FIVE_TABLES_EMPTY',SOURCE)
    def test_probe_exact(self):self.assertIn('python3 car02_r233_role_grant_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',SOURCE)
    def test_proof_validation_twice(self):self.assertEqual(SOURCE.count('verify_proof(p)'),2)
    def test_no_go(self):self.assertIn("p['release']=='NO_GO'",SOURCE)
    def test_hold(self):self.assertIn("p['migration']=='HOLD'",SOURCE)
    def test_twelve_gates_open(self):self.assertIn("p['realWorldGatesOpen']==12",SOURCE)
    def test_not_prod(self):self.assertIn("p['productionTouched'] is False",SOURCE)
    def test_grant_denial_count(self):self.assertIn("len(p['rejections'])==25",SOURCE)
    def test_three_rounds(self):self.assertIn('for round in 1 2 3; do',SOURCE)
    def test_r234_exact_count(self):self.assertIn("'^Ran 150 tests in '",SOURCE)
    def test_pin_count(self):self.assertEqual(len(PINS),20)
    def test_strict_shell(self):
        self.assertEqual(len(scripts()),8)
        for s in scripts():self.assertTrue(s.lstrip().startswith('set -euo pipefail'))
    def test_bash_syntax(self):
        for s in scripts():
            p=subprocess.run(['bash','-n'],input=s,text=True,capture_output=True)
            self.assertEqual(p.returncode,0,p.stderr)
    def test_no_external_url(self):self.assertNotIn('https://',SOURCE)
    def test_no_ssh(self):self.assertNotIn('ssh ',SOURCE)
    def test_no_git_push(self):self.assertNotIn('git push',SOURCE)
    def test_no_gh_merge(self):self.assertNotIn('gh pr merge',SOURCE)
    def test_no_inputs(self):self.assertNotIn('inputs.',SOURCE)
    def test_cleanup_before_final_gate(self):self.assertLess(SOURCE.index('Always remove disposable'),SOURCE.index('Verify source pins cleanup'))
    def test_artifacts_after_cleanup(self):self.assertLess(SOURCE.index('Always remove disposable'),SOURCE.index('Preserve synthetic evidence'))
    def test_python_entrypoints(self):
        self.assertIn('test_car02_r234_role_grant.py',SOURCE)
        self.assertIn('test_car02_r235_workflow_contract.py',SOURCE)
        self.assertIn('car02_r233_role_grant_isolated.py',SOURCE)
    def test_evidence_digest(self):self.assertIn('r233-role-grant-proof.json',SOURCE)


def mk_pin_test(name, sha):
    def f(self):
        raw=(ROOT/name).read_bytes()
        computed=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
        self.assertEqual(computed,sha)
        self.assertEqual(SOURCE.count('git rev-parse HEAD:'+name),2)
        self.assertEqual(SOURCE.count("= '"+sha+"'"),2)
    return f
for i,(name,sha) in enumerate(PINS.items()):
    setattr(Contract,f'test_pin_{i:02}_{Path(name).stem.lower()}',mk_pin_test(name,sha))
if __name__=='__main__':unittest.main()

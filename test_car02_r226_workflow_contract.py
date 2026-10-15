#!/usr/bin/env python3
"""R226: fail-closed static CI contract for R224 disposable PostgreSQL17 QA."""
from pathlib import Path
import re
import subprocess
import unittest
import yaml

WF=Path('.github/workflows/car02-r224-r226-pg17-used-key-auth-hold-qa.yml')
PROOF='qa-evidence-r224/r224-used-key-authorization-proof.json'
PINS={
 'R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql':'3784f8a28549bc40343646bf88657c9d9b0b80f2',
 'car02_r138_pg17_lifecycle_qa.py':'ff98dd74916ff3ea77412b986138151a4fddab90',
 'car02_r159_concurrent_booking_isolated.py':'318921e951cf1578bb00f32eb77f2054ca350ed6',
 'car02_r171_rejection_immutability_isolated.py':'23f082a6b247d26cb772c6eee5084000f12d72a2',
 'car02_r188_role_escalation_isolated.py':'d61fc9d6d2248e1851187a6b20dea4184fea564d',
 'car02_r191_transaction_rollback_isolated.py':'7bf3c1b690db14e6dcbe27831d18231488c91d5f',
 'car02_r194_savepoint_atomicity_isolated.py':'b30b081cc019692739e8a4182be00bed73ed1ecc',
 'car02_r197_error_recovery_isolated.py':'561a282301a5133f37881a04a8459a0ca87b05e1',
 'car02_r200_lock_timeout_isolated.py':'565d6d0528b23202bbb61910b83bad0b8678370a',
 'car02_r203_deadlock_recovery_isolated.py':'084906c336dcd2011fdadc1eca8f264ccd423327',
 'car02_r206_disconnect_atomicity_isolated.py':'110c7640b9cdf233741ea9fdc59d903517f983eb',
 'car02_r209_commit_ack_loss_isolated.py':'72e0fd3bf6cdf536280c34fe0e8b19231b3bfe1a',
 'car02_r212_parallel_replay_isolated.py':'19264cdafa04685995bd9cf24e55b22685cd1dab',
 'car02_r215_first_write_race_isolated.py':'22f4a7678eac6bb87bb5c875e43d56bae13d3175',
 'car02_r218_tenant_namespace_race_isolated.py':'c1bbe5cff75a4709df0d09791df1ab424bb9156f',
 'car02_r221_forged_owner_ops_isolated.py':'057f05639dcfda64585eb42089dbefceca9289ef',
}
class Contract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src=WF.read_text(encoding='utf8');cls.lower=cls.src.lower();cls.yaml=yaml.safe_load(cls.src)
        cls.job=cls.yaml['jobs']['synthetic-pg17-used-key-auth-only']
        cls.steps=cls.job['steps'];cls.runs=[x['run'] for x in cls.steps if 'run' in x]
    def test_ten_steps(self):self.assertEqual(len(self.steps),10)
    def test_single_job(self):self.assertEqual(len(self.yaml['jobs']),1)
    def test_manual_only(self):self.assertIn('  workflow_dispatch:',self.src)
    def test_no_push(self):self.assertNotIn('  push:',self.src)
    def test_no_schedule(self):self.assertNotIn('  schedule:',self.src)
    def test_no_pr(self):self.assertNotIn('  pull_request:',self.src)
    def test_readonly(self):self.assertIn('permissions:\n  contents: read\n',self.src)
    def test_no_write_scope(self):self.assertNotIn(': write',self.lower)
    def test_no_secrets(self):self.assertNotIn('secrets.',self.lower)
    def test_no_service_role(self):self.assertNotIn('service_role_key',self.lower)
    def test_no_supabase(self):self.assertNotIn('supabase_url',self.lower)
    def test_no_database_url(self):self.assertNotIn('database_url',self.lower)
    def test_no_id_token(self):self.assertNotIn('id-token:',self.lower)
    def test_no_deploy(self):self.assertNotIn('wrangler deploy',self.lower)
    def test_no_remote_push(self):self.assertNotIn('git push',self.lower)
    def test_no_release_permission(self):self.assertNotIn('packages: write',self.lower)
    def test_no_env_production(self):self.assertNotIn('environment: production',self.lower)
    def test_ubuntu_pinned(self):self.assertEqual(self.job['runs-on'],'ubuntu-24.04')
    def test_pg17(self):self.assertEqual(self.job['services']['postgres']['image'],'postgres:17')
    def test_job_timeout(self):self.assertLessEqual(self.job['timeout-minutes'],20)
    def test_checkout_no_credentials(self):self.assertIn('persist-credentials: false',self.src)
    def test_no_go(self):self.assertIn('R224_RELEASE_NO_GO_MIGRATION_HOLD',self.src)
    def test_gate_count(self):self.assertIn("proof['realWorldGatesOpen']==12",self.src)
    def test_no_prod_touch(self):self.assertIn("proof['productionTouched'] is False",self.src)
    def test_script_binding(self):self.assertIn('python3 car02_r224_used_key_auth_precedence_isolated.py',self.src)
    def test_113_tests(self):self.assertIn('Ran 113 tests in ',self.src)
    def test_three_passes(self):self.assertIn('for round in 1 2 3',self.src)
    def test_proof_correct(self):self.assertEqual(self.src.count(PROOF),2)
    def test_correct_validator(self):self.assertIn('from car02_r224_used_key_auth_precedence_isolated import validate',self.src)
    def test_no_old_validator(self):self.assertNotIn('verify_report(',self.src)
    def test_no_old_proof(self):self.assertNotIn('r221-forged-owner-operations-proof.json',self.src)
    def test_32_denials(self):self.assertIn('FOUR_STAGES_32_FORGED_DENIALS',self.src)
    def test_replay_no_write(self):self.assertIn("x['afterAuthorized']==x['afterForgedReplays']==x['afterOwnerReplay']",self.src)
    def test_cleanup_if_always(self):self.assertRegex(self.src,r'Always remove disposable DB[\s\S]+?if: always\(\)')
    def test_cleanup_drop_db(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE)',self.src)
    def test_cleanup_drop_roles(self):self.assertIn('DROP ROLE IF EXISTS $role',self.src)
    def test_cleanup_assert(self):self.assertIn('R224_ALL_THROWAWAY_RESOURCES_DELETED',self.src)
    def test_cleanup_guard(self):self.assertIn('grep -Fxq R224_ALL_THROWAWAY_RESOURCES_DELETED',self.src)
    def test_exit_no_go(self):self.assertIn('R224_R226_CLEANUP_NO_GO_HOLD_PASS',self.src)
    def test_artifact_always(self):self.assertIn('retention-days: 7',self.src)
    def test_artifact_v5(self):self.assertIn('actions/upload-artifact@v5',self.src)
    def test_full_empty_fixture(self):self.assertIn('for table in bookings service_cases case_operations booking_operations audit_events',self.src)
    def test_disposable_schema(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci',self.src)
    def test_synthetic_roles(self):self.assertIn('car02_r138_a_one_ci car02_r138_a_two_ci',self.src)
    def test_source_pins(self):self.assertEqual(len(PINS),16)
    def test_no_legacy_python_module(self):self.assertNotIn('test_car02_r222_',self.src)
    def test_bash_syntax(self):
        for sh in self.runs:
            out=subprocess.run(['bash','-n'],input=sh,text=True,capture_output=True)
            self.assertEqual(out.returncode,0,out.stderr)

for path,sha in PINS.items():
    def check(self,p=path,digest=sha):
        self.assertEqual(self.src.count(f'HEAD:{p})\" = \'{digest}\''),2)
    setattr(Contract,'test_fixed_pin_'+re.sub(r'\W+','_',path),check)

if __name__=='__main__':unittest.main()

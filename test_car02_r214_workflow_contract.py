#!/usr/bin/env python3
"""R214: fail-closed workflow and immutable fixture contract checks."""
from pathlib import Path
import re
import subprocess
import unittest
import yaml

FILE=Path('.github/workflows/car02-r212-r214-pg17-parallel-replay-hold-qa.yml')
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
}
class WorkflowSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src=FILE.read_text('utf-8');cls.low=cls.src.lower()
        cls.data=yaml.safe_load(cls.src)
        cls.job=cls.data['jobs']['synthetic-pg17-parallel-replay-only']
        cls.steps=cls.job['steps'];cls.scripts=[s['run'] for s in cls.steps if 'run' in s]
    def test_manual_only(self):self.assertIn('  workflow_dispatch:',self.src)
    def test_no_push(self):self.assertNotIn('  push:',self.src)
    def test_no_schedule(self):self.assertNotIn('  schedule:',self.src)
    def test_no_pull_request(self):self.assertNotIn('  pull_request:',self.src)
    def test_read_only(self):self.assertIn('permissions:\n  contents: read\n',self.src)
    def test_no_write_permission(self):self.assertNotIn(': write',self.low)
    def test_no_secrets(self):self.assertNotIn('secrets.',self.low)
    def test_no_id_token(self):self.assertNotIn('id-token:',self.low)
    def test_no_github_token(self):self.assertNotIn('github.token',self.low)
    def test_no_database_url(self):self.assertNotIn('database_url',self.low)
    def test_no_service_role(self):self.assertNotIn('service_role_key',self.low)
    def test_no_supabase(self):self.assertNotIn('supabase',self.low)
    def test_no_cloudflare(self):self.assertNotIn('cloudflare',self.low)
    def test_no_wrangler(self):self.assertNotIn('wrangler',self.low)
    def test_no_line_api(self):self.assertNotIn('api.line.me',self.low)
    def test_no_git_push(self):self.assertNotIn('git push',self.low)
    def test_no_docker_push(self):self.assertNotIn('docker push',self.low)
    def test_ubuntu_version(self):self.assertEqual(self.job['runs-on'],'ubuntu-24.04')
    def test_timeout(self):self.assertEqual(self.job['timeout-minutes'],20)
    def test_postgres17(self):self.assertIn('image: postgres:17',self.src)
    def test_checkout_v5(self):self.assertIn('actions/checkout@v5',self.src)
    def test_credentials_not_persisted(self):self.assertIn('persist-credentials: false',self.src)
    def test_exact_db_create(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.src)
    def test_exact_fixture(self):self.assertIn('< R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.src)
    def test_no_other_creates(self):self.assertEqual(self.src.count('CREATE DATABASE '),1)
    def test_qa_env(self):self.assertIn("R212_DISPOSABLE_QA: 'yes'",self.src)
    def test_hold_env(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.src)
    def test_job_count(self):self.assertEqual(len(self.data['jobs']),1)
    def test_steps_count(self):self.assertEqual(len(self.steps),10)
    def test_all_shell_scripts_strict(self):
        for script in self.scripts:self.assertTrue(script.startswith('set -euo pipefail\n'))
    def test_shell_syntax(self):
        for script in self.scripts:
            x=subprocess.run(['bash','-n'],input=script,text=True,capture_output=True)
            self.assertEqual(x.returncode,0,x.stderr)
    def test_no_other_on(self):
        self.assertEqual(self.src.count('workflow_dispatch:'),1)
    def test_rollback_not_forced_in_real_environment(self):
        self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.src)
    def test_cleanup_always(self):
        item=next(x for x in self.steps if x['name'].startswith('Always remove'))
        self.assertEqual(item['if'],'always()')
    def test_cleanup_roles(self):
        self.assertIn('car02_r138_a_staff_ci car02_r138_a_one_ci car02_r138_a_two_ci car02_r138_b_staff_ci car02_r138_b_one_ci',self.src)
    def test_cleanup_verification(self):self.assertIn('R212_ALL_THROWAWAY_RESOURCES_DELETED',self.src)
    def test_two_source_passes(self):
        for sha in PINS.values():self.assertEqual(self.src.count(sha),2)
    def test_proof_filename(self):self.assertIn('r212-parallel-replay-proof.json',self.src)
    def test_exact_negative_count(self):self.assertIn('Ran 75 tests in ',self.src)
    def test_negative_repeated(self):self.assertIn('for round in 1 2 3; do',self.src)
    def test_negative_test_file(self):self.assertIn('test_car02_r213_parallel_replay.py',self.src)
    def test_workflow_test_file(self):self.assertIn('test_car02_r214_workflow_contract.py',self.src)
    def test_probe_scoped(self):self.assertIn('car02_r212_parallel_replay_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.src)
    def test_proof_four_cases(self):self.assertIn('len(CASES)==4',self.src)
    def test_proof_eight_clients(self):self.assertIn("len(v['identicalResults'])==len(v['mixedResults'])==8",self.src)
    def test_no_go_after_cleanup(self):self.assertIn("p['release']=='NO_GO' and p['migration']=='HOLD'",self.src)
    def test_cleanup_flag_verified(self):self.assertIn('grep -Fxq R212_ALL_THROWAWAY_RESOURCES_DELETED',self.src)
    def test_artifact(self):self.assertIn('actions/upload-artifact@v5',self.src)
    def test_artifact_always(self):
        item=next(x for x in self.steps if 'upload-artifact' in x.get('uses',''))
        self.assertEqual(item['if'],'always()')
    def test_retention(self):self.assertEqual(self.steps[-1]['with']['retention-days'],7)
    def test_without_network_auth_claim(self):self.assertIn("proof['realAuthenticationVerified'] is False",self.src)

if __name__=='__main__':unittest.main()

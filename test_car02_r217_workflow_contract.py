#!/usr/bin/env python3
"""R217: static fail-closed safety contract for new disposable PG17 QA."""
from pathlib import Path
import re,subprocess,unittest
import yaml

FILE=Path('.github/workflows/car02-r215-r217-pg17-first-write-race-hold-qa.yml')
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
}

class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src=FILE.read_text(encoding='utf-8');cls.low=cls.src.lower();cls.parsed=yaml.safe_load(cls.src)
        cls.job=cls.parsed['jobs']['synthetic-pg17-first-write-race-only']
        cls.steps=cls.job['steps'];cls.scripts=[x['run'] for x in cls.steps if 'run' in x]
    def test_exists(self):self.assertTrue(FILE.is_file())
    def test_manual(self):self.assertIn('  workflow_dispatch:',self.src)
    def test_no_push(self):self.assertNotIn('  push:',self.src)
    def test_no_schedule(self):self.assertNotIn('  schedule:',self.src)
    def test_no_pull_request(self):self.assertNotIn('  pull_request:',self.src)
    def test_no_write_scope(self):self.assertNotIn(': write',self.low)
    def test_readonly(self):self.assertIn('permissions:\n  contents: read\n',self.src)
    def test_checkout_v5(self):self.assertIn('actions/checkout@v5',self.src)
    def test_no_retained_token(self):self.assertIn('persist-credentials: false',self.src)
    def test_no_secrets(self):self.assertNotIn('secrets.',self.low)
    def test_no_supabase(self):self.assertNotIn('supabase_url',self.low)
    def test_no_service_key(self):self.assertNotIn('service_role_key',self.low)
    def test_no_id_token(self):self.assertNotIn('id-token:',self.low)
    def test_no_deploy(self):self.assertNotIn('wrangler',self.low)
    def test_no_remote_db(self):self.assertNotIn('database_url',self.low)
    def test_no_ci_production_access(self):self.assertNotIn('production_database',self.low)
    def test_image(self):self.assertEqual(self.job['services']['postgres']['image'],'postgres:17')
    def test_runner(self):self.assertEqual(self.job['runs-on'],'ubuntu-24.04')
    def test_timeout(self):self.assertEqual(self.job['timeout-minutes'],20)
    def test_disposable_gate(self):self.assertEqual(self.job['env']['R215_DISPOSABLE_QA'],'yes')
    def test_release_gate(self):self.assertEqual(self.job['env']['CAR02_RELEASE_LOCK'],'true')
    def test_jobs_exact(self):self.assertEqual(len(self.parsed['jobs']),1)
    def test_ten_steps(self):self.assertEqual(len(self.steps),10)
    def test_six_shell_steps_or_more(self):self.assertGreaterEqual(len(self.scripts),7)
    def test_shell_syntax(self):
        for block in self.scripts:
            result=subprocess.run(['bash','-n'],input=block,text=True,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
    def test_exact_live_script(self):self.assertIn('python3 car02_r215_first_write_race_isolated.py',self.src)
    def test_new_import(self):self.assertIn('from car02_r215_first_write_race_isolated import verify_report,SCENARIOS',self.src)
    def test_old_import_absent(self):self.assertNotIn('from car02_r215_parallel_replay_isolated',self.src)
    def test_qa_count(self):self.assertIn('Ran 95 tests in ',self.src)
    def test_real_pg17_probe(self):self.assertIn('FOUR_EIGHT_CLIENT_FIRST_WRITE_RACES_EXACTLY_ONCE',self.src)
    def test_real_payload_check(self):self.assertIn("len(v['results'])==8",self.src)
    def test_source_pins_before_after(self):self.assertEqual(self.src.count('git rev-parse HEAD:'),len(PINS)*2)
    def test_commit_binding(self):self.assertIn('"$GITHUB_SHA"',self.src)
    def test_empty_five_tables(self):
        for n in ('bookings','service_cases','case_operations','booking_operations','audit_events'):
            self.assertIn(n,self.src)
    def test_drop_always(self):self.assertIn('if: always()\n        shell: bash',self.src)
    def test_drop_db(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE)',self.src)
    def test_drop_all_roles(self):
        for n in ('car02_r138_a_staff_ci','car02_r138_a_one_ci','car02_r138_a_two_ci','car02_r138_b_staff_ci','car02_r138_b_one_ci'):
            self.assertIn(n,self.src)
    def test_drop_verification(self):self.assertIn('R215_ALL_THROWAWAY_RESOURCES_DELETED',self.src)
    def test_release_hold(self):self.assertIn('R215_RELEASE_NO_GO_MIGRATION_HOLD',self.src)
    def test_post_cleanup_lock(self):self.assertIn('R215_R217_CLEANUP_NO_GO_HOLD_PASS',self.src)
    def test_proof_commit_match(self):self.assertIn("proof['githubCommit']==os.environ['GITHUB_SHA']",self.src)
    def test_artifact_v5(self):self.assertIn('actions/upload-artifact@v5',self.src)
    def test_artifact_short_retention(self):self.assertIn('retention-days: 7',self.src)
    def test_no_artifact_user_data(self):self.assertIn('qa-evidence-r215/',self.src)
    def test_preserve_on_fail(self):self.assertGreaterEqual(self.src.count('if: always()'),2)

for k,digest in PINS.items():
    def check(self,k=k,digest=digest):
        line=f'test "$(git rev-parse HEAD:{k})" = \'{digest}\''
        self.assertEqual(self.src.count(line),2)
    setattr(WorkflowTests,'test_pin_'+re.sub('[^a-zA-Z0-9]','_',k),check)

if __name__=='__main__':unittest.main()

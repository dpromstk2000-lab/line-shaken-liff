#!/usr/bin/env python3
"""R211: fail-closed static CI safety checks for R209 disposable PG17 proof."""
from pathlib import Path
import re,subprocess,unittest,yaml
FILE=Path('.github/workflows/car02-r209-r211-pg17-commit-ack-loss-hold-qa.yml')
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
}
class WorkflowSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src=FILE.read_text(encoding='utf-8');cls.low=cls.src.lower();cls.doc=yaml.safe_load(cls.src)
        cls.job=cls.doc['jobs']['synthetic-pg17-commit-ack-loss-only']
        cls.steps=cls.job['steps'];cls.scripts=[x['run'] for x in cls.steps if 'run' in x]
    def test_manual_only(self):self.assertIn('  workflow_dispatch:',self.src)
    def test_not_push(self):self.assertNotIn('  push:',self.src)
    def test_not_schedule(self):self.assertNotIn('  schedule:',self.src)
    def test_no_pull_request(self):self.assertNotIn('  pull_request:',self.src)
    def test_readonly(self):self.assertIn('permissions:\n  contents: read\n',self.src)
    def test_no_write(self):self.assertNotIn(': write',self.low)
    def test_no_secrets(self):self.assertNotIn('secrets.',self.low)
    def test_no_id_token(self):self.assertNotIn('id-token:',self.low)
    def test_no_github_token(self):self.assertNotIn('github.token',self.low)
    def test_no_service_role_key(self):self.assertNotIn('service_role_key',self.low)
    def test_no_database_url(self):self.assertNotIn('database_url',self.low)
    def test_no_supabase_url(self):self.assertNotIn('supabase_url',self.low)
    def test_no_remote_deploy(self):
        for cmd in ('git push','docker push','wrangler deploy','supabase db push','npm publish','kubectl apply'):
            with self.subTest(cmd=cmd):self.assertNotIn(cmd,self.low)
    def test_no_live_line(self):self.assertNotIn('api.line.me',self.low)
    def test_no_cloudflare(self):self.assertNotIn('cloudflare',self.low)
    def test_disposable_pg17(self):self.assertEqual(self.job['services']['postgres']['image'],'postgres:17')
    def test_ubuntu(self):self.assertEqual(self.job['runs-on'],'ubuntu-24.04')
    def test_timeout(self):self.assertEqual(self.job['timeout-minutes'],20)
    def test_checkout(self):self.assertIn('actions/checkout@v5',self.src)
    def test_no_stored_credentials(self):self.assertIn('persist-credentials: false',self.src)
    def test_release_lock(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.src)
    def test_disposable_lock(self):self.assertIn("R209_DISPOSABLE_QA: 'yes'",self.src)
    def test_three_rounds(self):self.assertIn('for round in 1 2 3; do',self.src)
    def test_exact_local_count(self):self.assertIn('Ran 86 tests in ',self.src)
    def test_new_test_source(self):self.assertIn('test_car02_r210_commit_ack_loss.py',self.src)
    def test_workflow_self_test(self):self.assertIn('test_car02_r211_workflow_contract.py',self.src)
    def test_exact_db_creation(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.src)
    def test_fixture_sql(self):self.assertIn(' < R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.src)
    def test_empty_tables(self):self.assertIn('bookings service_cases case_operations booking_operations audit_events;',self.src)
    def test_actual_probe(self):self.assertIn('car02_r209_commit_ack_loss_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.src)
    def test_idempotent_proof(self):self.assertIn("x['identicalReplayResult']=='IDEMPOTENT'",self.src)
    def test_no_response_claim(self):self.assertIn("x['firstClientResponseObserved'] is False",self.src)
    def test_exact_four(self):self.assertIn("len(r['scenarios'])==len(SCENARIOS)==4",self.src)
    def test_cleanup_always(self):
        name=next(s for s in self.steps if s['name'].startswith('Always drop'))
        self.assertEqual(name['if'],'always()')
    def test_deletes_db(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.src)
    def test_deletes_roles(self):self.assertIn('DROP ROLE IF EXISTS $role;',self.src)
    def test_verifies_deleted(self):self.assertIn('R209_ALL_THROWAWAY_RESOURCES_DELETED',self.src)
    def test_end_hold(self):self.assertIn('R209_R211_CLEANUP_NO_GO_HOLD_PASS',self.src)
    def test_gates_open(self):self.assertIn("r['realWorldGatesOpen']==12",self.src)
    def test_no_auth_claim(self):self.assertIn("r['realAuthenticationVerified'] is False",self.src)
    def test_same_commit(self):self.assertIn("r['githubCommit']==os.environ['GITHUB_SHA']",self.src)
    def test_artifact_v5(self):self.assertIn('actions/upload-artifact@v5',self.src)
    def test_short_retention(self):self.assertIn('retention-days: 7',self.src)
    def test_artifact_always(self):
        name=next(s for s in self.steps if 'upload-artifact' in str(s.get('uses','')))
        self.assertEqual(name['if'],'always()')
    def test_ten_steps(self):self.assertEqual(len(self.steps),10)
    def test_cleanup_order(self):
        names=[s['name'] for s in self.steps]
        self.assertLess(next(i for i,n in enumerate(names) if n.startswith('R209 PG17')),
                        next(i for i,n in enumerate(names) if n.startswith('Always drop')))
    def test_scripts_bash_syntax(self):
        for i,script in enumerate(self.scripts):
            with self.subTest(i=i):
                result=subprocess.run(['bash','-n'],input=script,text=True,capture_output=True)
                self.assertEqual(result.returncode,0,result.stderr)

def one_pin_test(path,sha):
    def run(self):
        self.assertEqual(self.src.count(sha),2)
        self.assertIn('HEAD:'+path,self.src)
    return run
for i,(p,s) in enumerate(PINS.items()):
    setattr(WorkflowSafety,f'test_source_pin_{i:02}',one_pin_test(p,s))

if __name__=='__main__':unittest.main()

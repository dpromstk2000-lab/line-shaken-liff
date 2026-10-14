#!/usr/bin/env python3
"""R196: fail-closed workflow static contract; no network or DB required."""
from pathlib import Path
import unittest
import yaml

FILE=Path('.github/workflows/car02-r194-r196-pg17-savepoint-hold-qa.yml')
PINS={
 'R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql':'3784f8a28549bc40343646bf88657c9d9b0b80f2',
 'car02_r138_pg17_lifecycle_qa.py':'ff98dd74916ff3ea77412b986138151a4fddab90',
 'car02_r159_concurrent_booking_isolated.py':'318921e951cf1578bb00f32eb77f2054ca350ed6',
 'car02_r162_booking_stress_isolated.py':'d6dd3a48a48ffe045ce4ab5df3c2fdd86b3e0e5e',
 'car02_r171_rejection_immutability_isolated.py':'23f082a6b247d26cb772c6eee5084000f12d72a2',
 'car02_r191_transaction_rollback_isolated.py':'7bf3c1b690db14e6dcbe27831d18231488c91d5f',
}
class R196Safety(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
    cls.source=FILE.read_text(encoding='utf-8');cls.low=cls.source.lower()
    cls.spec=yaml.safe_load(cls.source)
    cls.job=cls.spec['jobs']['synthetic-pg17-savepoint-only']
    cls.steps=cls.job['steps']
 def test_manual_only(self):self.assertIn('  workflow_dispatch:',self.source)
 def test_no_push(self):self.assertNotIn('  push:',self.source)
 def test_no_pr(self):self.assertNotIn('  pull_request:',self.source)
 def test_no_schedule(self):self.assertNotIn('  schedule:',self.source)
 def test_permissions(self):self.assertEqual(self.spec['permissions'],{'contents':'read'})
 def test_no_write(self):self.assertNotIn(': write',self.low)
 def test_no_token(self):self.assertNotIn('github.token',self.low)
 def test_no_secrets(self):self.assertNotIn('secrets.',self.low)
 def test_no_id_token(self):self.assertNotIn('id-token:',self.low)
 def test_no_remote(self):
    for s in ('supabase_url','database_url','service_role_key','wrangler','cloudflare','api.line.me'):
       with self.subTest(term=s):self.assertNotIn(s,self.low)
 def test_no_deploy(self):
    for s in ('git push','docker push','supabase db push','npm publish','gh release create','kubectl apply'):
       with self.subTest(term=s):self.assertNotIn(s,self.low)
 def test_pg17(self):self.assertIn('image: postgres:17',self.source)
 def test_ubuntu(self):self.assertEqual(self.job['runs-on'],'ubuntu-24.04')
 def test_timeout(self):self.assertEqual(self.job['timeout-minutes'],20)
 def test_checkout(self):self.assertEqual(self.steps[0]['uses'],'actions/checkout@v5')
 def test_no_checkout_credentials(self):self.assertIs(self.steps[0]['with']['persist-credentials'],False)
 def test_release_lock(self):self.assertEqual(self.job['env']['CAR02_RELEASE_LOCK'],'true')
 def test_qa_lock(self):self.assertEqual(self.job['env']['R194_DISPOSABLE_QA'],'yes')
 def test_old_sha_twice(self):
    for sha in PINS.values():
      with self.subTest(blob=sha):self.assertEqual(self.source.count(sha),2)
 def test_no_fixture_alter(self):self.assertNotIn('ALTER FUNCTION',self.source)
 def test_exact_steps(self):self.assertEqual(len(self.steps),10)
 def test_loop_three_rounds(self):self.assertIn('for round in 1 2 3; do',self.source)
 def test_count_r195(self):self.assertIn('Ran 77 tests in ',self.source)
 def test_self_test(self):self.assertIn('test_car02_r196_workflow_contract.py',self.source)
 def test_real_test(self):self.assertIn('car02_r194_savepoint_atomicity_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.source)
 def test_exact_db(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.source)
 def test_five_empty(self):self.assertIn('for table in bookings service_cases case_operations booking_operations audit_events; do',self.source)
 def test_fixture_inject(self):self.assertIn('< R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.source)
 def test_cleanup_always(self):self.assertEqual(self.steps[7]['if'],'always()')
 def test_cleanup_drop(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.source)
 def test_cleanup_roles(self):self.assertIn('DROP ROLE IF EXISTS $role;',self.source)
 def test_cleanup_attest(self):self.assertIn('R194_ALL_DISPOSABLE_RESOURCES_DELETED',self.source)
 def test_hold_attest(self):self.assertIn('R194_R196_POST_CLEANUP_NO_GO_HOLD_PASS',self.source)
 def test_upload_always(self):self.assertEqual(self.steps[9]['if'],'always()')
 def test_upload_v5(self):self.assertEqual(self.steps[9]['uses'],'actions/upload-artifact@v5')
 def test_short_artifacts(self):self.assertEqual(self.steps[9]['with']['retention-days'],7)
 def test_artifact_path(self):self.assertEqual(self.steps[9]['with']['path'],'qa-evidence-r194/')
 def test_no_cancel(self):self.assertIs(self.spec['concurrency']['cancel-in-progress'],False)
 def test_order(self):
    names=[x['name'] for x in self.steps]
    self.assertLess(names.index('Run R194 real PG17 eight SAVEPOINT and two partial rollback probes'),
                    names.index('Always drop disposable PG17 database and five synthetic users'))
 def test_ten_evidence(self):self.assertIn("len(proof['partialRollbacks'])==len(STEPS)==2",self.source)
 def test_eight_evidence(self):self.assertIn("len(proof['savepointOperations'])==len(OPS)==8",self.source)
 def test_hold(self):self.assertIn("proof['realWorldGatesOpen']==12",self.source)
 def test_action_safety(self):self.assertNotIn('if-no-files-found: ignore',self.source)
 def test_runner_immutable_sql(self):self.assertEqual(self.source.count('CREATE DATABASE car02_r138_qa_ci;'),1)

if __name__=='__main__':unittest.main()

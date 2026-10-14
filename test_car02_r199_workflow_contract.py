#!/usr/bin/env python3
"""R199: fail-closed static contract for isolated R197 PostgreSQL GitHub QA."""
from pathlib import Path
import re
import unittest

WORKFLOW=Path('.github/workflows/car02-r197-r199-pg17-error-recovery-hold-qa.yml')
PINS={
 'R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql':'3784f8a28549bc40343646bf88657c9d9b0b80f2',
 'car02_r138_pg17_lifecycle_qa.py':'ff98dd74916ff3ea77412b986138151a4fddab90',
 'car02_r159_concurrent_booking_isolated.py':'318921e951cf1578bb00f32eb77f2054ca350ed6',
 'car02_r162_booking_stress_isolated.py':'d6dd3a48a48ffe045ce4ab5df3c2fdd86b3e0e5e',
 'car02_r171_rejection_immutability_isolated.py':'23f082a6b247d26cb772c6eee5084000f12d72a2',
 'car02_r191_transaction_rollback_isolated.py':'7bf3c1b690db14e6dcbe27831d18231488c91d5f',
 'car02_r194_savepoint_atomicity_isolated.py':'b30b081cc019692739e8a4182be00bed73ed1ecc',
}
class WorkflowSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src=WORKFLOW.read_text(encoding='utf-8')
        cls.low=cls.src.lower()
        cls.steps=[line.strip() for line in cls.src.splitlines() if line.startswith('      - name: ')]
    def test_manual_only(self):self.assertIn('  workflow_dispatch:',self.src)
    def test_no_push(self):self.assertNotIn('  push:',self.src)
    def test_no_schedule(self):self.assertNotIn('  schedule:',self.src)
    def test_no_pr(self):self.assertNotIn('  pull_request:',self.src)
    def test_readonly(self):self.assertIn('permissions:\n  contents: read\n',self.src)
    def test_no_write(self):self.assertNotIn(': write',self.low)
    def test_no_secrets(self):self.assertNotIn('secrets.',self.low)
    def test_no_token(self):self.assertNotIn('github.token',self.low)
    def test_no_oidc(self):self.assertNotIn('id-token:',self.low)
    def test_pg17(self):self.assertIn('image: postgres:17',self.src)
    def test_ubuntu(self):self.assertIn('runs-on: ubuntu-24.04',self.src)
    def test_timeout(self):self.assertIn('timeout-minutes: 20',self.src)
    def test_checkout_v5(self):self.assertIn('actions/checkout@v5',self.src)
    def test_no_stored_credentials(self):self.assertIn('persist-credentials: false',self.src)
    def test_release_lock(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.src)
    def test_qa_lock(self):self.assertIn("R197_DISPOSABLE_QA: 'yes'",self.src)
    def test_no_remote_resources(self):
        for term in ('supabase_url','service_role_key','database_url','cloudflare','wrangler','api.line.me'):
            with self.subTest(term=term):self.assertNotIn(term,self.low)
    def test_no_deploy(self):
        for term in ('git push','docker push','npm publish','supabase db push','gh release create'):
            with self.subTest(term=term):self.assertNotIn(term,self.low)
    def test_fixed_source_pins(self):
        for sha in PINS.values():self.assertEqual(self.src.count(sha),2)
    def test_no_source_mutation(self):self.assertNotIn('ALTER FUNCTION',self.src)
    def test_3_unit_rounds(self):self.assertIn('for round in 1 2 3; do',self.src)
    def test_exact_unit_count(self):self.assertIn('Ran 113 tests in ',self.src)
    def test_r198_testfile(self):self.assertIn('test_car02_r198_error_recovery.py',self.src)
    def test_r199_selftest(self):self.assertIn('test_car02_r199_workflow_contract.py',self.src)
    def test_exact_db(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.src)
    def test_correct_fixture(self):self.assertIn('< R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.src)
    def test_five_tables_empty(self):self.assertIn('for table in bookings service_cases case_operations booking_operations audit_events; do',self.src)
    def test_exact_probe(self):self.assertIn('car02_r197_error_recovery_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.src)
    def test_exact_eight(self):self.assertIn("len(x['operations'])==len(OPS)==8",self.src)
    def test_always_cleanup(self):
        s=self.src.index('- name: Always delete disposable PG17 database')
        self.assertIn('if: always()',self.src[s:s+140])
    def test_drop_db(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.src)
    def test_drop_roles(self):self.assertIn('DROP ROLE IF EXISTS $role;',self.src)
    def test_cleanup_receipt(self):self.assertIn('R197_ALL_THROWAWAY_RESOURCES_DELETED',self.src)
    def test_final_hold(self):self.assertIn('R197_R199_POST_CLEANUP_NO_GO_HOLD_PASS',self.src)
    def test_upload_always(self):
        s=self.src.index('- name: Preserve short retention')
        self.assertIn('if: always()',self.src[s:s+140])
    def test_upload_v5(self):self.assertIn('actions/upload-artifact@v5',self.src)
    def test_7_day(self):self.assertIn('retention-days: 7',self.src)
    def test_no_cancellation(self):self.assertIn('cancel-in-progress: false',self.src)
    def test_10_steps(self):self.assertEqual(len(self.steps),10)
    def test_step_order(self):
        self.assertLess(self.src.index('- name: Run R197 actual eight'),self.src.index('- name: Always delete disposable'))
        self.assertLess(self.src.index('- name: Always delete disposable'),self.src.index('- name: Verify resource cleanup'))
        self.assertLess(self.src.index('- name: Verify resource cleanup'),self.src.index('- name: Preserve short retention'))
    def test_all_gates_open(self):self.assertIn("x['realWorldGatesOpen']==12",self.src)
    def test_artifact_path(self):self.assertIn('path: qa-evidence-r197/',self.src)
    def test_no_unsafe_run_shells(self):
        self.assertNotIn('curl ',self.src)
        self.assertNotIn('wget ',self.src)
        self.assertNotIn('ssh ',self.src)
    def test_synthetic_job(self):self.assertIn('synthetic-pg17-error-recovery-only:',self.src)

if __name__=='__main__':unittest.main()

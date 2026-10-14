#!/usr/bin/env python3
"""R181 static fail-closed safety checks: disposable DB and immutable source pins."""
from pathlib import Path
import re
import unittest

WORKFLOW = Path('.github/workflows/car02-r179-r181-pg17-replay-identity-hold-qa.yml')
PINS = {
  'R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql': '3784f8a28549bc40343646bf88657c9d9b0b80f2',
  'car02_r138_pg17_lifecycle_qa.py': 'ff98dd74916ff3ea77412b986138151a4fddab90',
  'car02_r159_concurrent_booking_isolated.py': '318921e951cf1578bb00f32eb77f2054ca350ed6',
  'car02_r171_rejection_immutability_isolated.py': '23f082a6b247d26cb772c6eee5084000f12d72a2',
  'car02_r175_booking_boundary_isolated.py': '4a833eb961b1f210a5127a5c86a49ed83ebf3804',
}

class R181WorkflowSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = WORKFLOW.read_text(encoding='utf-8')
        cls.lower = cls.src.lower()
        cls.steps = [x.strip() for x in cls.src.splitlines() if x.startswith('      - name: ')]
    def test_name(self):self.assertIn('R179-R181 PG17 Replay Identity HOLD QA',self.src)
    def test_manual_only(self):self.assertIn('  workflow_dispatch:',self.src)
    def test_no_push(self):self.assertNotIn('  push:',self.src)
    def test_no_pull_request(self):self.assertNotIn('  pull_request:',self.src)
    def test_no_schedule(self):self.assertNotIn('  schedule:',self.src)
    def test_permissions(self):self.assertIn('permissions:\n  contents: read\n',self.src)
    def test_no_write_grants(self):self.assertNotIn(': write',self.lower)
    def test_no_secrets(self):self.assertNotIn('secrets.',self.lower)
    def test_no_token_access(self):self.assertNotIn('github.token',self.lower)
    def test_no_retained_credentials(self):self.assertIn('persist-credentials: false',self.src)
    def test_checkout_v5(self):self.assertIn('actions/checkout@v5',self.src)
    def test_pg17(self):self.assertIn('image: postgres:17',self.src)
    def test_pinned_runner(self):self.assertIn('runs-on: ubuntu-24.04',self.src)
    def test_timeout(self):self.assertIn('timeout-minutes: 20',self.src)
    def test_release_lock_env(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.src)
    def test_disposable_lock_env(self):self.assertIn("R179_DISPOSABLE_QA: 'yes'",self.src)
    def test_no_go_hold_evidence(self):self.assertIn('R179_R181_RELEASE_NO_GO_DB_MIGRATION_HOLD',self.src)
    def test_exact_source_pins(self):
        for file,sha in PINS.items():
            with self.subTest(file=file):
                self.assertEqual(self.src.count('HEAD:'+file),2)
                self.assertEqual(self.src.count(sha),2)
    def test_step_count(self):self.assertEqual(len(self.steps),10)
    def test_three_rounds(self):self.assertIn('for round in 1 2 3; do',self.src)
    def test_sixty_tests(self):self.assertIn('Ran 60 tests in ',self.src)
    def test_no_skip(self):self.assertIn('FAILED|ERROR|skipped=',self.src)
    def test_test_file(self):self.assertIn('test_car02_r180_replay_identity.py',self.src)
    def test_contract_file(self):self.assertIn('test_car02_r181_workflow_contract.py',self.src)
    def test_fixed_disposable_db(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.src)
    def test_fixture_only(self):self.assertIn('R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.src)
    def test_exact_probe_command(self):self.assertIn('car02_r179_replay_identity_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.src)
    def test_5_tables_initially_empty(self):
        for table in ('bookings','service_cases','booking_operations','case_operations','audit_events'):
            self.assertIn(table,self.src)
        self.assertIn('R179_FIVE_SYNTHETIC_TABLES_EMPTY',self.src)
    def test_no_live_host_names(self):
        for keyword in ('supabase_url','database_url','service_role_key','wrangler','cloudflare','api.line.me','owner_token','https://'):
            with self.subTest(keyword=keyword):self.assertNotIn(keyword,self.lower)
    def test_no_deploy(self):
        for keyword in ('git push','docker push','supabase db push','npm publish','gh release create','curl -x post'):
            with self.subTest(keyword=keyword):self.assertNotIn(keyword,self.lower)
    def test_no_schema_mutation(self):self.assertNotIn('ALTER FUNCTION',self.src)
    def test_cleanup_always(self):
        i=self.src.index('- name: Always remove disposable PG17 database')
        self.assertIn('if: always()',self.src[i:i+120])
    def test_drop_exact_db(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.src)
    def test_drop_all_roles(self):
        for role in ('car02_r138_a_staff_ci','car02_r138_a_one_ci','car02_r138_a_two_ci',
                     'car02_r138_b_staff_ci','car02_r138_b_one_ci'):
            self.assertIn(role,self.src)
        self.assertIn('DROP ROLE IF EXISTS $role;',self.src)
    def test_cleanup_attested(self):self.assertIn('R179_ALL_THROWAWAY_RESOURCES_DELETED',self.src)
    def test_cleanup_before_release(self):
        self.assertLess(self.src.index('- name: Always remove disposable PG17 database'),
                        self.src.index('- name: Confirm post cleanup source pins'))
    def test_proof_revalidated_after_cleanup(self):self.assertIn('R179_R181_SYNTHETIC_ONLY_CLEANUP_VERIFIED_NO_GO_HOLD',self.src)
    def test_artifact_always(self):
        i=self.src.index('- name: Preserve seven-day isolated QA artifacts only')
        self.assertIn('if: always()',self.src[i:i+140])
    def test_artifact_retention(self):self.assertIn('retention-days: 7',self.src)
    def test_prevent_cancellation(self):self.assertIn('cancel-in-progress: false',self.src)
    def test_unmodified_sources(self):self.assertIn('FIVE_IMMUTABLE_SOURCE_PINS_PASS',self.src)
    def test_output_in_evidence_only(self):self.assertIn('path: qa-evidence-r179/',self.src)
    def test_gate_count(self):self.assertIn("d['realWorldGatesOpen']==12",self.src)

if __name__=='__main__':unittest.main()

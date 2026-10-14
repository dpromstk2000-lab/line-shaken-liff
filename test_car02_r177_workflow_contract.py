#!/usr/bin/env python3
"""R177 fail-closed workflow contract for R175 synthetic disposable PG17 QA."""
from pathlib import Path
import unittest
FILE=Path('.github/workflows/car02-r175-r177-pg17-booking-boundaries-hold-qa.yml')
class WorkflowSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=FILE.read_text('utf-8');cls.low=cls.source.lower()
        cls.steps=[s.strip() for s in cls.source.splitlines() if s.startswith('      - name: ')]
    def test_manual(self):self.assertIn('  workflow_dispatch:',self.source)
    def test_no_push(self):self.assertNotIn('  push:',self.source)
    def test_no_pr(self):self.assertNotIn('  pull_request:',self.source)
    def test_no_schedule(self):self.assertNotIn('  schedule:',self.source)
    def test_read_only(self):self.assertIn('permissions:\n  contents: read\n',self.source)
    def test_no_write(self):self.assertNotIn(': write',self.low)
    def test_no_secrets(self):self.assertNotIn('secrets.',self.low)
    def test_no_github_token(self):self.assertNotIn('github.token',self.low)
    def test_no_live_db(self):
        for p in ('supabase_url','database_url','service_role_key','api.line.me','wrangler','cloudflare'):
            with self.subTest(p=p):self.assertNotIn(p,self.low)
    def test_no_deploy(self):
        for p in ('git push','docker push','supabase db push','gh release create','npm publish'):
            with self.subTest(p=p):self.assertNotIn(p,self.low)
    def test_only_pg17(self):self.assertIn('image: postgres:17',self.source)
    def test_exact_runner(self):self.assertIn('runs-on: ubuntu-24.04',self.source)
    def test_timeout(self):self.assertIn('timeout-minutes: 20',self.source)
    def test_checkout_v5(self):self.assertIn('actions/checkout@v5',self.source)
    def test_token_not_persisted(self):self.assertIn('persist-credentials: false',self.source)
    def test_lock_env(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.source)
    def test_disposable_env(self):self.assertIn("R175_DISPOSABLE_QA: 'yes'",self.source)
    def test_prev_r138_sql(self):self.assertEqual(self.source.count('3784f8a28549bc40343646bf88657c9d9b0b80f2'),2)
    def test_prev_r138_py(self):self.assertEqual(self.source.count('ff98dd74916ff3ea77412b986138151a4fddab90'),2)
    def test_prev_r171(self):self.assertEqual(self.source.count('23f082a6b247d26cb772c6eee5084000f12d72a2'),2)
    def test_test_rounds(self):self.assertIn('for round in 1 2 3; do',self.source)
    def test_test_count(self):self.assertIn('Ran 79 tests in ',self.source)
    def test_test_guard(self):self.assertIn('test_car02_r176_booking_boundary.py',self.source)
    def test_self_guard(self):self.assertIn('test_car02_r177_workflow_contract.py',self.source)
    def test_correct_db(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.source)
    def test_fixture_pinned(self):self.assertIn('R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.source)
    def test_five_table_empty(self):
        self.assertIn('bookings service_cases booking_operations case_operations audit_events',self.source)
    def test_probe(self):self.assertIn('car02_r175_booking_boundary_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.source)
    def test_cleanup_always(self):
        p=self.source.index('- name: Always drop disposable PG17 database')
        self.assertIn('if: always()',self.source[p:p+130])
    def test_drop(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.source)
    def test_all_roles(self):
        s=self.source
        for n in ('car02_r138_a_staff_ci','car02_r138_a_one_ci','car02_r138_a_two_ci','car02_r138_b_staff_ci','car02_r138_b_one_ci'):
            self.assertIn(n,s)
    def test_prove_cleanup(self):self.assertIn('R175_ALL_DISPOSABLE_RESOURCES_DELETED',self.source)
    def test_hold(self):self.assertIn('R175_R177_RELEASE_NO_GO_DB_MIGRATION_HOLD',self.source)
    def test_post_cleanup_holds(self):self.assertIn('R175_R177_SYNTHETIC_CLEANUP_PASS_RELEASE_NO_GO_DB_HOLD',self.source)
    def test_order(self):
        s=self.source
        self.assertLess(s.index('- name: Always drop disposable PG17 database'),s.index('- name: Confirm clean exit'))
        self.assertLess(s.index('- name: Confirm clean exit'),s.index('- name: Preserve short retention'))
    def test_artifact_always(self):
        p=self.source.index('- name: Preserve short retention')
        self.assertIn('if: always()',self.source[p:p+150])
    def test_artifact_path(self):self.assertIn('path: qa-evidence-r175/',self.source)
    def test_short_artifact(self):self.assertIn('retention-days: 7',self.source)
    def test_10_steps(self):self.assertEqual(len(self.steps),10)
    def test_no_auto_cancel(self):self.assertIn('cancel-in-progress: false',self.source)
    def test_no_source_edits(self):self.assertNotIn('ALTER FUNCTION',self.source)
    def test_expected_release_gates(self):self.assertIn("d['realWorldGatesOpen']==12",self.source)
if __name__=='__main__':unittest.main()

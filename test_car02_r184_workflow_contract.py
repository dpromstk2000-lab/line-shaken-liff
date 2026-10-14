#!/usr/bin/env python3
"""R184: static fail-closed isolation contract for R182 disposable catalog QA."""
from pathlib import Path
import re
import unittest

WORKFLOW=Path('.github/workflows/car02-r182-r184-pg17-catalog-acl-hold-qa.yml')
PINS={
'R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql':'3784f8a28549bc40343646bf88657c9d9b0b80f2',
'car02_r138_pg17_lifecycle_qa.py':'ff98dd74916ff3ea77412b986138151a4fddab90',
'car02_r171_rejection_immutability_isolated.py':'23f082a6b247d26cb772c6eee5084000f12d72a2',
}

class R184Workflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw=WORKFLOW.read_text(encoding='utf-8');cls.lower=cls.raw.lower()
        cls.steps=[s.strip() for s in cls.raw.splitlines() if s.startswith('      - name: ')]
    def test_name(self):self.assertIn('R182-R184 Disposable PG17 Catalog ACL HOLD QA',self.raw)
    def test_dispatch(self):self.assertIn('  workflow_dispatch:',self.raw)
    def test_no_push(self):self.assertNotIn('  push:',self.raw)
    def test_no_pr(self):self.assertNotIn('  pull_request:',self.raw)
    def test_no_schedule(self):self.assertNotIn('  schedule:',self.raw)
    def test_read_permissions(self):self.assertIn('permissions:\n  contents: read\n',self.raw)
    def test_no_write_permissions(self):self.assertNotIn(': write',self.lower)
    def test_no_secret_access(self):self.assertNotIn('secrets.',self.lower)
    def test_no_token_access(self):self.assertNotIn('github.token',self.lower)
    def test_omit_checkout_token(self):self.assertIn('persist-credentials: false',self.raw)
    def test_runner(self):self.assertIn('runs-on: ubuntu-24.04',self.raw)
    def test_checkout_version(self):self.assertIn('uses: actions/checkout@v5',self.raw)
    def test_pg17_service(self):self.assertIn('image: postgres:17',self.raw)
    def test_timeout(self):self.assertIn('timeout-minutes: 20',self.raw)
    def test_release_lock(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.raw)
    def test_disposable_env(self):self.assertIn("R182_DISPOSABLE_QA: 'yes'",self.raw)
    def test_unconditional_no_go(self):self.assertIn('R182_R184_RELEASE_NO_GO_DB_MIGRATION_HOLD',self.raw)
    def test_fixed_db(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.raw)
    def test_exact_fixture(self):self.assertIn('< R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.raw)
    def test_immutability_git_pins(self):
        for path,blob in PINS.items():
            with self.subTest(path=path):
                self.assertEqual(self.raw.count('HEAD:'+path),2)
                self.assertEqual(self.raw.count("= '"+blob+"'"),2)
    def test_three_rounds(self):self.assertIn('for round in 1 2 3; do',self.raw)
    def test_test_count(self):self.assertIn('Ran 89 tests in ',self.raw)
    def test_negative_test_file(self):self.assertIn('test_car02_r183_acl_catalog.py',self.raw)
    def test_safety_test_file(self):self.assertIn('test_car02_r184_workflow_contract.py',self.raw)
    def test_no_skips(self):self.assertIn('FAILED|ERROR|skipped=',self.raw)
    def test_exact_probe(self):self.assertIn('car02_r182_acl_catalog_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.raw)
    def test_five_empty(self):
        for t in ('bookings','service_cases','case_operations','booking_operations','audit_events'):
            with self.subTest(t=t):self.assertIn(t,self.raw)
        self.assertIn('R182_ALL_SYNTHETIC_TABLES_EMPTY',self.raw)
    def test_no_cloud_endpoint(self):
        for name in ('supabase_url','database_url','service_role_key','wrangler','cloudflare','api.line.me','owner_token','https://'):
            with self.subTest(name=name):self.assertNotIn(name,self.lower)
    def test_no_deploy(self):
        for phrase in ('git push','docker push','supabase db push','npm publish','gh release create','curl -x post'):
            with self.subTest(phrase=phrase):self.assertNotIn(phrase,self.lower)
    def test_no_fixture_rewrite(self):self.assertNotIn('ALTER FUNCTION',self.raw)
    def test_cleanup_always(self):
        i=self.raw.index('- name: Always destroy disposable database')
        self.assertIn('if: always()',self.raw[i:i+120])
    def test_drop_db(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.raw)
    def test_drop_roles(self):
        for v in ('car02_r138_a_staff_ci','car02_r138_a_one_ci','car02_r138_a_two_ci',
                  'car02_r138_b_staff_ci','car02_r138_b_one_ci'):
            with self.subTest(v=v):self.assertIn(v,self.raw)
        self.assertIn('DROP ROLE IF EXISTS $role;',self.raw)
    def test_cleanup_verified(self):self.assertIn('R182_ALL_DISPOSABLE_IDENTITIES_AND_DB_DELETED',self.raw)
    def test_cleanup_before_finish(self):
        self.assertLess(self.raw.index('- name: Always destroy disposable database'),
                        self.raw.index('- name: Verify cleanup source pins'))
    def test_evidence_verified(self):self.assertIn('R182_INDEPENDENT_RECHECK_OF_CATALOG_AND_NO_GO_HOLD_PASS',self.raw)
    def test_confirm_hold_post_cleanup(self):self.assertIn('R182_R184_POST_CLEANUP_CATALOG_ACL_QA_PASS_NO_GO_HOLD',self.raw)
    def test_artifact_after_cleanup(self):
        self.assertLess(self.raw.index('- name: Verify cleanup source pins'),
                        self.raw.index('- name: Retain isolated QA evidence seven days'))
    def test_artifact_always(self):
        i=self.raw.index('- name: Retain isolated QA evidence seven days')
        self.assertIn('if: always()',self.raw[i:i+120])
    def test_artifact_seven_days(self):self.assertIn('retention-days: 7',self.raw)
    def test_artifact_scoped(self):self.assertIn('path: qa-evidence-r182/',self.raw)
    def test_step_count(self):self.assertEqual(len(self.steps),10)
    def test_concurrency_no_cancel(self):self.assertIn('cancel-in-progress: false',self.raw)
    def test_real_world_gates_untouched(self):self.assertIn("d['realWorldGatesOpen']==12",self.raw)
    def test_no_prod_claim(self):self.assertIn("d['realRLSVerified'] is False",self.raw)
    def test_pin_recheck_after_cleanup(self):
        self.assertLess(self.raw.index('- name: Always destroy disposable database'),
                        self.raw.rindex('HEAD:R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql'))

if __name__=='__main__': unittest.main()

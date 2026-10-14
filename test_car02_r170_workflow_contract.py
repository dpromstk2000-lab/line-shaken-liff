#!/usr/bin/env python3
"""R170 offline contract: no production access, immutable original, cleanup and HOLD."""
from pathlib import Path
import unittest

W=Path('.github/workflows/car02-r168-r170-pg17-case-lifecycle-race-hold-qa.yml')
class R170Safety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src=W.read_text(encoding='utf-8')
        cls.lower=cls.src.lower()
        cls.steps=[x.strip() for x in cls.src.splitlines() if x.startswith('      - name: ')]
    def test_01_only_manual(self):self.assertIn('  workflow_dispatch:',self.src)
    def test_02_no_push(self):self.assertNotIn('  push:',self.src)
    def test_03_no_pull_request(self):self.assertNotIn('  pull_request:',self.src)
    def test_04_no_cron(self):self.assertNotIn('  schedule:',self.src)
    def test_05_repo_read(self):self.assertIn('permissions:\n  contents: read\n',self.src)
    def test_06_no_write_permission(self):self.assertNotIn(': write',self.lower)
    def test_07_no_secrets(self):self.assertNotIn('secrets.',self.lower)
    def test_08_no_github_token(self):self.assertNotIn('github.token',self.lower)
    def test_09_pg17(self):self.assertIn('image: postgres:17',self.src)
    def test_10_checkout(self):self.assertIn('actions/checkout@v5',self.src)
    def test_11_no_retained_token(self):self.assertIn('persist-credentials: false',self.src)
    def test_12_runner(self):self.assertIn('runs-on: ubuntu-24.04',self.src)
    def test_13_timeout(self):self.assertIn('timeout-minutes: 20',self.src)
    def test_14_release_locked(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.src)
    def test_15_fixture_locked(self):self.assertIn("R168_DISPOSABLE_QA: 'yes'",self.src)
    def test_16_r138_original_pin(self):self.assertEqual(self.src.count('3784f8a28549bc40343646bf88657c9d9b0b80f2'),2)
    def test_17_r138_helper_pin(self):self.assertEqual(self.src.count('ff98dd74916ff3ea77412b986138151a4fddab90'),2)
    def test_18_r159_pin(self):self.assertEqual(self.src.count('318921e951cf1578bb00f32eb77f2054ca350ed6'),2)
    def test_19_r162_pin(self):self.assertEqual(self.src.count('d6dd3a48a48ffe045ce4ab5df3c2fdd86b3e0e5e'),2)
    def test_20_r165_pin(self):self.assertEqual(self.src.count('ce9c2a3e1b2dae378ea97e097a5738868f18a19f'),2)
    def test_21_no_schema_mutation(self):self.assertNotIn('ALTER FUNCTION',self.src)
    def test_22_three_unit_rounds(self):self.assertIn('for round in 1 2 3; do',self.src)
    def test_23_tests_count(self):self.assertIn('Ran 71 tests in ',self.src)
    def test_24_tests_name(self):self.assertIn('test_car02_r169_case_race.py',self.src)
    def test_25_safety_name(self):self.assertIn('test_car02_r170_workflow_contract.py',self.src)
    def test_26_db_create(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.src)
    def test_27_fixture_sql(self):self.assertIn('R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.src)
    def test_28_excludes_service_secrets(self):
        for bad in ('supabase_url','database_url','service_role_key','wrangler','cloudflare','api.line.me','owner_token'):
            with self.subTest(phrase=bad):self.assertNotIn(bad,self.lower)
    def test_29_excludes_remote_mutations(self):
        for bad in ('git push','docker push','supabase db push','npm publish','gh release create','curl -x post'):
            with self.subTest(phrase=bad):self.assertNotIn(bad,self.lower)
    def test_30_exact_probe(self):self.assertIn('car02_r168_case_race_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.src)
    def test_31_empty_db(self):self.assertIn('R168_DISPOSABLE_EMPTY_FIXTURE_PASS',self.src)
    def test_32_cleanup_always(self):
        p=self.src.index('- name: Always remove disposable PostgreSQL database')
        self.assertIn('if: always()',self.src[p:p+120])
    def test_33_db_deleted(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.src)
    def test_34_all_roles_deleted(self):self.assertIn('DROP ROLE IF EXISTS $role;',self.src)
    def test_35_delete_receipt(self):self.assertIn('R168_ALL_DISPOSABLE_RESOURCES_DELETED',self.src)
    def test_36_release_hold_receipt(self):self.assertIn('R168_R170_DISPOSABLE_CASE_LIFECYCLE_QA_CLEANUP_PASS_NO_GO_HOLD',self.src)
    def test_37_cleanup_before_verify(self):self.assertLess(self.src.index('- name: Always remove disposable PostgreSQL database'),self.src.index('- name: Verify cleanup source integrity'))
    def test_38_upload_after_cleanup(self):self.assertLess(self.src.index('- name: Verify cleanup source integrity'),self.src.index('- name: Preserve synthetic test artifacts'))
    def test_39_artifact_always(self):
        p=self.src.index('- name: Preserve synthetic test artifacts')
        self.assertIn('if: always()',self.src[p:p+110])
    def test_40_short_retention(self):self.assertIn('retention-days: 7',self.src)
    def test_41_exact_steps(self):self.assertEqual(len(self.steps),10)
    def test_42_no_cancel(self):self.assertIn('cancel-in-progress: false',self.src)
    def test_43_open_gates(self):self.assertIn("report['realWorldGatesOpen']==12",self.src)
    def test_44_no_auth_proof(self):self.assertIn("report['realAuthenticationVerified'] is False",self.src)
    def test_45_no_prod_rls_proof(self):self.assertIn("report['realRLSVerified'] is False",self.src)
    def test_46_artifact_only(self):self.assertIn('path: qa-evidence-r168/',self.src)
if __name__=='__main__':unittest.main()

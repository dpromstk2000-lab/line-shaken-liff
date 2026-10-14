#!/usr/bin/env python3
"""R161 static fail-closed no-production-access gate for R159 disposable workflow."""
from pathlib import Path
import unittest

FILE=Path('.github/workflows/car02-r159-r161-pg17-booking-concurrency-hold-qa.yml')

class SafeWorkflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=FILE.read_text(encoding='utf-8');cls.lower=cls.source.lower()
        cls.steps=[line.strip() for line in cls.source.splitlines() if line.startswith('      - name: ')]
    def test_01_manual_only(self):self.assertIn('  workflow_dispatch:',self.source)
    def test_02_never_push(self):self.assertNotIn('  push:',self.source)
    def test_03_never_schedule(self):self.assertNotIn('  schedule:',self.source)
    def test_04_no_pr_trigger(self):self.assertNotIn('  pull_request:',self.source)
    def test_05_read_only(self):self.assertIn('permissions:\n  contents: read\n',self.source)
    def test_06_no_write_grants(self):
        for k in ('contents','packages','actions','deployments','id-token','issues'):
            with self.subTest(k=k):self.assertNotIn(k+': write',self.lower)
    def test_07_no_secrets(self):self.assertNotIn('secrets.',self.lower)
    def test_08_no_github_token(self):self.assertNotIn('github.token',self.lower)
    def test_09_no_production_endpoints(self):
        for k in ('supabase_url','database_url','service_role_key','api.line.me','wrangler','cloudflare','owner_token'):
            with self.subTest(k=k):self.assertNotIn(k,self.lower)
    def test_10_no_deploy_commands(self):
        for k in ('git push','docker push','supabase db push','gh release create','npm publish','curl -x post'):
            with self.subTest(k=k):self.assertNotIn(k,self.lower)
    def test_11_disposable_pg17(self):self.assertIn('image: postgres:17',self.source)
    def test_12_checkout_without_token(self):self.assertIn('persist-credentials: false',self.source)
    def test_13_runner_pinned(self):self.assertIn('runs-on: ubuntu-24.04',self.source)
    def test_14_timeout(self):self.assertIn('timeout-minutes: 20',self.source)
    def test_15_disposable_lock(self):self.assertIn("R159_DISPOSABLE_QA: 'yes'",self.source)
    def test_16_release_lock(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.source)
    def test_17_fixture_sha(self):self.assertIn('6453a322cf6ab96ca00a22c8b83babadd6499f5a0ad3016616e7eabc80edb374',self.source)
    def test_18_source_sha(self):self.assertIn('64c7d9ff4aefff0df65e05371c32555124351ac60a4bc7831feb52160bd2a7e7',self.source)
    def test_19_sha_checked_twice(self):self.assertEqual(self.source.count('sha256sum -c -'),4)
    def test_20_r160_three_rounds(self):self.assertIn('for round in 1 2 3; do',self.source)
    def test_21_r160_55(self):self.assertIn('Ran 55 tests in ',self.source)
    def test_22_r161_self_check(self):self.assertIn('test_car02_r161_workflow_contract.py',self.source)
    def test_23_qa_no_db_source_modification(self):self.assertNotIn('ALTER FUNCTION',self.source)
    def test_24_exact_pg_name(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.source)
    def test_25_fixture_only(self):self.assertIn('R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.source)
    def test_26_real_probe(self):self.assertIn('car02_r159_concurrent_booking_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.source)
    def test_27_safe_cleanup_always(self):
        s=self.source[self.source.index('- name: Remove disposable PG17 database'):]
        self.assertIn('if: always()',s[:120])
    def test_28_force_delete(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.source)
    def test_29_cleanup_all_roles(self):self.assertIn('DROP ROLE IF EXISTS $role;',self.source)
    def test_30_post_cleanup_check(self):self.assertIn('R159_ALL_DISPOSABLE_RESOURCES_DELETED',self.source)
    def test_31_hold_logged(self):self.assertIn('R159_R161_RELEASE_NO_GO_DB_MIGRATION_HOLD',self.source)
    def test_32_post_cleanup_proof(self):self.assertIn('R159_R161_DISPOSABLE_CONCURRENCY_CLEANUP_PASS_NO_GO_HOLD',self.source)
    def test_33_artifact_always(self):
        s=self.source[self.source.index('- name: Preserve isolated QA evidence only'):]
        self.assertIn('if: always()',s[:110])
    def test_34_artifact_retention(self):self.assertIn('retention-days: 7',self.source)
    def test_35_non_cancelling(self):self.assertIn('cancel-in-progress: false',self.source)
    def test_36_no_long_retention(self):self.assertNotIn('retention-days: 90',self.source)
    def test_37_exact_workflow_steps(self):self.assertEqual(len(self.steps),9)
    def test_38_cleanup_before_finalize(self):self.assertLess(self.source.index('- name: Remove disposable PG17 database'),self.source.index('- name: Independently confirm post-cleanup'))
    def test_39_verify_before_upload(self):self.assertLess(self.source.index('- name: Independently confirm post-cleanup'),self.source.index('- name: Preserve isolated QA evidence only'))
    def test_40_no_prod_gates_closure(self):self.assertIn("report['realWorldGatesOpen']==12",self.source)

if __name__=='__main__':unittest.main()

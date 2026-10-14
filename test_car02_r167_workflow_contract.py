#!/usr/bin/env python3
"""R167: fail-closed static contract for NEW isolated R165-R167 workflow only."""
from pathlib import Path
import unittest

FILE=Path('.github/workflows/car02-r165-r167-pg17-interleaving-hold-qa.yml')
class R167Workflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=FILE.read_text(encoding='utf-8')
        cls.lower=cls.source.lower()
        cls.steps=[line.strip() for line in cls.source.splitlines() if line.startswith('      - name: ')]
    def test_01_manual_only(self):self.assertIn('  workflow_dispatch:',self.source)
    def test_02_no_push(self):self.assertNotIn('  push:',self.source)
    def test_03_no_pr_trigger(self):self.assertNotIn('  pull_request:',self.source)
    def test_04_no_schedule(self):self.assertNotIn('  schedule:',self.source)
    def test_05_no_deploy_trigger(self):self.assertNotIn('deployment_status:',self.source)
    def test_06_read_permissions(self):self.assertIn('permissions:\n  contents: read\n',self.source)
    def test_07_write_forbidden(self):self.assertNotIn(': write',self.lower)
    def test_08_no_secret_reference(self):self.assertNotIn('secrets.',self.lower)
    def test_09_no_github_token(self):self.assertNotIn('github.token',self.lower)
    def test_10_disposable_pg17(self):self.assertIn('image: postgres:17',self.source)
    def test_11_no_public_pg_port(self):self.assertNotIn('ports:',self.source)
    def test_12_no_prod_url(self):
        for token in ('supabase_url','database_url','service_role_key','api.line.me','wrangler','cloudflare','prod_db','postgrest'):
            with self.subTest(token=token):self.assertNotIn(token,self.lower)
    def test_13_no_deploy_commands(self):
        for cmd in ('git push','docker push','supabase db push','npm publish','gh release create','terraform apply','wrangler deploy'):
            with self.subTest(cmd=cmd):self.assertNotIn(cmd,self.lower)
    def test_14_readonly_checkout(self):self.assertIn('persist-credentials: false',self.source)
    def test_15_checkout_v5(self):self.assertIn('actions/checkout@v5',self.source)
    def test_16_runner_pinned(self):self.assertIn('runs-on: ubuntu-24.04',self.source)
    def test_17_timeout(self):self.assertIn('timeout-minutes: 20',self.source)
    def test_18_hold_env(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.source)
    def test_19_disposable_env(self):self.assertIn("R165_DISPOSABLE_QA: 'yes'",self.source)
    def test_20_no_autocancel(self):self.assertIn('cancel-in-progress: false',self.source)
    def test_21_fixture_blob_twice(self):self.assertEqual(self.source.count('3784f8a28549bc40343646bf88657c9d9b0b80f2'),2)
    def test_22_helper_blob_twice(self):self.assertEqual(self.source.count('ff98dd74916ff3ea77412b986138151a4fddab90'),2)
    def test_23_r159_blob_twice(self):self.assertEqual(self.source.count('318921e951cf1578bb00f32eb77f2054ca350ed6'),2)
    def test_24_r162_blob_twice(self):self.assertEqual(self.source.count('d6dd3a48a48ffe045ce4ab5df3c2fdd86b3e0e5e'),2)
    def test_25_new_evidence_directory(self):self.assertIn('mkdir -p qa-evidence-r165',self.source)
    def test_26_only_known_db(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.source)
    def test_27_fixture_filename(self):self.assertIn('R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.source)
    def test_28_no_source_mutation(self):self.assertNotIn('ALTER FUNCTION',self.source)
    def test_29_no_migration(self):self.assertNotIn('CREATE EXTENSION',self.source)
    def test_30_probes_count(self):self.assertIn('for round in 1 2 3; do',self.source)
    def test_31_old_test_files(self):
        self.assertIn('test_car02_r160_concurrency_contract.py',self.source)
        self.assertIn('test_car02_r163_booking_stress.py',self.source)
    def test_32_new_test_file(self):self.assertIn('test_car02_r166_interleaving.py',self.source)
    def test_33_old_new_test_count(self):self.assertIn('Ran 177 tests in ',self.source)
    def test_34_workflow_checks_self(self):self.assertIn('test_car02_r167_workflow_contract.py',self.source)
    def test_35_exact_steps(self):self.assertEqual(len(self.steps),10)
    def test_36_exact_probe(self):self.assertIn('car02_r165_interleaving_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.source)
    def test_37_empty_all_five_tables(self):
        self.assertIn('bookings service_cases booking_operations case_operations audit_events',self.source)
    def test_38_cleanup_always(self):
        start=self.source.index('- name: Always delete only disposable PG17 database')
        self.assertIn('if: always()',self.source[start:start+140])
    def test_39_exact_drop(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.source)
    def test_40_role_drop(self):self.assertIn('DROP ROLE IF EXISTS $role;',self.source)
    def test_41_cleanup_attest(self):self.assertIn('R165_ALL_DISPOSABLE_RESOURCES_DELETED',self.source)
    def test_42_cleanup_before_final(self):
        self.assertLess(self.source.index('- name: Always delete only disposable PG17 database'),
                        self.source.index('- name: Recheck source pins receipt'))
    def test_43_only_upload_after_final(self):
        self.assertLess(self.source.index('- name: Recheck source pins receipt'),
                        self.source.index('- name: Preserve short-lived isolated'))
    def test_44_upload_always(self):
        pos=self.source.index('- name: Preserve short-lived isolated')
        self.assertIn('if: always()',self.source[pos:pos+140])
    def test_45_artifact_7_days(self):self.assertIn('retention-days: 7',self.source)
    def test_46_no_long_retention(self):self.assertNotIn('retention-days: 90',self.source)
    def test_47_release_hold_asserted(self):self.assertIn('R165_R167_RELEASE_NO_GO_DB_MIGRATION_HOLD',self.source)
    def test_48_real_gates_open(self):self.assertIn("report['realWorldGatesOpen']==12",self.source)
    def test_49_no_real_auth_claim(self):self.assertIn("report['realAuthenticationVerified'] is False",self.source)
    def test_50_evidence_location(self):self.assertIn('path: qa-evidence-r165/',self.source)

if __name__=='__main__':unittest.main()

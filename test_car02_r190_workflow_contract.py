#!/usr/bin/env python3
"""R190: fail-closed static contract for the new disposable PostgreSQL QA workflow."""
from pathlib import Path
import unittest

FILE=Path('.github/workflows/car02-r188-r190-pg17-role-escalation-hold-qa.yml')

class R190Workflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src=FILE.read_text(encoding='utf-8')
        cls.low=cls.src.lower()
        cls.steps=[line.strip() for line in cls.src.splitlines() if line.startswith('      - name: ')]
    def test_01_manual(self):self.assertIn('  workflow_dispatch:',self.src)
    def test_02_not_push(self):self.assertNotIn('  push:',self.src)
    def test_03_not_schedule(self):self.assertNotIn('  schedule:',self.src)
    def test_04_not_pull_request(self):self.assertNotIn('  pull_request:',self.src)
    def test_05_readonly(self):self.assertIn('permissions:\n  contents: read\n',self.src)
    def test_06_no_write_perms(self):self.assertNotIn(': write',self.low)
    def test_07_no_secrets(self):self.assertNotIn('secrets.',self.low)
    def test_08_no_github_token(self):self.assertNotIn('github.token',self.low)
    def test_09_no_supabase_url(self):self.assertNotIn('supabase_url',self.low)
    def test_10_no_database_url(self):self.assertNotIn('database_url',self.low)
    def test_11_no_service_role_key(self):self.assertNotIn('service_role_key',self.low)
    def test_12_no_cloudflare(self):self.assertNotIn('cloudflare',self.low)
    def test_13_no_wrangler(self):self.assertNotIn('wrangler',self.low)
    def test_14_no_live_line(self):self.assertNotIn('api.line.me',self.low)
    def test_15_no_deploy(self):
        for term in ('git push','docker push','supabase db push','npm publish','gh release create'):
            with self.subTest(term=term):self.assertNotIn(term,self.low)
    def test_16_pg17(self):self.assertIn('image: postgres:17',self.src)
    def test_17_ubuntu(self):self.assertIn('runs-on: ubuntu-24.04',self.src)
    def test_18_timeout(self):self.assertIn('timeout-minutes: 20',self.src)
    def test_19_checkout(self):self.assertIn('actions/checkout@v5',self.src)
    def test_20_no_retained_token(self):self.assertIn('persist-credentials: false',self.src)
    def test_21_release_lock(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.src)
    def test_22_isolation_lock(self):self.assertIn("R188_DISPOSABLE_QA: 'yes'",self.src)
    def test_23_sql_pin(self):self.assertEqual(self.src.count('3784f8a28549bc40343646bf88657c9d9b0b80f2'),2)
    def test_24_helper_pin(self):self.assertEqual(self.src.count('ff98dd74916ff3ea77412b986138151a4fddab90'),2)
    def test_25_catalog_pin(self):self.assertEqual(self.src.count('e63558a7fca0684e4f144d61363fc3b3b9db9718'),2)
    def test_26_session_pin(self):self.assertEqual(self.src.count('9900472e32d4af13804657149c9429d8b3495437'),2)
    def test_27_originals_unchanged(self):self.assertNotIn('ALTER FUNCTION',self.src)
    def test_28_three_unit_rounds(self):self.assertIn('for round in 1 2 3; do',self.src)
    def test_29_exact_unit_count(self):self.assertIn('Ran 95 tests in ',self.src)
    def test_30_unit_filename(self):self.assertIn('test_car02_r189_role_escalation.py',self.src)
    def test_31_self_file(self):self.assertIn('test_car02_r190_workflow_contract.py',self.src)
    def test_32_fresh_database(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.src)
    def test_33_exact_fixture(self):self.assertIn('R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.src)
    def test_34_all_five_empty(self):self.assertIn('for table in bookings service_cases case_operations booking_operations audit_events; do',self.src)
    def test_35_exact_probe(self):self.assertIn('car02_r188_role_escalation_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.src)
    def test_36_check_denials(self):self.assertIn("len(x['denials'])==len(CASE_MATRIX)==40",self.src)
    def test_37_always_cleanup(self):
        i=self.src.index('- name: Always drop disposable database')
        self.assertIn('if: always()',self.src[i:i+120])
    def test_38_drop_database(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.src)
    def test_39_drop_all_roles(self):self.assertIn('DROP ROLE IF EXISTS $role;',self.src)
    def test_40_check_deleted(self):self.assertIn('R188_ALL_DISPOSABLE_RESOURCES_DELETED',self.src)
    def test_41_final_hold(self):self.assertIn('R188_R190_ISOLATED_CLEANUP_NO_GO_HOLD_PASS',self.src)
    def test_42_final_twice_pins(self):self.assertIn('- name: Recheck original identities and NO GO HOLD after cleanup',self.src)
    def test_43_upload_always(self):
        i=self.src.index('- name: Preserve only isolated short retention evidence')
        self.assertIn('if: always()',self.src[i:i+135])
    def test_44_retention_seven(self):self.assertIn('retention-days: 7',self.src)
    def test_45_upload_v5_node24(self):self.assertIn('actions/upload-artifact@v5',self.src)
    def test_46_no_cancellation(self):self.assertIn('cancel-in-progress: false',self.src)
    def test_47_ten_steps(self):self.assertEqual(len(self.steps),10)
    def test_48_order_cleanup(self):self.assertLess(self.src.index('- name: Run R188 actual PG17'),self.src.index('- name: Always drop disposable database'))
    def test_49_order_final(self):self.assertLess(self.src.index('- name: Always drop disposable database'),self.src.index('- name: Recheck original identities'))
    def test_50_order_artifact(self):self.assertLess(self.src.index('- name: Recheck original identities'),self.src.index('- name: Preserve only isolated'))
    def test_51_no_live_gates_closed(self):self.assertIn("r['realWorldGatesOpen']==12",self.src)
    def test_52_only_synthetic_path(self):self.assertIn('path: qa-evidence-r188/',self.src)
    def test_53_same_commit(self):self.assertIn("x['githubCommit']==os.environ['GITHUB_SHA']",self.src)

if __name__=='__main__':unittest.main()

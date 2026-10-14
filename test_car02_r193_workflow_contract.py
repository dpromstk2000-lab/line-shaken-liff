#!/usr/bin/env python3
"""R193: read-only disposable PG17 GitHub workflow static release-lock contract."""
from pathlib import Path
import re
import subprocess
import unittest
import yaml

FILE=Path('.github/workflows/car02-r191-r193-pg17-transaction-rollback-hold-qa.yml')
PINS={
 'R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql':'3784f8a28549bc40343646bf88657c9d9b0b80f2',
 'car02_r138_pg17_lifecycle_qa.py':'ff98dd74916ff3ea77412b986138151a4fddab90',
 'car02_r159_concurrent_booking_isolated.py':'318921e951cf1578bb00f32eb77f2054ca350ed6',
 'car02_r162_booking_stress_isolated.py':'d6dd3a48a48ffe045ce4ab5df3c2fdd86b3e0e5e',
 'car02_r171_rejection_immutability_isolated.py':'23f082a6b247d26cb772c6eee5084000f12d72a2',
}
class R193Safe(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text=FILE.read_text(encoding='utf-8');cls.low=cls.text.lower()
        cls.spec=yaml.safe_load(cls.text)
        cls.steps=cls.spec['jobs']['synthetic-pg17-rollback-only']['steps']
        cls.bash=[s['run'] for s in cls.steps if 'run' in s]
    def test_01_on_manual(self):self.assertIn('  workflow_dispatch:',self.text)
    def test_02_no_push(self):self.assertNotIn('  push:',self.text)
    def test_03_no_cron(self):self.assertNotIn('  schedule:',self.text)
    def test_04_no_pr(self):self.assertNotIn('  pull_request:',self.text)
    def test_05_read_only(self):self.assertIn('permissions:\n  contents: read\n',self.text)
    def test_06_no_write_permission(self):self.assertNotIn(': write',self.low)
    def test_07_no_secrets(self):self.assertNotIn('secrets.',self.low)
    def test_08_no_id_token(self):self.assertNotIn('id-token:',self.low)
    def test_09_no_token_env(self):self.assertNotIn('github.token',self.low)
    def test_10_no_remote_supabase(self):
        for s in ('supabase_url','service_role_key','database_url','supabase db push'):
            self.assertNotIn(s,self.low)
    def test_11_no_remote_worker(self):
        for s in ('wrangler','cloudflare','api.line.me'):
            self.assertNotIn(s,self.low)
    def test_12_no_deploy(self):
        for s in ('docker push','git push','npm publish','gh release create','kubectl apply'):
            self.assertNotIn(s,self.low)
    def test_13_exact_postgres(self):self.assertIn('image: postgres:17',self.text)
    def test_14_ubuntu(self):self.assertIn('runs-on: ubuntu-24.04',self.text)
    def test_15_timeout(self):self.assertIn('timeout-minutes: 20',self.text)
    def test_16_checkout(self):self.assertIn('actions/checkout@v5',self.text)
    def test_17_no_credentials(self):self.assertIn('persist-credentials: false',self.text)
    def test_18_release_lock(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.text)
    def test_19_qa_lock(self):self.assertIn("R191_DISPOSABLE_QA: 'yes'",self.text)
    def test_20_unchanged_pins(self):
        for sha in PINS.values():self.assertEqual(self.text.count(sha),2)
    def test_21_no_alter_function(self):self.assertNotIn('ALTER FUNCTION',self.text)
    def test_22_r192_three_rounds(self):self.assertIn('for round in 1 2 3; do',self.text)
    def test_23_r192_exact_cases(self):self.assertIn('Ran 67 tests in ',self.text)
    def test_24_r192_test_file(self):self.assertIn('test_car02_r192_transaction_rollback.py',self.text)
    def test_25_r193_self_check(self):self.assertIn('test_car02_r193_workflow_contract.py',self.text)
    def test_26_created_exact_db(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.text)
    def test_27_exact_fixture(self):self.assertIn('< R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.text)
    def test_28_empty_five_tables(self):self.assertIn('for table in bookings service_cases case_operations booking_operations audit_events; do',self.text)
    def test_29_exact_probe(self):self.assertIn('car02_r191_transaction_rollback_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.text)
    def test_30_eight_results(self):self.assertIn("len(r['operations'])==len(OPS)==8",self.text)
    def test_31_dropped_always(self):
        i=self.text.index('- name: Always delete disposable PG17 database');self.assertIn('if: always()',self.text[i:i+140])
    def test_32_force_drop(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.text)
    def test_33_drop_five_roles(self):self.assertIn('DROP ROLE IF EXISTS $role;',self.text)
    def test_34_confirm_deleted(self):self.assertIn('R191_ALL_THROWAWAY_RESOURCES_DELETED',self.text)
    def test_35_cleanup_hard_fails(self):self.assertIn('R191_CLEANUP_FAILED',self.text)
    def test_36_final_hold(self):self.assertIn('R191_R193_POST_CLEANUP_NO_GO_HOLD_PASS',self.text)
    def test_37_artifact_always(self):
        i=self.text.index('- name: Preserve only synthetic short retention QA evidence')
        self.assertIn('if: always()',self.text[i:i+130])
    def test_38_retention(self):self.assertIn('retention-days: 7',self.text)
    def test_39_node24_artifact(self):self.assertIn('actions/upload-artifact@v5',self.text)
    def test_40_no_cancel(self):self.assertIn('cancel-in-progress: false',self.text)
    def test_41_ten_steps(self):self.assertEqual(len(self.steps),10)
    def test_42_cleanup_before_final(self):
        self.assertLess(self.text.index('- name: Always delete disposable'),self.text.index('- name: Recheck original source identities'))
    def test_43_final_before_upload(self):
        self.assertLess(self.text.index('- name: Recheck original source identities'),self.text.index('- name: Preserve only synthetic'))
    def test_44_gates_still_open(self):self.assertIn("r['realWorldGatesOpen']==12",self.text)
    def test_45_artifact_path_only(self):self.assertIn('path: qa-evidence-r191/',self.text)
    def test_46_commit_link(self):self.assertIn("r['githubCommit']==os.environ['GITHUB_SHA']",self.text)
    def test_47_yaml_parser(self):self.assertIsInstance(self.spec,dict)
    def test_48_shell_bash_parses(self):
        self.assertEqual(len(self.bash),8)
        for i,body in enumerate(self.bash):
            with self.subTest(i=i):
                cmd=subprocess.run(['bash','-n'],input=body,text=True,capture_output=True)
                self.assertEqual(cmd.returncode,0,cmd.stderr)
    def test_49_no_writes_to_repository(self):self.assertNotIn('git commit',self.low)
    def test_50_only_manual_event(self):
        # PyYAML 1.1 treats the YAML key 'on' as boolean True; check literal source.
        self.assertEqual(self.text.count('  workflow_dispatch:'),1)
    def test_51_exact_roles(self):
        self.assertIn('car02_r138_b_one_ci',self.text)
    def test_52_only_disposable_evidence(self):self.assertIn('qa-evidence-r191/',self.text)
    def test_53_only_one_service(self):self.assertEqual(len(self.spec['jobs']['synthetic-pg17-rollback-only']['services']),1)

if __name__=='__main__':unittest.main()

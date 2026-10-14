#!/usr/bin/env python3
"""R202: static fail-closed workflow lock, cleanup and source protection QA."""
from pathlib import Path
import re
import subprocess
import unittest
import yaml

FILE=Path('.github/workflows/car02-r200-r202-pg17-lock-timeout-hold-qa.yml')
PINS={
 'R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql':'3784f8a28549bc40343646bf88657c9d9b0b80f2',
 'car02_r138_pg17_lifecycle_qa.py':'ff98dd74916ff3ea77412b986138151a4fddab90',
 'car02_r159_concurrent_booking_isolated.py':'318921e951cf1578bb00f32eb77f2054ca350ed6',
 'car02_r171_rejection_immutability_isolated.py':'23f082a6b247d26cb772c6eee5084000f12d72a2',
 'car02_r188_role_escalation_isolated.py':'d61fc9d6d2248e1851187a6b20dea4184fea564d',
 'car02_r191_transaction_rollback_isolated.py':'7bf3c1b690db14e6dcbe27831d18231488c91d5f',
 'car02_r194_savepoint_atomicity_isolated.py':'b30b081cc019692739e8a4182be00bed73ed1ecc',
 'car02_r197_error_recovery_isolated.py':'561a282301a5133f37881a04a8459a0ca87b05e1',
}
class R202Workflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src=FILE.read_text(encoding='utf-8');cls.low=cls.src.lower()
        cls.spec=yaml.safe_load(cls.src)
        cls.steps=cls.spec['jobs']['synthetic-pg17-row-lock-only']['steps']
        cls.scripts=[s['run'] for s in cls.steps if 'run' in s]
    def test_01_manual(self):self.assertIn('  workflow_dispatch:',self.src)
    def test_02_not_push(self):self.assertNotIn('  push:',self.src)
    def test_03_not_pull_request(self):self.assertNotIn('  pull_request:',self.src)
    def test_04_not_schedule(self):self.assertNotIn('  schedule:',self.src)
    def test_05_permissions_read(self):self.assertIn('permissions:\n  contents: read\n',self.src)
    def test_06_no_write_permission(self):self.assertNotIn(': write',self.low)
    def test_07_no_deploy(self):
        for term in ('git push','docker push','supabase db push','npm publish','gh release create','kubectl apply'):
            with self.subTest(term=term):self.assertNotIn(term,self.low)
    def test_08_no_secrets(self):self.assertNotIn('secrets.',self.low)
    def test_09_no_id_token(self):self.assertNotIn('id-token:',self.low)
    def test_10_no_remote_database(self):
        for term in ('supabase_url','database_url','service_role_key','pgbouncer','supabase.com'):
            with self.subTest(term=term):self.assertNotIn(term,self.low)
    def test_11_no_cloudflare(self):
        for term in ('wrangler','cloudflare','api.line.me'):
            with self.subTest(term=term):self.assertNotIn(term,self.low)
    def test_12_no_token_env(self):self.assertNotIn('github.token',self.low)
    def test_13_pg17(self):self.assertIn('image: postgres:17',self.src)
    def test_14_runner(self):self.assertIn('runs-on: ubuntu-24.04',self.src)
    def test_15_timeout(self):self.assertIn('timeout-minutes: 20',self.src)
    def test_16_checkout(self):self.assertIn('actions/checkout@v5',self.src)
    def test_17_no_stored_credentials(self):self.assertIn('persist-credentials: false',self.src)
    def test_18_release_lock(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.src)
    def test_19_qa_lock(self):self.assertIn("R200_DISPOSABLE_QA: 'yes'",self.src)
    def test_20_three_rounds(self):self.assertIn('for round in 1 2 3; do',self.src)
    def test_21_exact_r201_count(self):self.assertIn('Ran 86 tests in ',self.src)
    def test_22_r201_filename(self):self.assertIn('test_car02_r201_lock_timeout.py',self.src)
    def test_23_r202_filename(self):self.assertIn('test_car02_r202_workflow_contract.py',self.src)
    def test_24_exact_database(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.src)
    def test_25_exact_fixture(self):self.assertIn('< R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.src)
    def test_26_all_five_empty(self):self.assertIn('for table in bookings service_cases case_operations booking_operations audit_events; do',self.src)
    def test_27_sql_guard(self):self.assertNotIn('ALTER FUNCTION',self.src)
    def test_28_no_schema_overwrite(self):self.assertNotIn('DROP SCHEMA public',self.src)
    def test_29_exact_probe(self):self.assertIn('car02_r200_lock_timeout_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.src)
    def test_30_expected_four(self):self.assertIn("len(r['scenarios'])==len(SCENARIOS)==4",self.src)
    def test_31_proof_hash(self):self.assertIn('verify_report(r)',self.src)
    def test_32_true_pg_lock(self):self.assertIn("'55P03'",self.src)
    def test_33_no_cancellation(self):self.assertIn('cancel-in-progress: false',self.src)
    def test_34_cleanup_always(self):
        step=next(s for s in self.steps if s['name'].startswith('Always delete disposable'))
        self.assertEqual(step['if'],'always()')
    def test_35_drop_database(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.src)
    def test_36_drop_roles(self):self.assertIn('DROP ROLE IF EXISTS $role;',self.src)
    def test_37_cleanup_confirm(self):self.assertIn('R200_ALL_THROWAWAY_RESOURCES_DELETED',self.src)
    def test_38_hold_final(self):self.assertIn('R200_R202_DISPOSABLE_CLEANUP_NO_GO_HOLD_PASS',self.src)
    def test_39_upload_always(self):
        step=next(s for s in self.steps if s['name'].startswith('Preserve only'))
        self.assertEqual(step['if'],'always()')
    def test_40_upload_v5(self):self.assertIn('actions/upload-artifact@v5',self.src)
    def test_41_artifact_retention(self):self.assertIn('retention-days: 7',self.src)
    def test_42_artifact_path(self):self.assertIn('path: qa-evidence-r200/',self.src)
    def test_43_exact_step_count(self):self.assertEqual(len(self.steps),10)
    def test_44_cleanup_before_final(self):
        self.assertLess(self.src.index('- name: Always delete disposable'),self.src.index('- name: Recheck eight'))
    def test_45_final_before_artifact(self):
        self.assertLess(self.src.index('- name: Recheck eight'),self.src.index('- name: Preserve only'))
    def test_46_pins_twice(self):
        for path,hashval in PINS.items():
            with self.subTest(path=path):self.assertEqual(self.src.count(hashval),2)
    def test_47_pins_exact_git_identity(self):
        for path,hashval in PINS.items():
            with self.subTest(path=path):
                b=Path(path).read_bytes()
                import hashlib
                got=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
                self.assertEqual(got,hashval)
    def test_48_bash_syntax(self):
        for script in self.scripts:
            with self.subTest(script=script[:40]):
                command=subprocess.run(['bash','-n'],input=script,text=True,capture_output=True)
                self.assertEqual(command.returncode,0,command.stderr)
    def test_49_no_unsafe_continued_failures(self):
        for script in self.scripts:self.assertIn('set -euo pipefail',script)
    def test_50_release_gate_12(self):self.assertIn("r['realWorldGatesOpen']==12",self.src)
    def test_51_retain_commit(self):self.assertIn("r['githubCommit']==os.environ['GITHUB_SHA']",self.src)
    def test_52_post_cleanup_pin_presence(self):
        for path in PINS:
            self.assertEqual(self.src.count('HEAD:'+path),2)

if __name__=='__main__':unittest.main()

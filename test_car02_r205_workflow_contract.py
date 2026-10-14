#!/usr/bin/env python3
"""R205 fail-closed static workflow contract; no actual deployments or GitHub writes."""
from pathlib import Path
import re
import subprocess
import unittest
import yaml

YAML=Path('.github/workflows/car02-r203-r205-pg17-deadlock-recovery-hold-qa.yml')
PINS={
'R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql':'3784f8a28549bc40343646bf88657c9d9b0b80f2',
'car02_r138_pg17_lifecycle_qa.py':'ff98dd74916ff3ea77412b986138151a4fddab90',
'car02_r159_concurrent_booking_isolated.py':'318921e951cf1578bb00f32eb77f2054ca350ed6',
'car02_r171_rejection_immutability_isolated.py':'23f082a6b247d26cb772c6eee5084000f12d72a2',
'car02_r188_role_escalation_isolated.py':'d61fc9d6d2248e1851187a6b20dea4184fea564d',
'car02_r191_transaction_rollback_isolated.py':'7bf3c1b690db14e6dcbe27831d18231488c91d5f',
'car02_r194_savepoint_atomicity_isolated.py':'b30b081cc019692739e8a4182be00bed73ed1ecc',
'car02_r197_error_recovery_isolated.py':'561a282301a5133f37881a04a8459a0ca87b05e1',
'car02_r200_lock_timeout_isolated.py':'565d6d0528b23202bbb61910b83bad0b8678370a',
}
class R205Safety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src=YAML.read_text()
        cls.low=cls.src.lower()
        parsed=yaml.safe_load(cls.src)
        cls.job=parsed['jobs']['synthetic-pg17-deadlock-only']
        cls.steps=cls.job['steps']
        cls.scripts=[x['run'] for x in cls.steps if 'run' in x]
    def test_01_manual(self):self.assertIn('  workflow_dispatch:',self.src)
    def test_02_no_push(self):self.assertNotIn('  push:',self.src)
    def test_03_no_pr(self):self.assertNotIn('  pull_request:',self.src)
    def test_04_no_schedule(self):self.assertNotIn('  schedule:',self.src)
    def test_05_readonly(self):self.assertIn('permissions:\n  contents: read\n',self.src)
    def test_06_no_write(self):self.assertNotIn(': write',self.low)
    def test_07_no_secrets(self):self.assertNotIn('secrets.',self.low)
    def test_08_no_token_env(self):self.assertNotIn('github.token',self.low)
    def test_09_no_remote_supabase(self):
        for term in ('supabase_url','service_role_key','database_url','supabase db push'):
            with self.subTest(term=term):self.assertNotIn(term,self.low)
    def test_10_no_worker(self):
        for term in ('wrangler','cloudflare','api.line.me','workers.dev'):
            with self.subTest(term=term):self.assertNotIn(term,self.low)
    def test_11_no_deploy(self):
        for term in ('git push','docker push','npm publish','gh release create','kubectl apply'):
            with self.subTest(term=term):self.assertNotIn(term,self.low)
    def test_12_pg17(self):self.assertIn('image: postgres:17',self.src)
    def test_13_ubuntu(self):self.assertEqual(self.job['runs-on'],'ubuntu-24.04')
    def test_14_timeout(self):self.assertEqual(self.job['timeout-minutes'],20)
    def test_15_checkout_v5(self):self.assertIn('actions/checkout@v5',self.src)
    def test_16_no_credentials(self):self.assertIn('persist-credentials: false',self.src)
    def test_17_no_cancellation(self):self.assertIn('cancel-in-progress: false',self.src)
    def test_18_hold(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.src)
    def test_19_isolated(self):self.assertIn("R203_DISPOSABLE_QA: 'yes'",self.src)
    def test_20_pins(self):
        for path,sha in PINS.items():
            with self.subTest(path=path):
                self.assertEqual(self.src.count(sha),2)
                self.assertIn('HEAD:'+path,self.src)
    def test_21_no_alter_original_function(self):self.assertNotIn('ALTER FUNCTION',self.src)
    def test_22_exact_step_count(self):self.assertEqual(len(self.steps),10)
    def test_23_test_rounds(self):self.assertIn('for round in 1 2 3; do',self.src)
    def test_24_test_count(self):self.assertIn('Ran 67 tests in ',self.src)
    def test_25_test_file(self):self.assertIn('test_car02_r204_deadlock_recovery.py',self.src)
    def test_26_self_test(self):self.assertIn('test_car02_r205_workflow_contract.py',self.src)
    def test_27_db_create(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.src)
    def test_28_fixture_exact(self):self.assertIn('< R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.src)
    def test_29_five_empty(self):self.assertIn('for table in bookings service_cases case_operations booking_operations audit_events; do',self.src)
    def test_30_probe(self):self.assertIn('car02_r203_deadlock_recovery_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.src)
    def test_31_40p01(self):self.assertIn("proof['deadlockSqlstate']=='40P01'",self.src)
    def test_32_single_winner(self):self.assertIn("proof['winner']!=proof['loser']",self.src)
    def test_33_no_loser_ops(self):self.assertIn("proof['loserOperationRows']==0",self.src)
    def test_34_cleanup_always(self):
        ix=self.src.index('- name: Always delete disposable PG17')
        self.assertIn('if: always()',self.src[ix:ix+100])
    def test_35_drop_db(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.src)
    def test_36_drop_roles(self):self.assertIn('DROP ROLE IF EXISTS $role;',self.src)
    def test_37_clean_confirm(self):self.assertIn('R203_ALL_DISPOSABLE_RESOURCES_DELETED',self.src)
    def test_38_final_hold(self):self.assertIn('R203_R205_DISPOSABLE_CLEANUP_NO_GO_HOLD_PASS',self.src)
    def test_39_artifact_v5(self):self.assertIn('actions/upload-artifact@v5',self.src)
    def test_40_artifact_always(self):
        ix=self.src.index('- name: Preserve only short retention isolated evidence')
        self.assertIn('if: always()',self.src[ix:ix+100])
    def test_41_retention(self):self.assertIn('retention-days: 7',self.src)
    def test_42_artifact_path(self):self.assertIn('path: qa-evidence-r203/',self.src)
    def test_43_cleanup_before_final(self):
        self.assertLess(self.src.index('- name: Always delete'),self.src.index('- name: Recheck source'))
    def test_44_final_before_artifact(self):
        self.assertLess(self.src.index('- name: Recheck source'),self.src.index('- name: Preserve only'))
    def test_45_bash_syntax(self):
        for script in self.scripts:
            with self.subTest(script=script[:40]):
                # Bash syntax check only; quoted heredoc bodies are left unexecuted.
                p=subprocess.run(['bash','-n'],input=script,text=True,capture_output=True)
                self.assertEqual(p.returncode,0,p.stderr)
    def test_46_no_python_version_pinning_bypass(self):self.assertNotIn('continue-on-error: true',self.src)

if __name__=='__main__':unittest.main()

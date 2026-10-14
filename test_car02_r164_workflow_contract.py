#!/usr/bin/env python3
"""R164: fail-closed source-only checks for isolated R162 GitHub Actions workflow."""
from pathlib import Path
import unittest

WORKFLOW = Path('.github/workflows/car02-r162-r164-pg17-multiday-concurrency-hold-qa.yml')


class R164Safety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=WORKFLOW.read_text(encoding='utf-8')
        cls.lower=cls.source.lower()
        cls.steps=[line.strip() for line in cls.source.splitlines() if line.startswith('      - name: ')]
    def test_01_manual(self): self.assertIn('  workflow_dispatch:',self.source)
    def test_02_push_disabled(self): self.assertNotIn('  push:',self.source)
    def test_03_pr_disabled(self): self.assertNotIn('  pull_request:',self.source)
    def test_04_no_cron(self): self.assertNotIn('  schedule:',self.source)
    def test_05_read_only(self): self.assertIn('permissions:\n  contents: read\n',self.source)
    def test_06_no_write(self): self.assertNotIn(': write',self.lower)
    def test_07_no_secrets(self): self.assertNotIn('secrets.',self.lower)
    def test_08_no_tokens(self): self.assertNotIn('github.token',self.lower)
    def test_09_postgres17(self): self.assertIn('image: postgres:17',self.source)
    def test_10_checkout_v5(self): self.assertIn('actions/checkout@v5',self.source)
    def test_11_drop_checkout_credentials(self): self.assertIn('persist-credentials: false',self.source)
    def test_12_runner(self): self.assertIn('runs-on: ubuntu-24.04',self.source)
    def test_13_timeout(self): self.assertIn('timeout-minutes: 20',self.source)
    def test_14_env_release_lock(self): self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.source)
    def test_15_env_disposable(self): self.assertIn("R162_DISPOSABLE_QA: 'yes'",self.source)
    def test_16_original_fixture_blob(self): self.assertEqual(self.source.count('3784f8a28549bc40343646bf88657c9d9b0b80f2'),2)
    def test_17_r138_helper_blob(self): self.assertEqual(self.source.count('ff98dd74916ff3ea77412b986138151a4fddab90'),2)
    def test_18_r159_immutable_blob(self): self.assertEqual(self.source.count('318921e951cf1578bb00f32eb77f2054ca350ed6'),2)
    def test_19_no_source_edits(self): self.assertNotIn('ALTER FUNCTION',self.source)
    def test_20_three_test_passes(self): self.assertIn('for round in 1 2 3; do',self.source)
    def test_21_test_count(self): self.assertIn('Ran 57 tests in ',self.source)
    def test_22_test_file(self): self.assertIn('test_car02_r163_booking_stress.py',self.source)
    def test_23_contract_file(self): self.assertIn('test_car02_r164_workflow_contract.py',self.source)
    def test_24_fixture_exact_db(self): self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.source)
    def test_25_no_remote_db(self):
        for phrase in ('supabase_url','database_url','service_role_key','wrangler','cloudflare','api.line.me'):
            with self.subTest(phrase=phrase): self.assertNotIn(phrase,self.lower)
    def test_26_no_deploys(self):
        for phrase in ('git push','docker push','supabase db push','npm publish','gh release create'):
            with self.subTest(phrase=phrase): self.assertNotIn(phrase,self.lower)
    def test_27_exact_probe(self): self.assertIn('car02_r162_booking_stress_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.source)
    def test_28_prestate(self): self.assertIn('R162_DISPOSABLE_FIXTURE_EMPTY',self.source)
    def test_29_cleanup_always(self):
        position=self.source.index('- name: Always remove disposable database')
        self.assertIn('if: always()',self.source[position:position+110])
    def test_30_drop_db(self): self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.source)
    def test_31_cleanup_roles(self): self.assertIn('DROP ROLE IF EXISTS $role;',self.source)
    def test_32_cleanup_attested(self): self.assertIn('R162_ALL_THROWAWAY_RESOURCES_DELETED',self.source)
    def test_33_hold_attested(self): self.assertIn('R162_R164_SYNTHETIC_ONLY_CLEANUP_VERIFIED_NO_GO_HOLD',self.source)
    def test_34_cleanup_before_final(self): self.assertLess(self.source.index('- name: Always remove disposable database'),self.source.index('- name: Verify cleanup hold'))
    def test_35_upload_after_final(self): self.assertLess(self.source.index('- name: Verify cleanup hold'),self.source.index('- name: Preserve short-retention'))
    def test_36_upload_always(self):
        position=self.source.index('- name: Preserve short-retention')
        self.assertIn('if: always()',self.source[position:position+120])
    def test_37_artifact_short(self): self.assertIn('retention-days: 7',self.source)
    def test_38_exact_steps(self): self.assertEqual(len(self.steps),10)
    def test_39_no_cancellation(self): self.assertIn('cancel-in-progress: false',self.source)
    def test_40_gates_still_open(self): self.assertIn("report['realWorldGatesOpen']==12",self.source)
    def test_41_artifact_only(self): self.assertIn('path: qa-evidence-r162/',self.source)


if __name__=='__main__': unittest.main()

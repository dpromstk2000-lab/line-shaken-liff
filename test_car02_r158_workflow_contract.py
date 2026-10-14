#!/usr/bin/env python3
"""R158 fail-closed static workflow contract (disposable QA, not prod)."""
import re
from pathlib import Path
import unittest

P=Path('.github/workflows/car02-r156-r158-pg17-artifact-inventory-hold-qa.yml')

class WorkflowContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text=P.read_text(encoding='utf-8');cls.lower=cls.text.lower()
        cls.steps=[line.strip() for line in cls.text.splitlines() if line.startswith('      - name: ')]
    def test_01_manual_only(self):self.assertRegex(self.text,r'(?m)^  workflow_dispatch:\s*$')
    def test_02_no_push(self):self.assertNotRegex(self.text,r'(?m)^  push:\s*$')
    def test_03_no_pull_request(self):self.assertNotRegex(self.text,r'(?m)^  pull_request:\s*$')
    def test_04_no_schedule(self):self.assertNotRegex(self.text,r'(?m)^  schedule:\s*$')
    def test_05_readonly(self):self.assertRegex(self.text,r'(?m)^permissions:\s*\n  contents: read\s*$')
    def test_06_no_write_scopes(self):
        for scope in ('contents','actions','packages','deployments','id-token','pull-requests','issues'):
            with self.subTest(scope=scope):self.assertNotIn(scope+': write',self.lower)
    def test_07_no_secrets(self):self.assertNotIn('secrets.',self.lower)
    def test_08_no_token_refs(self):self.assertNotIn('github.token',self.lower)
    def test_09_no_production_env(self):
        for term in ('supabase_url','service_role_key','database_url','admin_key','api.line.me','wrangler'):
            with self.subTest(term=term):self.assertNotIn(term,self.lower)
    def test_10_no_network_posts(self):
        for term in ('git push','docker push','supabase db push','curl -x post','gh release create'):
            with self.subTest(term=term):self.assertNotIn(term,self.lower)
    def test_11_checkout_no_token(self):self.assertIn('persist-credentials: false',self.text)
    def test_12_pg17_only(self):self.assertIn('image: postgres:17',self.text)
    def test_13_ubuntu_runner(self):self.assertIn('runs-on: ubuntu-24.04',self.text)
    def test_14_timeout(self):self.assertIn('timeout-minutes: 20',self.text)
    def test_15_dispatch_lock(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.text)
    def test_16_disposable_flag(self):self.assertIn("R143_DISPOSABLE_QA: 'yes'",self.text)
    def test_17_prior_source_guard(self):self.assertIn('car02_r142_provenance_lock_isolated.py',self.text)
    def test_18_r149_pins(self):self.assertIn('R149_ORIGINAL_GIT_BLOBS_UNCHANGED',self.text)
    def test_19_r152_pins(self):self.assertIn('R152_ORIGINAL_GIT_BLOBS_UNCHANGED',self.text)
    def test_20_r155_pins(self):self.assertIn('R155_ORIGINAL_GIT_BLOBS_UNCHANGED',self.text)
    def test_21_three_git_pins(self):self.assertEqual(self.text.count('git hash-object "$filename"'),3)
    def test_22_r155_pg17_original_sha(self):self.assertIn('68b1de84be57c08be830f849070cf13509ea2aff',self.text)
    def test_23_r155_workflow_original_sha(self):self.assertIn('ee8253c06a954cdbc12c9c916a33cd99318ac380',self.text)
    def test_24_r154_negative_tests(self):self.assertIn('test_car02_r154_post_cleanup_receipt.py',self.text)
    def test_25_r157_negative_tests(self):self.assertIn('test_car02_r157_artifact_inventory.py',self.text)
    def test_26_72_tests(self):self.assertIn('Ran 72 tests in ',self.text)
    def test_27_r157_repeated(self):self.assertIn('r157-inventory-${round}.log',self.text)
    def test_28_r158_self_tests(self):self.assertIn('test_car02_r158_workflow_contract.py',self.text)
    def test_29_44_tests(self):self.assertIn('Ran 44 tests in ',self.text)
    def test_30_cleanup_if_always(self):
        rest=self.text[self.text.index('- name: Remove all disposable databases'):]
        self.assertIn('if: always()',rest[:130])
    def test_31_cleanup_force(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.text)
    def test_32_cleanup_roles(self):self.assertIn('DROP ROLE IF EXISTS $role;',self.text)
    def test_33_pg_end_query(self):self.assertIn('car02_r153_post_cleanup_receipt_isolated.py',self.text)
    def test_34_final_hold_before_inventory(self):
        self.assertLess(self.text.index('- name: Enforce final never-deploy'),
                        self.text.index('- name: R156 generate strict artifact inventory'))
    def test_35_inventory_before_upload(self):
        self.assertLess(self.text.index('- name: R156 generate strict artifact inventory'),
                        self.text.index('- name: Keep isolated QA evidence only'))
    def test_36_verification_before_upload(self):
        self.assertLess(self.text.index('- name: Re-read every inventory byte'),
                        self.text.index('- name: Keep isolated QA evidence only'))
    def test_37_preceding_run_exact_file(self):self.assertIn('r156-closed-world-artifact-inventory.json',self.text)
    def test_38_sha_bound(self):self.assertIn('python3 car02_r156_artifact_inventory_isolated.py --commit "$GITHUB_SHA"',self.text)
    def test_39_validate_manifest_again(self):self.assertIn('validate_manifest(records,commit,report)',self.text)
    def test_40_no_production_claim(self):self.assertIn("report['productionAuthorized'] is False",self.text)
    def test_41_no_signature_claim(self):self.assertIn("report['externalSignatureVerified'] is False",self.text)
    def test_42_always_upload_with_short_retention(self):
        rest=self.text[self.text.index('- name: Keep isolated QA evidence only'):]
        self.assertIn('if: always()',rest[:100])
        self.assertIn('retention-days: 7',rest)
    def test_43_no_cancel(self):self.assertIn('cancel-in-progress: false',self.text)
    def test_44_27_steps(self):self.assertEqual(len(self.steps),27)

if __name__=='__main__':unittest.main()

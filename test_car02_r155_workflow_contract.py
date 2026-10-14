#!/usr/bin/env python3
"""R155 fail-closed static contract for disposable QA workflow. No GitHub/network calls."""
from pathlib import Path
import re
import unittest

P=Path('.github/workflows/car02-r153-r155-pg17-post-cleanup-hold-qa.yml')

class WorkflowContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s=P.read_text(encoding='utf-8');cls.l=cls.s.lower()
    def test_01_manual_only(self):self.assertRegex(self.s,r'(?m)^  workflow_dispatch:\s*$')
    def test_02_no_push(self):self.assertNotRegex(self.s,r'(?m)^  push:\s*$')
    def test_03_no_pull_request(self):self.assertNotRegex(self.s,r'(?m)^  pull_request:\s*$')
    def test_04_no_schedule(self):self.assertNotRegex(self.s,r'(?m)^  schedule:\s*$')
    def test_05_readonly(self):self.assertIn('permissions:\n  contents: read',self.s)
    def test_06_no_id_token(self):self.assertNotIn('id-token: write',self.s)
    def test_07_no_contents_write(self):self.assertNotIn('contents: write',self.s)
    def test_08_checkout_v5(self):self.assertIn('uses: actions/checkout@v5',self.s)
    def test_09_no_tokens_stored(self):self.assertIn('persist-credentials: false',self.s)
    def test_10_pg17(self):self.assertIn('image: postgres:17',self.s)
    def test_11_no_repo_secrets(self):self.assertNotIn('secrets.',self.l)
    def test_12_no_production_env(self):
        for value in ('supabase_url','service_role_key','database_url','admin_key'):
            with self.subTest(value=value):self.assertNotIn(value,self.l)
    def test_13_no_deploy_commands(self):
        for value in ('wrangler deploy','supabase db push','git push','docker push','curl -x post'):
            with self.subTest(value=value):self.assertNotIn(value,self.l)
    def test_14_no_real_endpoints(self):
        for value in ('api.line.me','cloudflare.com/api','supabase.co','api.github.com'):
            with self.subTest(value=value):self.assertNotIn(value,self.l)
    def test_15_release_lock(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.s)
    def test_16_r138_qa(self):self.assertIn("R138_DISPOSABLE_QA: 'yes'",self.s)
    def test_17_r139_qa(self):self.assertIn("R139_DISPOSABLE_QA: 'yes'",self.s)
    def test_18_r143_qa(self):self.assertIn("R143_DISPOSABLE_QA: 'yes'",self.s)
    def test_19_provenance_guard(self):self.assertIn('car02_r142_provenance_lock_isolated.py',self.s)
    def test_20_r147_pins(self):self.assertIn('R149_ORIGINAL_GIT_BLOBS_UNCHANGED',self.s)
    def test_21_r150_pins(self):self.assertIn('R152_ORIGINAL_GIT_BLOBS_UNCHANGED',self.s)
    def test_22_git_hashes(self):self.assertEqual(self.s.count('git hash-object "$filename"'),2)
    def test_23_fixture_sha(self):self.assertIn('sha256sum -c -',self.s)
    def test_24_unique_db_name(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.s)
    def test_25_snapshot_before_after(self):
        self.assertIn('r139-before.json',self.s);self.assertIn('r139-after.json',self.s)
    def test_26_r143_db_probe(self):self.assertIn('car02_r143_pg17_boundary_probe_isolated.py',self.s)
    def test_27_r144_independent_parity(self):self.assertIn('car02_r144_independent_parity_isolated.py',self.s)
    def test_28_r147_recompute(self):self.assertIn('car02_r147_evidence_chain_isolated.py --commit "$GITHUB_SHA"',self.s)
    def test_29_r150_strict(self):self.assertIn('car02_r150_strict_bundle_isolated.py --commit "$GITHUB_SHA"',self.s)
    def test_30_r153_closeout(self):self.assertIn('car02_r153_post_cleanup_receipt_isolated.py --commit "$GITHUB_SHA" --cid "$CID"',self.s)
    def test_31_r154_repeated(self):
        self.assertIn('test_car02_r154_post_cleanup_receipt.py',self.s)
        self.assertIn('Ran 68 tests in ',self.s)
        self.assertGreaterEqual(self.s.count('for round in 1 2 3; do'),4)
    def test_32_r155_test(self):self.assertIn('test_car02_r155_workflow_contract.py',self.s)
    def test_33_cleanup_always(self):
        section=self.s[self.s.index('- name: Remove all disposable databases'):]
        self.assertIn('if: always()',section[:130]);self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',section)
    def test_34_cleanup_order(self):
        self.assertLess(self.s.index('- name: Remove all disposable databases'),self.s.index('- name: R153 independently revalidate'))
    def test_35_closeout_before_hold_gate(self):
        self.assertLess(self.s.index('- name: R153 independently revalidate'),self.s.index('- name: Enforce final never-deploy'))
    def test_36_cleanup_assertion(self):self.assertIn('R143_ALL_DISPOSABLE_RESOURCES_DELETED',self.s)
    def test_37_hold_assertion(self):self.assertIn("receipt['release']=='NO_GO' and receipt['migration']=='HOLD'",self.s)
    def test_38_no_external_signature(self):self.assertIn("receipt['externalSignatureVerified'] is False",self.s)
    def test_39_artifact_cleanup(self):
        section=self.s[self.s.index('- name: Keep isolated QA evidence only'):]
        self.assertIn('if: always()',section[:100]);self.assertIn('retention-days: 7',section)
    def test_40_job_time_limit(self):
        self.assertRegex(self.s,r'(?m)^    timeout-minutes: 20\s*$')
        self.assertIn('cancel-in-progress: false',self.s)

if __name__=='__main__':unittest.main()

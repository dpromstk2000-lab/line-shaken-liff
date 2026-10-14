#!/usr/bin/env python3
"""R149: static safety contract for new R147-R149 PG17-only workflow.

Text-level fail-closed checks complement, but do not replace GitHub validation.
"""
from pathlib import Path
import re
import unittest

TARGET=Path('.github/workflows/car02-r147-r149-pg17-evidence-chain-hold-qa.yml')

class WorkflowContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src=TARGET.read_text(encoding='utf8')
        cls.lower=cls.src.lower()
    def test_manual_only(self):
        self.assertRegex(self.src,r'(?m)^  workflow_dispatch:\s*$')
    def test_no_push(self):self.assertNotRegex(self.src,r'(?m)^  push:')
    def test_no_schedule(self):self.assertNotRegex(self.src,r'(?m)^  schedule:')
    def test_no_pull_request(self):self.assertNotRegex(self.src,r'(?m)^  pull_request:')
    def test_contents_readonly(self):self.assertIn('permissions:\n  contents: read',self.src)
    def test_checkout_no_token(self):self.assertIn('persist-credentials: false',self.src)
    def test_pg17_service(self):self.assertIn('image: postgres:17',self.src)
    def test_no_live_secrets(self):self.assertNotIn('secrets.',self.lower)
    def test_no_production_api(self):
        for needle in ('wrangler','supabase.com','cloudflare.com/api','line.me/api','api.line.me'):
            with self.subTest(needle=needle):self.assertNotIn(needle,self.lower)
    def test_no_prod_credentials(self):
        for needle in ('service_role_key','admin_key','database_url','supabase_url','github_token'):
            with self.subTest(needle=needle):self.assertNotIn(needle,self.lower)
    def test_synthetic_guard(self):
        for line in ("CAR02_RELEASE_LOCK: 'true'","R138_DISPOSABLE_QA: 'yes'",
                     "R139_DISPOSABLE_QA: 'yes'","R143_DISPOSABLE_QA: 'yes'"):
            with self.subTest(line=line):self.assertIn(line,self.src)
    def test_explicit_original_provenance(self):
        self.assertIn('python3 car02_r142_provenance_lock_isolated.py',self.src)
    def test_one_disposable_database(self):
        self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.src)
        self.assertNotIn('CREATE DATABASE production',self.src)
    def test_cleanup_always(self):
        idx=self.src.index('- name: Remove all disposable databases and throwaway roles')
        self.assertIn('if: always()',self.src[idx:idx+160])
        self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.src)
    def test_role_cleanup(self):self.assertIn('DROP ROLE IF EXISTS $role;',self.src)
    def test_r139_before_after(self):
        self.assertIn('r139-before.json',self.src)
        self.assertIn('r139-after.json',self.src)
    def test_r147_correlator(self):
        self.assertIn('python3 car02_r147_evidence_chain_isolated.py',self.src)
        self.assertIn('r147-independent-evidence-chain.json',self.src)
    def test_r147_commit_binding(self):self.assertIn('--commit "$GITHUB_SHA"',self.src)
    def test_52_fail_closed_tests(self):
        self.assertIn('test_car02_r147_evidence_chain.py',self.src)
        self.assertIn('Ran 52 tests in ',self.src)
    def test_local_repeat_three_times(self):
        self.assertGreaterEqual(self.src.count('for round in 1 2 3; do'),2)
    def test_manifest_release_lock(self):
        self.assertIn("report['release']=='NO_GO'",self.src)
        self.assertIn("report['migration']=='HOLD'",self.src)
        self.assertIn("manifest['productionAuthorized'] is False",self.src)
    def test_no_deploy_command(self):
        self.assertNotRegex(self.src,r'(?im)^\s*(?:wrangler|npx wrangler|supabase|git push|docker push)\s')
    def test_evidence_retention(self):
        self.assertIn('actions/upload-artifact@v4',self.src)
        self.assertIn('retention-days: 7',self.src)
    def test_artifact_always(self):
        idx=self.src.index('- name: Keep isolated QA evidence only')
        self.assertIn('if: always()',self.src[idx:idx+120])
    def test_final_gate_after_cleanup(self):
        self.assertLess(self.src.index('- name: Remove all disposable databases'),
                        self.src.index('- name: Enforce final never-deploy'))
    def test_run_time_limit(self):self.assertRegex(self.src,r'(?m)^    timeout-minutes: 20\s*$')
    def test_concurrency_cancel_off(self):self.assertIn('cancel-in-progress: false',self.src)

if __name__=='__main__':unittest.main()

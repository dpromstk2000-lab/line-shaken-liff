#!/usr/bin/env python3
"""R152: static independent safety contract for R150-R152 disposable-only GitHub workflow."""
from pathlib import Path
import re
import unittest

P=Path('.github/workflows/car02-r150-r152-pg17-strict-evidence-hold-qa.yml')
class R152(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s=P.read_text(encoding='utf8');cls.l=cls.s.lower()
    def test_01_manual_dispatch(self):self.assertRegex(self.s,r'(?m)^  workflow_dispatch:\s*$')
    def test_02_no_push(self):self.assertNotRegex(self.s,r'(?m)^  push:')
    def test_03_no_pull_request(self):self.assertNotRegex(self.s,r'(?m)^  pull_request:')
    def test_04_no_schedule(self):self.assertNotRegex(self.s,r'(?m)^  schedule:')
    def test_05_readonly_permission(self):self.assertIn('permissions:\n  contents: read',self.s)
    def test_06_checkout_token_unpersisted(self):self.assertIn('persist-credentials: false',self.s)
    def test_07_pg17(self):self.assertIn('image: postgres:17',self.s)
    def test_08_github_environment_no_secrets(self):self.assertNotIn('secrets.',self.l)
    def test_09_no_production_config(self):
        for x in ('supabase_url','service_role_key','database_url','admin_key'):
            with self.subTest(x=x):self.assertNotIn(x,self.l)
    def test_10_no_deployment_scripts(self):
        for x in ('npx wrangler','wrangler deploy','supabase db push','git push','docker push'):
            with self.subTest(x=x):self.assertNotIn(x,self.l)
    def test_11_no_live_network_endpoints(self):
        for x in ('api.line.me','supabase.com','cloudflare.com/api','line.me/api'):
            with self.subTest(x=x):self.assertNotIn(x,self.l)
    def test_12_lock_literal(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.s)
    def test_13_r138_literal(self):self.assertIn("R138_DISPOSABLE_QA: 'yes'",self.s)
    def test_14_r139_literal(self):self.assertIn("R139_DISPOSABLE_QA: 'yes'",self.s)
    def test_15_r143_literal(self):self.assertIn("R143_DISPOSABLE_QA: 'yes'",self.s)
    def test_16_original_provenance(self):self.assertIn('python3 car02_r142_provenance_lock_isolated.py',self.s)
    def test_17_r149_git_blob_pins(self):
        self.assertIn('R149_ORIGINAL_GIT_BLOBS_UNCHANGED',self.s)
        self.assertIn('git hash-object',self.s)
    def test_18_fixture_original(self):self.assertIn('sha256sum -c -',self.s)
    def test_19_one_disposable_db(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.s)
    def test_20_synthetic_data_runner(self):self.assertIn('car02_r138_pg17_lifecycle_qa.py source',self.s)
    def test_21_independent_before_after(self):
        self.assertIn('r139-before.json',self.s);self.assertIn('r139-after.json',self.s)
    def test_22_security_probe(self):self.assertIn('car02_r143_pg17_boundary_probe_isolated.py',self.s)
    def test_23_cross_evidence(self):self.assertIn('car02_r147_evidence_chain_isolated.py --commit "$GITHUB_SHA"',self.s)
    def test_24_strict_bundle(self):self.assertIn('car02_r150_strict_bundle_isolated.py --commit "$GITHUB_SHA"',self.s)
    def test_25_repeated_negative_tests(self):
        self.assertGreaterEqual(self.s.count('for round in 1 2 3; do'),3)
        self.assertIn('Ran 64 tests in ',self.s)
    def test_26_final_hold(self):
        self.assertIn("strict['release']=='NO_GO'",self.s)
        self.assertIn("strict['migration']=='HOLD'",self.s)
    def test_27_no_external_witness_claim(self):self.assertIn("strict['externalWitnessVerified'] is False",self.s)
    def test_28_cleanup_always(self):
        p=self.s.index('- name: Remove all disposable databases and throwaway roles')
        self.assertIn('if: always()',self.s[p:p+125])
        self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.s)
    def test_29_cleanup_before_finish(self):
        self.assertLess(self.s.index('- name: Remove all disposable databases'),
                        self.s.index('- name: Enforce final never-deploy'))
    def test_30_artifact_always(self):
        p=self.s.index('- name: Keep isolated QA evidence only')
        self.assertIn('if: always()',self.s[p:p+110])
        self.assertIn('retention-days: 7',self.s)
    def test_31_time_limit(self):self.assertRegex(self.s,r'(?m)^    timeout-minutes: 20\s*$')
    def test_32_cancel_off(self):self.assertIn('cancel-in-progress: false',self.s)

if __name__=='__main__':unittest.main()

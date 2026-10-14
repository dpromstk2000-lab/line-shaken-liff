#!/usr/bin/env python3
"""R173 fail-closed checks for disposable R171 PG17 workflow. No external DB."""
from pathlib import Path
import unittest

YML=Path('.github/workflows/car02-r171-r173-pg17-denial-immutability-hold-qa.yml')
PINS={
 'R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql':'3784f8a28549bc40343646bf88657c9d9b0b80f2',
 'car02_r138_pg17_lifecycle_qa.py':'ff98dd74916ff3ea77412b986138151a4fddab90',
 'car02_r159_concurrent_booking_isolated.py':'318921e951cf1578bb00f32eb77f2054ca350ed6',
 'car02_r162_booking_stress_isolated.py':'d6dd3a48a48ffe045ce4ab5df3c2fdd86b3e0e5e',
 'car02_r165_interleaving_isolated.py':'ce9c2a3e1b2dae378ea97e097a5738868f18a19f',
 'car02_r168_case_race_isolated.py':'a7f04ad9b7d417f450209daecb1267c88565ac79',
}

class R173SafeWorkflow(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.text=YML.read_text(encoding='utf-8');cls.lower=cls.text.lower()
  cls.steps=[t.strip() for t in cls.text.splitlines() if t.startswith('      - name: ')]
 def test_manual_only(self):self.assertIn('  workflow_dispatch:',self.text)
 def test_no_push(self):self.assertNotIn('  push:',self.text)
 def test_no_pr(self):self.assertNotIn('  pull_request:',self.text)
 def test_no_schedule(self):self.assertNotIn('  schedule:',self.text)
 def test_readonly(self):self.assertIn('permissions:\n  contents: read\n',self.text)
 def test_no_write_grants(self):self.assertNotIn(': write',self.lower)
 def test_no_secrets(self):self.assertNotIn('secrets.',self.lower)
 def test_no_access_tokens(self):self.assertNotIn('github.token',self.lower)
 def test_postgres17(self):self.assertIn('image: postgres:17',self.text)
 def test_ubuntu(self):self.assertIn('runs-on: ubuntu-24.04',self.text)
 def test_timeout(self):self.assertIn('timeout-minutes: 20',self.text)
 def test_checkout(self):self.assertIn('actions/checkout@v5',self.text)
 def test_persist_credential_false(self):self.assertIn('persist-credentials: false',self.text)
 def test_lock(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.text)
 def test_disposable(self):self.assertIn("R171_DISPOSABLE_QA: 'yes'",self.text)
 def test_python_source(self):self.assertIn('car02_r171_rejection_immutability_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.text)
 def test_three_unit_rounds(self):self.assertIn('for round in 1 2 3; do',self.text)
 def test_unit_count(self):self.assertIn('Ran 71 tests in ',self.text)
 def test_workflow_selftest(self):self.assertIn('test_car02_r173_workflow_contract.py',self.text)
 def test_exact_db(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.text)
 def test_exact_fixture(self):self.assertIn('R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.text)
 def test_post_create_empty(self):self.assertIn('R171_FIVE_DISPOSABLE_TABLES_EMPTY',self.text)
 def test_clean_always(self):
  i=self.text.index('- name: Always drop disposable PG17 database')
  self.assertIn('if: always()',self.text[i:i+140])
 def test_cleanup_db(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.text)
 def test_cleanup_all_roles(self):self.assertIn('DROP ROLE IF EXISTS $role;',self.text)
 def test_cleanup_witness(self):self.assertIn('R171_ALL_THROWAWAY_RESOURCES_DELETED',self.text)
 def test_hold_log(self):self.assertIn('R171_R173_RELEASE_NO_GO_DB_MIGRATION_HOLD',self.text)
 def test_hold_final(self):self.assertIn('R171_R173_CLEANUP_AND_RELEASE_HOLD_PASS',self.text)
 def test_artifact_upload_always(self):
  i=self.text.index('- name: Upload seven day synthetic only evidence')
  self.assertIn('if: always()',self.text[i:i+140])
 def test_seven_day_retention(self):self.assertIn('retention-days: 7',self.text)
 def test_artifact_scope(self):self.assertIn('path: qa-evidence-r171/',self.text)
 def test_exact_steps(self):self.assertEqual(len(self.steps),10)
 def test_cleanup_before_hold(self):self.assertLess(self.text.index('Always drop disposable'),self.text.index('Confirm cleanup source pins'))
 def test_hold_before_artifact(self):self.assertLess(self.text.index('Confirm cleanup source pins'),self.text.index('Upload seven day'))
 def test_no_auto_cancel(self):self.assertIn('cancel-in-progress: false',self.text)
 def test_real_gates_open(self):self.assertIn("report['realWorldGatesOpen']==12",self.text)
 def test_no_prod_credential_reference(self):
  for s in ('service_role_key','supabase_url','database_url','api.line.me','wrangler','cloudflare','owner_token'):
   with self.subTest(s=s):self.assertNotIn(s,self.lower)
 def test_no_production_deploy(self):
  for s in ('supabase db push','git push','docker push','npm publish','gh release create','alter function'):
   with self.subTest(s=s):self.assertNotIn(s,self.lower)
 def test_all_sealed_sources_twice(self):
  for path,sha in PINS.items():
   with self.subTest(path=path):
    self.assertEqual(self.text.count(sha),2)
    self.assertIn('HEAD:'+path,self.text)
 def test_concurrency_group(self):self.assertIn('group: car02-r171-r173-disposable-',self.text)
 def test_only_synthetic_env(self):self.assertNotIn('environment: production',self.lower)
 def test_github_commit_link(self):self.assertIn("report['githubCommit']==os.environ['GITHUB_SHA']",self.text)
 def test_5_tables(self):
  for name in ('bookings','service_cases','case_operations','booking_operations','audit_events'):
   self.assertIn(name,self.text)
 def test_no_secret_escalation(self):self.assertNotIn('id-token: write',self.lower)
 def test_no_untrusted_exec(self):self.assertNotIn('workflow_call:',self.text)
 def test_fixed_schema(self):self.assertIn('car02_r138_qa_ci',self.text)

if __name__=='__main__':unittest.main()

#!/usr/bin/env python3
"""R145 offline denylist plus positive allowlist for isolated-only CI workflow."""
from pathlib import Path
import re
import unittest

WF_NAME='car02-r143-r145-pg17-boundary-readonly-hold-qa.yml'

def wf_file():
    local=Path(__file__).resolve().parent.parent/'workflows'/WF_NAME
    if local.exists():return local
    return Path(__file__).resolve().parent/'.github'/'workflows'/WF_NAME

def workflow():return wf_file().read_text(encoding='utf8')

class WorkflowGuard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.script=workflow()
    def test_one_dispatch_only(self):self.assertRegex(self.script,r'(?m)^\s+workflow_dispatch:\s*$')
    def test_no_push(self):self.assertNotRegex(self.script,r'(?m)^\s+(push|pull_request|schedule|workflow_call):')
    def test_read_only_permission(self):self.assertRegex(self.script,r'(?m)^permissions:\s*\n\s+contents: read\s*$')
    def test_no_permissions_write(self):self.assertNotRegex(self.script,r'(?m)^\s+(contents|actions|deployments|id-token): write')
    def test_checkout_no_token(self):self.assertIn('persist-credentials: false',self.script)
    def test_no_secrets(self):self.assertNotIn('secrets.',self.script)
    def test_no_cloudflare(self):self.assertNotRegex(self.script,r'(?i)cloudflare|wrangler')
    def test_no_supabase(self):self.assertNotRegex(self.script,r'(?i)supabase|service_role_key|postgresql://')
    def test_no_line_dispatch(self):self.assertNotRegex(self.script,r'(?i)line\.me|liff|messaging-api')
    def test_no_deploy_action(self):self.assertNotRegex(self.script,r'(?m)^\s+- name: .*Deploy')
    def test_no_pg_connections(self):self.assertNotIn('PGHOST',self.script)
    def test_pg17_service(self):self.assertIn('image: postgres:17',self.script)
    def test_disposable_database(self):self.assertIn("CREATE DATABASE car02_r138_qa_ci;",self.script)
    def test_database_deleted(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.script)
    def test_roles_deleted(self):self.assertIn('DROP ROLE IF EXISTS',self.script)
    def test_qa_flags(self):
        for flag in ('CAR02_RELEASE_LOCK','R138_DISPOSABLE_QA','R139_DISPOSABLE_QA','R143_DISPOSABLE_QA'):
            self.assertIn(flag,self.script)
    def test_strict_error_flags(self):self.assertGreaterEqual(self.script.count('set -euo pipefail'),8)
    def test_no_go_hold(self):self.assertIn('R143_R144_RELEASE_NO_GO_DB_MIGRATION_HOLD',self.script)
    def test_no_always_success(self):self.assertNotIn('continue-on-error: true',self.script)
    def test_runner_fixed(self):self.assertIn('runs-on: ubuntu-24.04',self.script)
    def test_no_external_urls(self):self.assertNotIn('https://',self.script)
    def test_crosscheck_sql_sha(self):self.assertIn('6453a322cf6ab96ca00a22c8b83babadd6499f5a0ad3016616e7eabc80edb374',self.script)
    def test_r139_before_after(self):
        for s in ('r139-before.json','r139-after.json','r144_independent_parity_isolated.py'):
            self.assertIn(s,self.script)
    def test_artifact_is_synthetic(self):self.assertIn('disposable-pg17-authz-boundary-evidence',self.script)
    def test_max_runtime(self):self.assertRegex(self.script,r'(?m)^\s+timeout-minutes: 20$')
    def test_no_extra_db(self):self.assertEqual(set(re.findall(r'CREATE DATABASE (\w+)',self.script)),{'car02_r138_qa_ci'})
    def test_only_pinned_source_scripts(self):
        self.assertIn('R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.script)
        self.assertIn('car02_r142_provenance_lock_isolated.py',self.script)

if __name__=='__main__':unittest.main()

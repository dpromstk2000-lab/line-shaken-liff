#!/usr/bin/env python3
"""R220: fail-closed safety contract for isolated PostgreSQL tenant namespace QA."""
from pathlib import Path
import re,subprocess,unittest,yaml
from test_car02_r217_workflow_contract import PINS as PRIOR_PINS

FILE=Path('.github/workflows/car02-r218-r220-pg17-tenant-namespace-hold-qa.yml')
PINS=dict(PRIOR_PINS,**{'car02_r215_first_write_race_isolated.py':'22f4a7678eac6bb87bb5c875e43d56bae13d3175'})

class R220(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text=FILE.read_text(encoding='utf-8')
        cls.low=cls.text.lower()
        cls.spec=yaml.safe_load(cls.text)
        cls.job=cls.spec['jobs']['synthetic-pg17-tenant-namespace-only']
        cls.steps=cls.job['steps']
        cls.scripts=[s['run'] for s in cls.steps if 'run' in s]
    def test_manual_only(self):self.assertIn('  workflow_dispatch:',self.text)
    def test_no_push(self):self.assertNotIn('  push:',self.text)
    def test_no_cron(self):self.assertNotIn('  schedule:',self.text)
    def test_no_pr(self):self.assertNotIn('  pull_request:',self.text)
    def test_read_permissions(self):self.assertIn('permissions:\n  contents: read\n',self.text)
    def test_no_write_permissions(self):self.assertNotIn(': write',self.low)
    def test_no_id_token(self):self.assertNotIn('id-token:',self.low)
    def test_no_secrets(self):self.assertNotIn('secrets.',self.low)
    def test_no_database_url(self):self.assertNotIn('database_url',self.low)
    def test_no_supabase_url(self):self.assertNotIn('supabase_url',self.low)
    def test_no_service_role(self):self.assertNotIn('service_role_key',self.low)
    def test_no_remote_deploy(self):
        for word in ('wrangler','cloudflare','api.line.me','git push','docker push','kubectl apply'):
            with self.subTest(word=word):self.assertNotIn(word,self.low)
    def test_pg17(self):self.assertEqual(self.job['services']['postgres']['image'],'postgres:17')
    def test_runner(self):self.assertEqual(self.job['runs-on'],'ubuntu-24.04')
    def test_timeout(self):self.assertEqual(self.job['timeout-minutes'],20)
    def test_qa_env(self):self.assertEqual(self.job['env']['R218_DISPOSABLE_QA'],'yes')
    def test_release_lock(self):self.assertEqual(self.job['env']['CAR02_RELEASE_LOCK'],'true')
    def test_only_one_job(self):self.assertEqual(len(self.spec['jobs']),1)
    def test_ten_steps(self):self.assertEqual(len(self.steps),10)
    def test_checkout_without_creds(self):
        self.assertIn('actions/checkout@v5',self.text)
        self.assertIn('persist-credentials: false',self.text)
    def test_actions_upload_v5(self):self.assertIn('actions/upload-artifact@v5',self.text)
    def test_short_artifact(self):self.assertIn('retention-days: 7',self.text)
    def test_only_synthetic_artifact(self):self.assertIn('path: qa-evidence-r218/',self.text)
    def test_shell_syntax(self):
        for i,body in enumerate(self.scripts):
            with self.subTest(step=i):
                p=subprocess.run(['bash','-n'],input=body,text=True,capture_output=True)
                self.assertEqual(p.returncode,0,p.stderr)
    def test_manual_count(self):self.assertIn('Ran 66 tests in ',self.text)
    def test_new_source_only(self):self.assertIn('python3 car02_r218_tenant_namespace_race_isolated.py',self.text)
    def test_new_proof_verifier(self):self.assertIn('from car02_r218_tenant_namespace_race_isolated import valid_report,STAGES',self.text)
    def test_no_old_first_write_probe(self):self.assertNotIn('python3 car02_r215_first_write_race_isolated.py',self.text)
    def test_results_stages(self):self.assertIn("len(proof['stages'])==len(STAGES)==4",self.text)
    def test_output_proof(self):self.assertIn('r218-tenant-namespace-race-proof.json',self.text)
    def test_pg_role_names(self):
        for role in ('car02_r138_a_staff_ci','car02_r138_a_one_ci','car02_r138_a_two_ci',
                     'car02_r138_b_staff_ci','car02_r138_b_one_ci'):
            self.assertIn(role,self.text)
    def test_empty_five_tables(self):
        for table in ('bookings','service_cases','case_operations','booking_operations','audit_events'):
            self.assertIn(table,self.text)
    def test_create_only_disposable(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.text)
    def test_drop_disposable_always(self):
        self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.text)
        x=self.text.index('- name: Always remove disposable DB')
        self.assertIn('if: always()',self.text[x:x+140])
    def test_verify_cleanup(self):self.assertIn('R218_ALL_THROWAWAY_RESOURCES_DELETED',self.text)
    def test_verify_hold(self):self.assertIn('R218_R220_CLEANUP_NO_GO_HOLD_PASS',self.text)
    def test_source_pin_count(self):self.assertEqual(self.text.count('git rev-parse HEAD:'),len(PINS)*2)
    def test_source_pin_no_edits(self):self.assertNotIn('ALTER FUNCTION',self.text)
    def test_proof_commit(self):self.assertIn("proof['githubCommit']==os.environ['GITHUB_SHA']",self.text)
    def test_cleanup_before_final(self):
        self.assertLess(self.text.index('Always remove disposable DB'),self.text.index('Verify immutable original sources'))
    def test_proof_env_hold(self):self.assertIn("proof['realWorldGatesOpen']==12",self.text)
    def test_no_cancel(self):self.assertIn('cancel-in-progress: false',self.text)
    def test_always_artifact(self):
        x=self.text.index('- name: Preserve only synthetic')
        self.assertIn('if: always()',self.text[x:x+110])

for name,sha in PINS.items():
    def make(name=name,sha=sha):
        def test(self):
            match=f'test "$(git rev-parse HEAD:{name})" = \'{sha}\''
            self.assertEqual(self.text.count(match),2)
        return test
    setattr(R220,'test_pin_'+re.sub('[^a-zA-Z0-9]','_',name),make())

if __name__=='__main__':unittest.main()

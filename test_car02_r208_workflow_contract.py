#!/usr/bin/env python3
"""R208 static fail-closed contract for disposable PG17 backend termination QA."""
from pathlib import Path
import re
import subprocess
import unittest
import yaml

FILE=Path('.github/workflows/car02-r206-r208-pg17-disconnect-atomicity-hold-qa.yml')
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
 'car02_r203_deadlock_recovery_isolated.py':'084906c336dcd2011fdadc1eca8f264ccd423327',
}

class R208WorkflowContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=FILE.read_text(encoding='utf-8');cls.low=cls.source.lower()
        cls.yaml=yaml.safe_load(cls.source)
        cls.steps=cls.yaml['jobs']['synthetic-pg17-backend-disconnect-only']['steps']
        cls.scripts=[x['run'] for x in cls.steps if 'run' in x]
    def test_manual_dispatch(self):self.assertIn('  workflow_dispatch:',self.source)
    def test_no_push(self):self.assertNotIn('  push:',self.source)
    def test_no_schedule(self):self.assertNotIn('  schedule:',self.source)
    def test_no_pr(self):self.assertNotIn('  pull_request:',self.source)
    def test_read_only_permissions(self):self.assertIn('permissions:\n  contents: read\n',self.source)
    def test_no_write_permissions(self):self.assertNotIn(': write',self.low)
    def test_no_secrets(self):self.assertNotIn('secrets.',self.low)
    def test_no_id_token(self):self.assertNotIn('id-token:',self.low)
    def test_no_github_token(self):self.assertNotIn('github.token',self.low)
    def test_pg17(self):self.assertIn('image: postgres:17',self.source)
    def test_ubuntu24(self):self.assertIn('runs-on: ubuntu-24.04',self.source)
    def test_timeout(self):self.assertIn('timeout-minutes: 20',self.source)
    def test_checkout_v5(self):self.assertIn('actions/checkout@v5',self.source)
    def test_no_stored_creds(self):self.assertIn('persist-credentials: false',self.source)
    def test_true_release_lock(self):self.assertIn("CAR02_RELEASE_LOCK: 'true'",self.source)
    def test_disposable_lock(self):self.assertIn("R206_DISPOSABLE_QA: 'yes'",self.source)
    def test_ten_steps(self):self.assertEqual(len(self.steps),10)
    def test_three_rounds(self):self.assertIn('for round in 1 2 3; do',self.source)
    def test_exact_85_cases(self):self.assertIn('Ran 85 tests in ',self.source)
    def test_negative_filename(self):self.assertIn('test_car02_r207_disconnect_atomicity.py',self.source)
    def test_workflow_filename(self):self.assertIn('test_car02_r208_workflow_contract.py',self.source)
    def test_database_created(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.source)
    def test_exact_original_fixture(self):self.assertIn('< R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql',self.source)
    def test_five_table_empty(self):self.assertIn('for table in bookings service_cases case_operations booking_operations audit_events; do',self.source)
    def test_exact_probe(self):self.assertIn('car02_r206_disconnect_atomicity_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',self.source)
    def test_expected_proof(self):self.assertIn('r206-disconnect-atomicity-proof.json',self.source)
    def test_four_terminated(self):self.assertIn("len(r['scenarios'])==len(SCENARIOS)==4",self.source)
    def test_expected_sqlstate(self):self.assertIn("x['disconnectSqlstate']=='57P01'",self.source)
    def test_exact_audits(self):self.assertIn("x['auditRows']==1",self.source)
    def test_no_data_migration(self):self.assertNotIn('ALTER FUNCTION',self.source)
    def test_cleanup_always(self):
        x=next(s for s in self.steps if s['name'].startswith('Always drop'))
        self.assertEqual(x['if'],'always()')
    def test_database_deleted(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.source)
    def test_roles_deleted(self):self.assertIn('DROP ROLE IF EXISTS $role;',self.source)
    def test_cleanup_receipt(self):self.assertIn('R206_ALL_THROWAWAY_RESOURCES_DELETED',self.source)
    def test_hard_hold_after_cleanup(self):self.assertIn('R206_R208_CLEANUP_NO_GO_HOLD_PASS',self.source)
    def test_upload_always(self):
        x=next(s for s in self.steps if s['name'].startswith('Preserve only'))
        self.assertEqual(x['if'],'always()')
    def test_artifact_retention(self):self.assertIn('retention-days: 7',self.source)
    def test_artifact_v5(self):self.assertIn('actions/upload-artifact@v5',self.source)
    def test_no_cancel(self):self.assertIn('cancel-in-progress: false',self.source)
    def test_order_cleanup(self):
        names=[s['name'] for s in self.steps]
        self.assertLess(next(i for i,n in enumerate(names) if n.startswith('R206 real')),
                        next(i for i,n in enumerate(names) if n.startswith('Always drop')))
    def test_order_hold(self):
        names=[s['name'] for s in self.steps]
        self.assertLess(next(i for i,n in enumerate(names) if n.startswith('Always drop')),
                        next(i for i,n in enumerate(names) if n.startswith('Recheck ten')))
    def test_order_artifact(self):
        names=[s['name'] for s in self.steps]
        self.assertLess(next(i for i,n in enumerate(names) if n.startswith('Recheck ten')),
                        next(i for i,n in enumerate(names) if n.startswith('Preserve only')))
    def test_same_commit(self):self.assertIn("r['githubCommit']==os.environ['GITHUB_SHA']",self.source)
    def test_real_gates_open(self):self.assertIn("r['realWorldGatesOpen']==12",self.source)
    def test_synthetic_path(self):self.assertIn('path: qa-evidence-r206/',self.source)
    def test_no_exec_prod(self):
        for k in ('database_url','supabase_url','service_role_key','api.line.me','cloudflare','wrangler',
                  'docker push','git push','kubectl apply','npm publish','gh release create','gh api -x post'):
            with self.subTest(k=k):self.assertNotIn(k,self.low)
    def test_proper_bash_scripts(self):
        for script in self.scripts:
            with self.subTest(script=script.splitlines()[0]):
                r=subprocess.run(['bash','-n'],input=script,capture_output=True,text=True)
                self.assertEqual(r.returncode,0,r.stderr)
    def test_no_extra_services(self):
        self.assertEqual(set(self.yaml['jobs']['synthetic-pg17-backend-disconnect-only']['services']),{'postgres'})
    def test_test_code_does_not_mutate_github(self):
        self.assertEqual(self.yaml['permissions'],{'contents':'read'})


def check_pin(file,sha):
    def test(self):
        self.assertEqual(self.source.count(sha),2)
        if Path(file).is_file():
            real=subprocess.check_output(['git','hash-object',file],text=True).strip()
            self.assertEqual(real,sha)
    return test
for file,sha in PINS.items():
    setattr(R208WorkflowContract,'test_immutable_'+Path(file).stem,check_pin(file,sha))

if __name__=='__main__':unittest.main()

"""R229: fail-closed static safety and provenance checks for R227 PG17 QA."""
from __future__ import annotations
import json,re,subprocess,unittest
from pathlib import Path
import yaml
ROOT=Path(__file__).resolve().parent
WF=ROOT/'.github/workflows/car02-r227-r229-pg17-definer-shadow-hold-qa.yml'
PINS=json.loads((ROOT/'R227_PIN_SOURCE_MANIFEST.json').read_text()) if (ROOT/'R227_PIN_SOURCE_MANIFEST.json').exists() else {
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
 'car02_r206_disconnect_atomicity_isolated.py':'110c7640b9cdf233741ea9fdc59d903517f983eb',
 'car02_r209_commit_ack_loss_isolated.py':'72e0fd3bf6cdf536280c34fe0e8b19231b3bfe1a',
 'car02_r212_parallel_replay_isolated.py':'19264cdafa04685995bd9cf24e55b22685cd1dab',
 'car02_r215_first_write_race_isolated.py':'22f4a7678eac6bb87bb5c875e43d56bae13d3175',
 'car02_r218_tenant_namespace_race_isolated.py':'c1bbe5cff75a4709df0d09791df1ab424bb9156f',
 'car02_r221_forged_owner_ops_isolated.py':'057f05639dcfda64585eb42089dbefceca9289ef',
 'car02_r224_used_key_auth_precedence_isolated.py':'6211db3cdda6623e1d77138e61ab0049e5bca0a9'
}
class R229WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src=WF.read_text(encoding='utf-8');cls.low=cls.src.lower()
        cls.doc=yaml.safe_load(cls.src)
        cls.job=cls.doc['jobs']['synthetic-pg17-definer-shadow-only']
        cls.steps=cls.job['steps'];cls.scripts=[s['run'] for s in cls.steps if 'run' in s]
        cls.jobscripts='\n'.join(cls.scripts)
    def test_yaml_steps(self):self.assertEqual(len(self.steps),10)
    def test_manual_only(self):self.assertIn('  workflow_dispatch:',self.src)
    def test_no_push(self):self.assertNotIn('  push:',self.src)
    def test_no_schedule(self):self.assertNotIn('  schedule:',self.src)
    def test_no_pull(self):self.assertNotIn('  pull_request:',self.src)
    def test_permissions(self):self.assertIn('permissions:\n  contents: read\n',self.src)
    def test_not_write_permissions(self):self.assertNotIn(': write',self.low)
    def test_no_secrets_reference(self):self.assertNotIn('secrets.',self.low)
    def test_no_token_reference(self):self.assertNotIn('github.token',self.low)
    def test_no_supabase_url(self):self.assertNotIn('supabase_url',self.low)
    def test_no_database_url(self):self.assertNotIn('database_url',self.low)
    def test_no_service_role(self):self.assertNotIn('service_role_key',self.low)
    def test_no_deploy(self):
        for bad in ('wrangler publish','wrangler deploy','supabase db push','npm run deploy'):
            self.assertNotIn(bad,self.low)
    def test_postgres17_service(self):self.assertEqual(self.job['services']['postgres']['image'],'postgres:17')
    def test_timeout(self):self.assertEqual(self.job['timeout-minutes'],20)
    def test_readonly_checkout(self):
        x=[s for s in self.steps if str(s.get('uses','')).startswith('actions/checkout@')]
        self.assertEqual(len(x),1);self.assertIs(x[0]['with']['persist-credentials'],False)
    def test_no_cancel_in_progress(self):self.assertIs(self.doc['concurrency']['cancel-in-progress'],False)
    def test_r227_environment(self):self.assertEqual(self.job['env']['R227_DISPOSABLE_QA'],'yes')
    def test_hold_environment(self):self.assertEqual(self.job['env']['CAR02_RELEASE_LOCK'],'true')
    def test_fixture_name(self):self.assertIn('CREATE DATABASE car02_r138_qa_ci;',self.src)
    def test_cleanup_force(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE)',self.src)
    def test_five_roles_cleanup(self):
        for n in ['car02_r138_a_staff_ci','car02_r138_a_one_ci','car02_r138_a_two_ci','car02_r138_b_staff_ci','car02_r138_b_one_ci']:
            self.assertIn(n,self.src)
    def test_cleanup_always(self):
        x=[s for s in self.steps if s['name'].startswith('Always drop')]
        self.assertEqual(len(x),1);self.assertEqual(x[0]['if'],'always()')
    def test_upload_always(self):
        x=[s for s in self.steps if str(s.get('uses','')).startswith('actions/upload-artifact@')]
        self.assertEqual(len(x),1);self.assertEqual(x[0]['if'],'always()')
    def test_artifact_retention(self):
        x=[s for s in self.steps if str(s.get('uses','')).startswith('actions/upload-artifact@')][0]
        self.assertEqual(x['with']['retention-days'],7)
    def test_no_artifact_production(self):self.assertEqual(self.steps[-1]['with']['path'],'qa-evidence-r227/')
    def test_pytest_105(self):self.assertIn('Ran 106 tests in ',self.src)
    def test_three_rounds(self):self.assertIn('for round in 1 2 3; do',self.src)
    def test_proof_file(self):self.assertIn('r227-shadow-proof.json',self.src)
    def test_proof_validator(self):self.assertIn('verify_report(p)',self.src)
    def test_proof_no_auth_claim(self):self.assertIn("not p['realAuthenticationVerified']",self.src)
    def test_no_go_hold(self):
        self.assertIn("p['release']=='NO_GO'",self.src)
        self.assertIn("p['migration']=='HOLD'",self.src)
    def test_twelve_gates(self):self.assertIn("p['realWorldGatesOpen']==12",self.src)
    def test_source_pins(self):self.assertEqual(len(PINS),17)
    def test_pin_twice(self):
        for path,sha in PINS.items():
            needle=f'git rev-parse HEAD:{path}'
            self.assertEqual(self.src.count(needle),2)
            self.assertEqual(self.src.count("= '"+sha+"'"),2)
    def test_scripts_shell(self):
        for script in self.scripts:
            p=subprocess.run(['bash','-n'],input=script,capture_output=True,text=True)
            self.assertEqual(p.returncode,0,p.stderr)
    def test_each_run_strict(self):
        for s in self.steps:
            if 'run' in s:self.assertTrue(s['run'].lstrip().startswith('set -euo pipefail'))
    def test_shas_format(self):self.assertTrue(all(re.fullmatch('[a-f0-9]{40}',s) for s in PINS.values()))
    def test_no_other_schema(self):self.assertNotIn('DROP SCHEMA public',self.src)
    def test_output_contains_marker(self):self.assertIn('R227_PG17_DEFINER_CATALOG_TEMP_SHADOW_SIX_WRITES_REPLAY_DENIAL_NO_GO_HOLD_PASS',self.src)
    def test_service_auth_not_exposed(self):self.assertNotIn('id-token: write',self.src)
    def test_path_match(self):self.assertTrue(WF.is_file())
    def test_max_step_count(self):self.assertEqual(len(self.scripts),8)
    def test_qa_dont_commit(self):self.assertNotIn('git push',self.src)
    def test_qa_not_merge(self):self.assertNotIn('merge',self.low)
    def test_strict_secrets(self):self.assertNotIn('DOCKER_HOST',self.src)
    def test_exact_job(self):self.assertEqual(list(self.doc['jobs']),['synthetic-pg17-definer-shadow-only'])
    def test_release_lock_marker(self):self.assertIn('R227_NO_GO_HOLD_12_GATES_OPEN',self.src)
    def test_pin_marker(self):self.assertIn('R227_SEVENTEEN_SOURCE_PINS_PASS',self.src)
    def test_last_step_upload(self):self.assertIn('actions/upload-artifact@v5',self.steps[-1]['uses'])
    def test_clean_first(self):self.assertLess(self.src.index('Always drop disposable'),self.src.index('Recheck protected sources'))

if __name__=='__main__':unittest.main()

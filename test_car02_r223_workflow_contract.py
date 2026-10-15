#!/usr/bin/env python3
"""R223: fail-closed manual-only disposable PG17 workflow contract."""
from pathlib import Path
import ast,re,subprocess,unittest,yaml
from test_car02_r220_workflow_contract import PINS as PRIOR
PINS=dict(PRIOR,**{'car02_r218_tenant_namespace_race_isolated.py':'c1bbe5cff75a4709df0d09791df1ab424bb9156f'})
FILE=Path('.github/workflows/car02-r221-r223-pg17-forged-owner-ops-hold-qa.yml')
class R223(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text=FILE.read_text(encoding='utf-8');cls.low=cls.text.lower()
        cls.spec=yaml.safe_load(cls.text)
        cls.job=cls.spec['jobs']['synthetic-pg17-forged-owner-ops-only']
        cls.steps=cls.job['steps'];cls.scripts=[x['run'] for x in cls.steps if 'run' in x]
    def test_embedded_python_compile(self):
        for i,script in enumerate(self.scripts):
            for j,m in enumerate(re.finditer(r"(?m)^PY(?:VERIFY|HOLD)$",script)):
                pass
            for j,block in enumerate(re.findall(r"(?s)<<'PY(?:VERIFY|HOLD)'\n(.*?)\nPY(?:VERIFY|HOLD)",script)):
                with self.subTest(step=i,block=j):ast.parse(block)
    def test_both_proof_verifiers(self):
        self.assertEqual(self.text.count('from car02_r221_forged_owner_ops_isolated import verify_report'),2)
    def test_manual(self):self.assertIn('  workflow_dispatch:',self.text)
    def test_no_push(self):self.assertNotIn('  push:',self.text)
    def test_no_pr(self):self.assertNotIn('  pull_request:',self.text)
    def test_no_schedule(self):self.assertNotIn('  schedule:',self.text)
    def test_read_only(self):self.assertIn('permissions:\n  contents: read\n',self.text)
    def test_no_write(self):self.assertNotIn(': write',self.low)
    def test_no_tokens(self):self.assertNotIn('github.token',self.low)
    def test_no_id_token(self):self.assertNotIn('id-token:',self.low)
    def test_no_secret(self):self.assertNotIn('secrets.',self.low)
    def test_no_supabase(self):self.assertNotIn('supabase_url',self.low)
    def test_no_service_role(self):self.assertNotIn('service_role_key',self.low)
    def test_no_database_url(self):self.assertNotIn('database_url',self.low)
    def test_no_deploy(self):
        for text in ('wrangler','cloudflare','api.line.me','git push','docker push','kubectl apply'):
            with self.subTest(text=text):self.assertNotIn(text,self.low)
    def test_one_job(self):self.assertEqual(len(self.spec['jobs']),1)
    def test_pg17(self):self.assertEqual(self.job['services']['postgres']['image'],'postgres:17')
    def test_runner(self):self.assertEqual(self.job['runs-on'],'ubuntu-24.04')
    def test_timeout(self):self.assertEqual(self.job['timeout-minutes'],20)
    def test_env(self):self.assertEqual(self.job['env']['R221_DISPOSABLE_QA'],'yes')
    def test_hold_env(self):self.assertEqual(self.job['env']['CAR02_RELEASE_LOCK'],'true')
    def test_checkout(self):self.assertIn('actions/checkout@v5',self.text)
    def test_credentials(self):self.assertIn('persist-credentials: false',self.text)
    def test_ten_steps(self):self.assertEqual(len(self.steps),10)
    def test_scripts_bash_syntax(self):
        for i,s in enumerate(self.scripts):
            with self.subTest(i=i):
                o=subprocess.run(['bash','-n'],input=s,text=True,capture_output=True)
                self.assertEqual(o.returncode,0,o.stderr)
    def test_r222_three(self):self.assertIn('for round in 1 2 3;',self.text)
    def test_r222_count(self):self.assertIn('Ran 78 tests in ',self.text)
    def test_r222_file(self):self.assertIn('python3 -m unittest -v test_car02_r222_forged_owner_ops.py',self.text)
    def test_r223_file(self):self.assertIn('python3 -m unittest -v test_car02_r223_workflow_contract.py',self.text)
    def test_new_probe(self):self.assertIn('python3 car02_r221_forged_owner_ops_isolated.py',self.text)
    def test_after_cleanup_import_and_proof_path(self):
        tail=self.text[self.text.index("python3 - <<'PYHOLD'"):]
        self.assertIn('from car02_r221_forged_owner_ops_isolated import verify_report',tail)
        self.assertIn('r221-forged-owner-operations-proof.json',tail)
        self.assertIn('assert verify_report(p)',tail)
        self.assertNotIn('valid_report',tail)
    def test_no_stale_proof_path(self):
        self.assertNotIn('r221-forged-owner-ops-race-proof.json',self.text)
    def test_no_prior_probe(self):self.assertNotIn('python3 car02_r218_tenant_namespace_race_isolated.py',self.text)
    def test_json_proof(self):self.assertIn('r221-forged-owner-operations-proof.json',self.text)
    def test_four_stages(self):self.assertIn("len(proof['stages'])==len(STAGES)==4",self.text)
    def test_eight_attackers(self):self.assertIn("len(x['attacks'])==N==8",self.text)
    def test_immutability(self):self.assertIn("x['before']==x['afterDenied']",self.text)
    def test_cleanup(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE);',self.text)
    def test_always_cleanup(self):
        p=self.text.index('- name: Always remove disposable DB')
        self.assertIn('if: always()',self.text[p:p+140])
    def test_roles(self):
        for role in ('car02_r138_a_staff_ci','car02_r138_a_one_ci','car02_r138_a_two_ci','car02_r138_b_staff_ci','car02_r138_b_one_ci'):
            with self.subTest(role=role):self.assertIn(role,self.text)
    def test_all_tables(self):
        for table in ('bookings','service_cases','case_operations','booking_operations','audit_events'):
            with self.subTest(table=table):self.assertIn(table,self.text)
    def test_output_path(self):self.assertIn('qa-evidence-r221/',self.text)
    def test_short_retention(self):self.assertIn('retention-days: 7',self.text)
    def test_artifact_v5(self):self.assertIn('actions/upload-artifact@v5',self.text)
    def test_always_evidence(self):
        i=self.text.index('- name: Preserve only synthetic')
        self.assertIn('if: always()',self.text[i:i+110])
    def test_cleanup_verified(self):self.assertIn('R221_ALL_THROWAWAY_RESOURCES_DELETED',self.text)
    def test_no_go_held(self):self.assertIn('R221_R223_CLEANUP_NO_GO_HOLD_PASS',self.text)
    def test_source_pins_15(self):self.assertEqual(self.text.count('git rev-parse HEAD:'),30)
    def test_no_prod_access(self):self.assertNotIn('ALTER FUNCTION',self.text)
    def test_source_second_pin(self):
        p=self.text.index('- name: Verify immutable original sources')
        self.assertGreater(self.text[p:].count('git rev-parse HEAD:'),0)
    def test_sha(self):self.assertIn("proof['githubCommit']==os.environ['GITHUB_SHA']",self.text)
    def test_holds(self):self.assertIn("proof['realWorldGatesOpen']==12",self.text)
    def test_cancel_false(self):self.assertIn('cancel-in-progress: false',self.text)

for name,sha in PINS.items():
    def make(name=name,sha=sha):
        def test(self):
            self.assertEqual(self.text.count(f'test "$(git rev-parse HEAD:{name})" = \'{sha}\''),2)
        return test
    setattr(R223,'test_pin_'+re.sub('[^a-zA-Z0-9]','_',name),make())
if __name__=='__main__':unittest.main()

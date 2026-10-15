#!/usr/bin/env python3
"""R232: fail-closed workflow, source pin, disposal and policy test, local only."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import subprocess
import unittest
import yaml

ROOT=Path(__file__).resolve().parent
WORKFLOW=ROOT/'.github/workflows/car02-r230-r232-pg17-ddl-tamper-hold-qa.yml'
SOURCE=WORKFLOW.read_text()
DOCUMENT=yaml.safe_load(SOURCE)
JOB=DOCUMENT['jobs']['disposable-pg17-ddl-tamper-only']
STEPS=JOB['steps']
PINS={'R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql': '3784f8a28549bc40343646bf88657c9d9b0b80f2', 'car02_r138_pg17_lifecycle_qa.py': 'ff98dd74916ff3ea77412b986138151a4fddab90', 'car02_r159_concurrent_booking_isolated.py': '318921e951cf1578bb00f32eb77f2054ca350ed6', 'car02_r171_rejection_immutability_isolated.py': '23f082a6b247d26cb772c6eee5084000f12d72a2', 'car02_r188_role_escalation_isolated.py': 'd61fc9d6d2248e1851187a6b20dea4184fea564d', 'car02_r191_transaction_rollback_isolated.py': '7bf3c1b690db14e6dcbe27831d18231488c91d5f', 'car02_r194_savepoint_atomicity_isolated.py': 'b30b081cc019692739e8a4182be00bed73ed1ecc', 'car02_r197_error_recovery_isolated.py': '561a282301a5133f37881a04a8459a0ca87b05e1', 'car02_r200_lock_timeout_isolated.py': '565d6d0528b23202bbb61910b83bad0b8678370a', 'car02_r203_deadlock_recovery_isolated.py': '084906c336dcd2011fdadc1eca8f264ccd423327', 'car02_r206_disconnect_atomicity_isolated.py': '110c7640b9cdf233741ea9fdc59d903517f983eb', 'car02_r209_commit_ack_loss_isolated.py': '72e0fd3bf6cdf536280c34fe0e8b19231b3bfe1a', 'car02_r212_parallel_replay_isolated.py': '19264cdafa04685995bd9cf24e55b22685cd1dab', 'car02_r215_first_write_race_isolated.py': '22f4a7678eac6bb87bb5c875e43d56bae13d3175', 'car02_r218_tenant_namespace_race_isolated.py': 'c1bbe5cff75a4709df0d09791df1ab424bb9156f', 'car02_r221_forged_owner_ops_isolated.py': '057f05639dcfda64585eb42089dbefceca9289ef', 'car02_r224_used_key_auth_precedence_isolated.py': '6211db3cdda6623e1d77138e61ab0049e5bca0a9', 'car02_r227_search_path_shadow_isolated.py': 'efc31b42dc982b0ba4efca968e697527140a3a87'}

def scripts():
    return [s['run'] for s in STEPS if 'run' in s]

class Contract(unittest.TestCase):
    def test_workflow_exists(self):self.assertTrue(WORKFLOW.is_file())
    def test_filename(self):self.assertEqual(WORKFLOW.name,'car02-r230-r232-pg17-ddl-tamper-hold-qa.yml')
    def test_exact_job(self):self.assertEqual(list(DOCUMENT['jobs']),['disposable-pg17-ddl-tamper-only'])
    def test_explicit_dispatch(self):self.assertIn('workflow_dispatch:',SOURCE)
    def test_permissions(self):self.assertEqual(DOCUMENT['permissions'],{'contents':'read'})
    def test_no_push_event(self):self.assertNotIn('push:',SOURCE)
    def test_no_schedule_event(self):self.assertNotIn('schedule:',SOURCE)
    def test_no_deploy(self):self.assertNotIn('deploy',SOURCE.lower())
    def test_no_prod_secret(self):
        for name in ['SUPABASE_URL','SERVICE_ROLE_KEY','CLOUDFLARE_API_TOKEN','LINE_CHANNEL_ACCESS_TOKEN','DATABASE_URL']:
            self.assertNotIn(name,SOURCE)
    def test_checkout_nonpersistent(self):
        self.assertEqual(STEPS[0]['uses'],'actions/checkout@v5')
        self.assertIs(STEPS[0]['with']['persist-credentials'],False)
    def test_no_write_token(self):self.assertNotIn('id-token: write',SOURCE)
    def test_pinned_postgres_17(self):self.assertEqual(JOB['services']['postgres']['image'],'postgres:17')
    def test_short_timeout(self):self.assertLessEqual(JOB['timeout-minutes'],20)
    def test_ubuntu_runner(self):self.assertEqual(JOB['runs-on'],'ubuntu-24.04')
    def test_no_cancel(self):self.assertIs(JOB['concurrency']['cancel-in-progress'],False) if 'concurrency' in JOB else self.assertIs(DOCUMENT['concurrency']['cancel-in-progress'],False)
    def test_environment_qa(self):self.assertEqual(JOB['env']['R230_DISPOSABLE_QA'],'yes')
    def test_environment_hold(self):self.assertEqual(JOB['env']['CAR02_RELEASE_LOCK'],'true')
    def test_exact_ten_steps(self):self.assertEqual(len(STEPS),10)
    def test_cleanup_always(self):self.assertEqual(STEPS[7]['if'],'always()')
    def test_upload_always(self):self.assertEqual(STEPS[-1]['if'],'always()')
    def test_artifact_seven_days(self):self.assertEqual(STEPS[-1]['with']['retention-days'],7)
    def test_artifact_no_other_data(self):self.assertEqual(STEPS[-1]['with']['path'],'qa-evidence-r230/')
    def test_temporary_db_name(self):self.assertIn('car02_r138_qa_ci',SOURCE)
    def test_no_other_database_create(self):self.assertEqual(SOURCE.count('CREATE DATABASE '),1)
    def test_exact_drop_db(self):self.assertIn('DROP DATABASE IF EXISTS car02_r138_qa_ci WITH (FORCE)',SOURCE)
    def test_drop_all_roles(self):self.assertIn('for role in car02_r138_a_staff_ci car02_r138_a_one_ci car02_r138_a_two_ci car02_r138_b_staff_ci car02_r138_b_one_ci',SOURCE)
    def test_cleanup_assert(self):self.assertIn('R230_ALL_THROWAWAY_RESOURCES_DELETED',SOURCE)
    def test_fixture_empty_assert(self):self.assertIn('R230_EMPTY_FIVE_TABLES_PASS',SOURCE)
    def test_probe_exact(self):self.assertIn('python3 car02_r230_ddl_tamper_isolated.py --cid "$CID" --commit "$GITHUB_SHA"',SOURCE)
    def test_after_cleanup_validate(self):self.assertIn("p=json.loads(Path('qa-evidence-r230/r230-ddl-tamper-proof.json')",STEPS[8]['run'])
    def test_proof_validator(self):self.assertEqual(SOURCE.count('verify_proof(p)'),2)
    def test_no_go(self):self.assertIn("p['release']=='NO_GO'",SOURCE)
    def test_hold(self):self.assertIn("p['migration']=='HOLD'",SOURCE)
    def test_open_gates(self):self.assertIn("p['realWorldGatesOpen']==12",SOURCE)
    def test_production_untouched(self):self.assertIn("p['productionTouched'] is False",SOURCE)
    def test_3_rounds(self):self.assertIn('for round in 1 2 3; do',SOURCE)
    def test_129_units(self):self.assertIn("'^Ran 129 tests in '",SOURCE)
    def test_digest_pin_count(self):self.assertEqual(len(PINS),18)
    def test_strict_bash_each_step(self):
        self.assertEqual(len(scripts()),8)
        for s in scripts():self.assertTrue(s.lstrip().startswith('set -euo pipefail'))
    def test_bash_syntax(self):
        for s in scripts():
            p=subprocess.run(['bash','-n'],input=s,text=True,capture_output=True)
            self.assertEqual(p.returncode,0,p.stderr)
    def test_postgres_container_not_prod(self):
        self.assertNotIn('https://',SOURCE)
        self.assertNotIn('ssh ',SOURCE)
    def test_no_auto_merge(self):self.assertNotIn('gh pr merge',SOURCE)
    def test_no_git_push(self):self.assertNotIn('git push',SOURCE)
    def test_no_user_inputs(self):self.assertNotIn('inputs.',SOURCE)
    def test_qa_no_persistent_data(self):self.assertIn('Always remove disposable PG17 database and five roles',SOURCE)
    def test_after_no_go_gate(self):
        self.assertLess(SOURCE.index('Always remove disposable PG17'),SOURCE.index('Verify immutable pins evidence'))


def mk_pin_test(path,sha):
    def check(self):
        actual=(ROOT/path).read_bytes()
        blob=hashlib.sha1(b'blob '+str(len(actual)).encode()+b'\0'+actual).hexdigest()
        self.assertEqual(blob,sha)
        self.assertEqual(SOURCE.count(f'git rev-parse HEAD:{path}'),2)
        self.assertEqual(SOURCE.count("= '"+sha+"'"),2)
    return check

for index,(name,sha) in enumerate(PINS.items()):
    setattr(Contract,f'test_pin_{index:02}_{Path(name).stem.lower()}',mk_pin_test(name,sha))

if __name__=='__main__':unittest.main()

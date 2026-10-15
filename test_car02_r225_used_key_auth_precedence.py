#!/usr/bin/env python3
"""R225: strict negative and proof I/O checks, no database access."""
from __future__ import annotations
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import car02_r224_used_key_auth_precedence_isolated as r

COMMIT='b'*40

def snap(i): return {t:format(i*100+j,'032x') for j,t in enumerate(r.TABLES)}
def example():
    stages={}
    for i,stage in enumerate(r.STAGES):
        before=snap(i+1);after=snap(i+2)
        stages[stage]=dict(before=before,afterAuthorized=after,
            afterForgedReplays=after,afterOwnerReplay=after,
            attacks=[{'actor':r.ATTACKERS[stage][n%2],'sqlstate':'42501',
                      'reason':r.REASONS[stage][n%2]} for n in range(r.N)],
            authorizedResult=r.RESULTS[stage],ownerReplayResult='IDEMPOTENT',
            operationRows=1,auditRows=1,finalState=r.STATES[stage],
            key='r224_used_key_'+stage)
    doc=dict(r.LOCK,githubCommit=COMMIT,stages=stages,finalSnapshot=snap(5))
    doc['sha256']=r.seal(doc)
    return doc

class ProofTests(unittest.TestCase):
    def reject(self,d,reseal=True):
        if reseal and 'sha256' in d:d['sha256']=r.seal(d)
        with self.assertRaises(r.KeyPrecedenceError):r.validate(d)
    def test_valid(self):self.assertTrue(r.validate(example()))
    def test_four_stages(self):self.assertEqual(r.STAGES,('move','cancel','decision','report'))
    def test_release_hold(self):self.assertEqual((r.LOCK['release'],r.LOCK['migration']),('NO_GO','HOLD'))
    def test_only_disposable(self):self.assertEqual(r.LOCK['fixtureDb'],'car02_r138_qa_ci')
    def test_synthetic_five_users(self):self.assertEqual(r.LOCK['fixtureRoles'],5)
    def test_all_denials(self):self.assertEqual(r.N*len(r.STAGES),32)
    def test_missing_sha(self):
        a=example();del a['sha256'];self.reject(a,False)
    def test_bad_sha(self):
        a=example();a['sha256']='0'*64;self.reject(a,False)
    def test_bad_commit(self):
        a=example();a['githubCommit']='x'*40;self.reject(a)
    def test_missing_stage(self):
        a=example();del a['stages']['report'];self.reject(a)
    def test_extra_stage(self):
        a=example();a['stages']['unexpected']={};self.reject(a)
    def test_list_instead_dict(self):
        a=example();a['stages']=[];self.reject(a)
    def test_final_mismatch(self):
        a=example();a['finalSnapshot']=snap(12);self.reject(a)
    def test_bad_evidence_type(self):
        a=example();a['stages']['move']='FAKE';self.reject(a)
    def test_missing_phase(self):
        a=example();del a['stages']['move']['afterForgedReplays'];self.reject(a)
    def test_bad_phase_shape(self):
        a=example();a['stages']['move']['before']={};self.reject(a)
    def test_wrong_phase_hash(self):
        a=example();a['stages']['move']['before']['bookings']='XX';self.reject(a)
    def test_owner_replay_changes_db(self):
        a=example();a['stages']['move']['afterOwnerReplay']=snap(8);self.reject(a)
    def test_attacker_replay_changes_db(self):
        a=example();a['stages']['move']['afterForgedReplays']=snap(8);self.reject(a)
    def test_chain_broken(self):
        a=example();a['stages']['cancel']['before']=snap(7);self.reject(a)
    def test_no_legitimate_commit(self):
        a=example();a['stages']['cancel']['afterAuthorized']=a['stages']['cancel']['before'];self.reject(a)
    def test_false_owner_replay(self):
        a=example();a['stages']['cancel']['ownerReplayResult']='CREATED';self.reject(a)
    def test_wrong_audit(self):
        a=example();a['stages']['cancel']['auditRows']=2;self.reject(a)
    def test_bool_as_count(self):
        a=example();a['stages']['cancel']['auditRows']=True;self.reject(a)
    def test_wrong_ops(self):
        a=example();a['stages']['report']['operationRows']=0;self.reject(a)
    def test_wrong_authorized(self):
        a=example();a['stages']['decision']['authorizedResult']='IDEMPOTENT';self.reject(a)
    def test_wrong_state(self):
        a=example();a['stages']['report']['finalState']='OPEN';self.reject(a)
    def test_bad_key(self):
        a=example();a['stages']['move']['key']='new-key';self.reject(a)
    def test_bad_attack_list(self):
        a=example();a['stages']['move']['attacks']={};self.reject(a)
    def test_attack_missing(self):
        a=example();a['stages']['move']['attacks'].pop();self.reject(a)
    def test_swap_two_attacks(self):
        a=example();x=a['stages']['move']['attacks'];x[0],x[1]=x[1],x[0];self.reject(a)
    def test_deny_success_imposter(self):
        a=example();a['stages']['move']['attacks'][0]['reason']='IDEMPOTENT';self.reject(a)
    def test_wrong_sqlstate(self):
        a=example();a['stages']['move']['attacks'][0]['sqlstate']='22023';self.reject(a)
    def test_no_actual_auth(self):
        a=example();a['realAuthenticationVerified']=True;self.reject(a)
    def test_no_release(self):
        a=example();a['release']='GO';self.reject(a)
    def test_no_production(self):
        a=example();a['productionTouched']=True;self.reject(a)
    def test_not_network_test(self):
        a=example();a['externalWitnessVerified']=True;self.reject(a)
    def test_unsafe_proof_cannot_be_saved(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'proof.json';d=example();d['migration']='DEPLOY';d['sha256']=r.seal(d)
            with self.assertRaises(r.KeyPrecedenceError):r.save(d,path)
            self.assertFalse(path.exists())
    def test_save_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'proof.json';r.save(example(),path)
            self.assertTrue(r.validate(json.loads(path.read_text(encoding='ascii'))))
            with self.assertRaises(r.KeyPrecedenceError):r.save(example(),path)
    def test_parent_missing(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.KeyPrecedenceError):r.save(example(),Path(td)/'x'/'proof.json')
    def test_no_string_path(self):
        with self.assertRaises(r.KeyPrecedenceError):r.save(example(),'output.json')
    def test_probe_invalid_commit_before_any_io(self):
        with self.assertRaises(r.KeyPrecedenceError):r.probe('invalid','invalid')
    def test_require_exact_flags(self):
        with patch.dict('os.environ',{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R224_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.KeyPrecedenceError):r.probe('e'*64,COMMIT)

def tamper_case(stage,field,value):
    def check(self):
        x=example();x['stages'][stage][field]=copy.deepcopy(value)
        self.reject(x)
    return check
for stage in r.STAGES:
    for field,value in [
        ('ownerReplayResult','CREATED'),('operationRows',2),('auditRows',2),
        ('finalState','FORGED'),('authorizedResult','IDEMPOTENT'),
        ('key','stolen_key'),('afterForgedReplays',snap(99)),
        ('afterOwnerReplay',snap(98))]:
        setattr(ProofTests,f'test_tamper_{stage}_{field}',tamper_case(stage,field,value))
for stage in r.STAGES:
    for idx in range(r.N):
        def check(self,s=stage,n=idx):
            x=example();x['stages'][s]['attacks'][n]['actor']='as';self.reject(x)
        setattr(ProofTests,f'test_attack_identity_{stage}_{idx}',check)


class SourceOrderTests(unittest.TestCase):
    def test_booking_owner_precedes_request_key_replay(self):
        sql=Path('R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql').read_text()
        part=sql.split('CREATE FUNCTION car02_r138_qa.change_booking(',1)[1]
        self.assertLess(part.index("R138_OWNER_DENIED"),part.index('FROM car02_r138_qa.booking_operations WHERE shop_code=v_shop AND request_key=p_key'))
    def test_case_owner_precedes_request_key_replay(self):
        sql=Path('R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql').read_text()
        part=sql.split('CREATE FUNCTION car02_r138_qa.case_step(',1)[1].split('CREATE FUNCTION car02_r138_qa.change_booking(',1)[0]
        self.assertLess(part.index('R138_OWNER_DENIED'),part.index('FROM car02_r138_qa.case_operations WHERE shop_code=v_shop AND request_key=p_key'))

for stage in r.STAGES:
    def concurrent_denial_test(self,stage=stage):
        with patch('car02_r221_forged_owner_ops_isolated.denied',
                   side_effect=lambda cid,actor,sql,reason: {'actor':actor,'sqlstate':'42501','reason':reason}):
            actual=r.parallel_denials('e'*64,stage,lambda:'SYNTHETIC_SCOPE_ONLY')
            self.assertEqual(actual,[{'actor':r.ATTACKERS[stage][i%2],
                'sqlstate':'42501','reason':r.REASONS[stage][i%2]} for i in range(8)])
    setattr(SourceOrderTests,'test_parallel_attack_'+stage,concurrent_denial_test)

if __name__=='__main__':unittest.main()

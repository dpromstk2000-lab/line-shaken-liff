#!/usr/bin/env python3
"""R166: adversarial self-tests for R165 synthetic report and guardrails."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import car02_r165_interleaving_isolated as r

COMMIT='b'*40

def example():
    cases=[]
    for i in range(3):
        cases.append({
          'ownerKey':['CREATED','REJECTED'] if i%2==0 else ['REJECTED','CREATED'],
          'moveCancel':['MOVED','REJECTED'] if i%2==0 else ['REJECTED','CANCELLED'],
          'claimMove':['SLOT_TAKEN','MOVED'] if i%2==0 else ['CREATED','REJECTED'],
          'bookingOwner':'a1' if i%2==0 else 'a2',
          'mixedFinalState':'ACTIVE' if i%2==0 else 'CANCELLED',
          'moveClaimWinner':'MOVE' if i%2==0 else 'CLAIM',
        })
    obj=dict(r.GATES,githubCommit=COMMIT,rounds=cases)
    obj['sha256']=r.hash_body(obj)
    return obj

def rehash(obj):
    obj['sha256']=r.hash_body(obj)
    return obj

class R166Contract(unittest.TestCase):
    def rejects(self,doc):
        with self.assertRaises(r.InterleaveError):r.verify_report(rehash(doc))
    def test_001_happy(self):self.assertTrue(r.verify_report(example()))
    def test_002_proof_three_distinct_outcomes(self):
        d=example();self.assertNotEqual(d['rounds'][0],d['rounds'][1])
        self.assertTrue(r.verify_report(d))
    def test_003_wrong_sha_rejected(self):
        d=example();d['sha256']='0'*64
        with self.assertRaises(r.InterleaveError):r.verify_report(d)
    def test_004_sha_not_hex(self):
        d=example();d['sha256']='x'*64
        with self.assertRaises(r.InterleaveError):r.verify_report(d)
    def test_005_sha_missing(self):
        d=example();del d['sha256']
        with self.assertRaises(r.InterleaveError):r.verify_report(d)
    def test_006_extra_field(self):
        d=example();d['passedProduction']=True;self.rejects(d)
    def test_007_round_missing(self):
        d=example();d['rounds'].pop();self.rejects(d)
    def test_008_round_added(self):
        d=example();d['rounds'].append(copy.deepcopy(d['rounds'][0]));self.rejects(d)
    def test_009_round_string(self):
        d=example();d['rounds']='all passed';self.rejects(d)
    def test_010_owner_double_created(self):
        d=example();d['rounds'][0]['ownerKey']=['CREATED','CREATED'];self.rejects(d)
    def test_011_owner_double_denied(self):
        d=example();d['rounds'][0]['ownerKey']=['REJECTED','REJECTED'];self.rejects(d)
    def test_012_owner_wrong_winner(self):
        d=example();d['rounds'][0]['bookingOwner']='a2';self.rejects(d)
    def test_013_owner_unexpected(self):
        d=example();d['rounds'][0]['bookingOwner']='admin';self.rejects(d)
    def test_014_owner_result_unknown(self):
        d=example();d['rounds'][0]['ownerKey'][1]='OVERRIDE';self.rejects(d)
    def test_015_mixed_two_winners(self):
        d=example();d['rounds'][0]['moveCancel']=['MOVED','CANCELLED'];self.rejects(d)
    def test_016_mixed_double_reject(self):
        d=example();d['rounds'][0]['moveCancel']=['REJECTED','REJECTED'];self.rejects(d)
    def test_017_mixed_cancel_vs_state(self):
        d=example();d['rounds'][0]['mixedFinalState']='CANCELLED';self.rejects(d)
    def test_018_mixed_move_vs_state(self):
        d=example();d['rounds'][1]['mixedFinalState']='ACTIVE';self.rejects(d)
    def test_019_claim_move_both_winners(self):
        d=example();d['rounds'][0]['claimMove']=['CREATED','MOVED'];self.rejects(d)
    def test_020_claim_move_both_reject(self):
        d=example();d['rounds'][0]['claimMove']=['SLOT_TAKEN','REJECTED'];self.rejects(d)
    def test_021_claim_move_wrong_orientation(self):
        d=example();d['rounds'][0]['claimMove']=['MOVED','SLOT_TAKEN'];self.rejects(d)
    def test_022_claim_move_inconsistent_winner(self):
        d=example();d['rounds'][0]['moveClaimWinner']='CLAIM';self.rejects(d)
    def test_023_claim_move_unknown_winner(self):
        d=example();d['rounds'][0]['moveClaimWinner']='STAFF';self.rejects(d)
    def test_024_claim_move_wrong_count(self):
        d=example();d['rounds'][0]['claimMove'].append('CREATED');self.rejects(d)
    def test_025_round_extra_field(self):
        d=example();d['rounds'][0]['allDone']=True;self.rejects(d)
    def test_026_round_missing_field(self):
        d=example();del d['rounds'][1]['claimMove'];self.rejects(d)
    def test_027_round_wrong_type(self):
        d=example();d['rounds'][0]='ok';self.rejects(d)
    def test_028_commit_malformed(self):
        d=example();d['githubCommit']='b'*39;self.rejects(d)
    def test_029_commit_uppercase(self):
        d=example();d['githubCommit']='B'*40;self.rejects(d)
    def test_030_commit_nonhex(self):
        d=example();d['githubCommit']='z'*40;self.rejects(d)
    def test_031_real_io_roundtrip(self):
        with tempfile.TemporaryDirectory() as base:
            p=Path(base)/'proof.json';r.store(example(),p)
            self.assertTrue(r.verify_report(json.loads(p.read_text(encoding='ascii'))))
            self.assertGreater(p.stat().st_size,500)
    def test_032_preexisting_file_not_overwritten(self):
        with tempfile.TemporaryDirectory() as base:
            p=Path(base)/'proof.json';p.write_text('untouched')
            with self.assertRaises(r.InterleaveError):r.store(example(),p)
            self.assertEqual(p.read_text(),'untouched')
    def test_033_symlink_target_not_overwritten(self):
        with tempfile.TemporaryDirectory() as base:
            p=Path(base)/'real.json';p.write_text('original')
            alias=Path(base)/'alias.json';alias.symlink_to(p)
            with self.assertRaises(r.InterleaveError):r.store(example(),alias)
            self.assertEqual(p.read_text(),'original')
    def test_034_missing_parent_denied(self):
        with tempfile.TemporaryDirectory() as base:
            with self.assertRaises(r.InterleaveError):r.store(example(),Path(base)/'bad'/'x.json')
    def test_035_wrong_target_type(self):
        with self.assertRaises(r.InterleaveError):r.store(example(),'proof.json')
    def test_036_bad_cid_before_docker(self):
        with self.assertRaises(r.InterleaveError):r.probe('production',COMMIT)
    def test_037_bad_commit_before_docker(self):
        with self.assertRaises(r.InterleaveError):r.probe('a'*12,'bad')
    def test_038_wrong_output_before_docker(self):
        with self.assertRaises(r.InterleaveError):r.probe('a'*12,COMMIT,'/tmp/escape.json')
    def test_039_missing_env_before_docker(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R165_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.InterleaveError):r.probe('a'*12,COMMIT)
    def test_040_missing_qa_env_before_docker(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true','R165_DISPOSABLE_QA':'no'}):
            with self.assertRaises(r.InterleaveError):r.probe('a'*12,COMMIT)
    def test_041_missing_sha_env_before_docker(self):
        with patch.dict(os.environ,{'GITHUB_SHA':'f'*40,'CAR02_RELEASE_LOCK':'true','R165_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.InterleaveError):r.probe('a'*12,COMMIT)

# Re-sealed payloads cannot turn a synthetically verified report into a release authorization.
def mutation_case(k,v):
    def test(self):
        d=example();d[k]=v;self.rejects(d)
    return test
BAD={
    'version':'R166','mode':'PRODUCTION','release':'GO','migration':'READY',
    'realWorldGatesOpen':11,'syntheticOnly':False,'productionTouched':True,
    'productionAuthorized':True,'realAuthenticationVerified':True,'realRLSVerified':True,
    'externalWitnessVerified':True,'externalSignatureVerified':True,
    'independentProductionTest':True,'originalR138BUnchanged':False,
    'originalR159Unchanged':False,'originalR162Unchanged':False,
    'fixtureRoles':4,'syntheticDb':'real-production','daysTested':2,
    'crossTenantIdenticalKeyIndependent':False,'crossCustomerAccessDenied':False,
    'deniedDmlUnchanged':False,'operationsExactlyOnce':False,'auditExactlyOnce':False,
}
for name,value in BAD.items():
    setattr(R166Contract,'test_gate_'+name,mutation_case(name,value))

if __name__=='__main__':unittest.main()

#!/usr/bin/env python3
"""R163: isolated offline negative and real temporary-file roundtrip tests for R162."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import car02_r162_booking_stress_isolated as r

COMMIT='f'*40


def sample():
    x={'version':'R162','mode':'DISPOSABLE_PG17_MULTIDAY_COMPETING_SLOT_MOVE_DECISION_ONLY',
       'githubCommit':COMMIT,'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
       'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
       'realAuthenticationVerified':False,'realRLSVerified':False,
       'externalWitnessVerified':False,'externalSignatureVerified':False,
       'independentProductionTest':False,'sourceR138BUnchanged':True,
       'sourceR159Unchanged':True,'syntheticDb':'car02_r138_qa_ci','fixtureRoles':5,
       'fourRoundsVerified':True,'allReplaysVerified':True,
       'crossTenantIndependenceVerified':True,'crossCustomerRejectionsVerified':True,
       'moveAtomicRollbackVerified':True,'decisionAuditExactlyOnceVerified':True,
       'deniedRequestsUnchanged':True,
       'claimRounds':[sorted(['CREATED']+['SLOT_TAKEN']*7) for _ in range(4)],
       'moveOutcomes':['MOVED','REJECTED'],'decisionOutcomes':['APPROVED','REJECTED']}
    x['sha256']=r.seal(x)
    return x


class R163Tests(unittest.TestCase):
    def reject(self, candidate):
        candidate['sha256']=r.seal(candidate)
        with self.assertRaises((r.StressError, r.StressError)):
            r.verify_report(candidate)

    def test_good(self): self.assertTrue(r.verify_report(sample()))
    def test_one_claim_round_missing(self):
        d=sample();d['claimRounds'].pop();self.reject(d)
    def test_one_claim_round_added(self):
        d=sample();d['claimRounds'].append(d['claimRounds'][0][:]);self.reject(d)
    def test_round_overbook(self):
        d=sample();d['claimRounds'][1][1]='CREATED';self.reject(d)
    def test_round_no_winner(self):
        d=sample();d['claimRounds'][1]=['SLOT_TAKEN']*8;self.reject(d)
    def test_round_unknown_outcome(self):
        d=sample();d['claimRounds'][0][0]='UNSAFE';self.reject(d)
    def test_round_is_string(self):
        d=sample();d['claimRounds'][0]='CREATED';self.reject(d)
    def test_moves_double_winner(self):
        d=sample();d['moveOutcomes']=['MOVED','MOVED'];self.reject(d)
    def test_moves_no_winner(self):
        d=sample();d['moveOutcomes']=['REJECTED','REJECTED'];self.reject(d)
    def test_moves_wrong_type(self):
        d=sample();d['moveOutcomes']='MOVED';self.reject(d)
    def test_decision_approve_winner(self):
        d=sample();d['decisionOutcomes']=['APPROVED','REJECTED'];d['sha256']=r.seal(d)
        self.assertTrue(r.verify_report(d))
    def test_decision_decline_winner(self):
        d=sample();d['decisionOutcomes']=['DECLINED','REJECTED'];d['sha256']=r.seal(d)
        self.assertTrue(r.verify_report(d))
    def test_decision_double_winner(self):
        d=sample();d['decisionOutcomes']=['APPROVED','DECLINED'];self.reject(d)
    def test_decision_both_reject(self):
        d=sample();d['decisionOutcomes']=['REJECTED','REJECTED'];self.reject(d)
    def test_decision_unknown(self):
        d=sample();d['decisionOutcomes']=['APPROVED','OVERRIDE'];self.reject(d)
    def test_decision_extra(self):
        d=sample();d['decisionOutcomes'].append('REJECTED');self.reject(d)
    def test_modified_digest_fails(self):
        d=sample();d['sha256']='0'*64
        with self.assertRaises(r.StressError):r.verify_report(d)
    def test_added_fabricated_field(self):
        d=sample();d['externalGoApproved']=True;self.reject(d)
    def test_missing_required_field(self):
        d=sample();del d['deniedRequestsUnchanged'];self.reject(d)
    def test_commit_uppercase(self):
        d=sample();d['githubCommit']='A'*40;self.reject(d)
    def test_commit_nonhex(self):
        d=sample();d['githubCommit']='x'*40;self.reject(d)
    def test_commit_wrong_length(self):
        d=sample();d['githubCommit']='f'*39;self.reject(d)
    def test_day_generator(self):
        days=r.next_business_days();self.assertEqual(len(days),5)
        self.assertEqual(len(set(days)),5)
        self.assertTrue(all(__import__('datetime').date.fromisoformat(d).isoweekday()!=7 for d in days))
    def test_day_reject_zero(self):
        with self.assertRaises(r.StressError):r.next_business_days(0)
    def test_day_reject_bool(self):
        with self.assertRaises(r.StressError):r.next_business_days(True)
    def test_day_reject_too_many(self):
        with self.assertRaises(r.StressError):r.next_business_days(9)
    def test_real_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            out=Path(td)/'test-proof.json';r.safe_write(sample(),out)
            self.assertTrue(r.verify_report(json.loads(out.read_text(encoding='ascii'))))
            self.assertGreater(out.stat().st_size,200)
    def test_existing_output_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            out=Path(td)/'test-proof.json';r.safe_write(sample(),out)
            with self.assertRaises(r.StressError):r.safe_write(sample(),out)
    def test_parent_missing(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.StressError):r.safe_write(sample(),Path(td)/'missing'/'proof.json')
    def test_link_target_denied(self):
        with tempfile.TemporaryDirectory() as td:
            folder=Path(td);target=folder/'real.json';target.write_text('original')
            symlink=folder/'shortcut.json';symlink.symlink_to(target)
            with self.assertRaises(r.StressError):r.safe_write(sample(),symlink)
            self.assertEqual(target.read_text(),'original')
    def test_probe_denies_wrong_output_before_db(self):
        with self.assertRaises(r.StressError):r.probe('a'*12,COMMIT,'/tmp/unsafe.json')
    def test_probe_denies_untrusted_environment_before_db(self):
        with patch.dict(os.environ, {'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R162_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.StressError):r.probe('a'*12,COMMIT)
    def test_probe_denies_invalid_container_id_before_db(self):
        with self.assertRaises(r.StressError):r.probe('production',COMMIT)


def add_gate_case(key,value):
    def test(self):
        d=sample();d[key]=value;self.reject(d)
    test.__name__='test_gate_'+key
    return test

# Each critical release assertion is independently tested against tampered, re-sealed JSON.
BAD={
    'version':'R163', 'mode':'PRODUCTION', 'release':'GO', 'migration':'READY',
    'realWorldGatesOpen':11, 'syntheticOnly':False, 'productionTouched':True,
    'productionAuthorized':True, 'realAuthenticationVerified':True,
    'realRLSVerified':True,'externalWitnessVerified':True,'externalSignatureVerified':True,
    'independentProductionTest':True,'sourceR138BUnchanged':False,
    'sourceR159Unchanged':False,'syntheticDb':'production', 'fixtureRoles':4,
    'fourRoundsVerified':False, 'allReplaysVerified':False,
    'crossTenantIndependenceVerified':False,'crossCustomerRejectionsVerified':False,
    'moveAtomicRollbackVerified':False,'decisionAuditExactlyOnceVerified':False,
    'deniedRequestsUnchanged':False,
}
for k,v in BAD.items():
    setattr(R163Tests,'test_gate_'+k,add_gate_case(k,v))

if __name__=='__main__':unittest.main()

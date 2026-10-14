#!/usr/bin/env python3
"""R169: offline fail-closed counterexamples plus actual temporary evidence roundtrip."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch,Mock
import car02_r168_case_race_isolated as r

COMMIT='b'*40

def sample():
    rounds=[]
    for owner,shop in [('a1','street_house_demo'),('a2','street_house_demo'),('b1','other_demo')]:
        rounds.append({'shop':shop,'customer':owner,'reportResults':['REPORT_SAVED','REJECTED'],
          'quoteResults':['REJECTED','QUOTE_PRESENTED'],'completionResults':['COMPLETED']+['IDEMPOTENT']*5,
          'finalState':'COMPLETED','finalVersion':5,'quoteTotal':3850,'reportWinner':0,'quoteWinner':1})
    d=dict(r.GATES,githubCommit=COMMIT,rounds=rounds)
    d['sha256']=r.sha(d)
    return d

class CaseRaceContracts(unittest.TestCase):
    def deny(self,document,reseal=True):
        if reseal:document['sha256']=r.sha(document)
        with self.assertRaises(r.CaseRaceError):r.verify_report(document)
    def test_accept_clean(self):self.assertTrue(r.verify_report(sample()))
    def test_accept_other_report_winner(self):
        d=sample();a=d['rounds'][0];a['reportResults'].reverse();a['reportWinner']=1;d['sha256']=r.sha(d);self.assertTrue(r.verify_report(d))
    def test_accept_other_quote_winner(self):
        d=sample();a=d['rounds'][0];a['quoteResults'].reverse();a['quoteWinner']=0;a['quoteTotal']=2750;d['sha256']=r.sha(d);self.assertTrue(r.verify_report(d))
    def test_hash_change_rejected(self):d=sample();d['sha256']='a'*64;self.deny(d,False)
    def test_hash_missing_rejected(self):d=sample();del d['sha256'];self.deny(d,False)
    def test_commit_too_short(self):d=sample();d['githubCommit']='b';self.deny(d)
    def test_commit_uppercase(self):d=sample();d['githubCommit']='B'*40;self.deny(d)
    def test_commit_invalid_digit(self):d=sample();d['githubCommit']='z'*40;self.deny(d)
    def test_extra_claim_field(self):d=sample();d['productionApproved']=True;self.deny(d)
    def test_missing_rounds(self):d=sample();del d['rounds'];self.deny(d)
    def test_extra_round(self):d=sample();d['rounds'].append(copy.deepcopy(d['rounds'][0]));self.deny(d)
    def test_missing_round(self):d=sample();d['rounds'].pop();self.deny(d)
    def test_duplicate_owner(self):d=sample();d['rounds'][2]['customer']='a1';d['rounds'][2]['shop']='street_house_demo';self.deny(d)
    def test_missing_round_field(self):d=sample();del d['rounds'][1]['reportResults'];self.deny(d)
    def test_extra_round_field(self):d=sample();d['rounds'][1]['signature']='valid';self.deny(d)
    def test_report_double_saved(self):d=sample();d['rounds'][0]['reportResults']=['REPORT_SAVED']*2;self.deny(d)
    def test_report_both_rejected(self):d=sample();d['rounds'][0]['reportResults']=['REJECTED']*2;self.deny(d)
    def test_report_unexpected(self):d=sample();d['rounds'][0]['reportResults']=['REPORT_SAVED','OK'];self.deny(d)
    def test_report_wrong_payload_type(self):d=sample();d['rounds'][0]['reportResults']='REPORT_SAVED';self.deny(d)
    def test_report_wrong_winner_index(self):d=sample();d['rounds'][0]['reportWinner']=1;self.deny(d)
    def test_report_bad_winner_type(self):d=sample();d['rounds'][0]['reportWinner']=True;self.deny(d)
    def test_quote_both_saved(self):d=sample();d['rounds'][0]['quoteResults']=['QUOTE_PRESENTED']*2;self.deny(d)
    def test_quote_both_rejected(self):d=sample();d['rounds'][0]['quoteResults']=['REJECTED']*2;self.deny(d)
    def test_quote_wrong_winner_index(self):d=sample();d['rounds'][0]['quoteWinner']=0;self.deny(d)
    def test_quote_bad_total(self):d=sample();d['rounds'][0]['quoteTotal']=0;self.deny(d)
    def test_quote_string_total(self):d=sample();d['rounds'][0]['quoteTotal']='3850';self.deny(d)
    def test_quote_total_winner_mismatch(self):d=sample();d['rounds'][0]['quoteTotal']=2750;self.deny(d)
    def test_quote_bool_total(self):d=sample();d['rounds'][0]['quoteTotal']=True;self.deny(d)
    def test_completion_double_completed(self):d=sample();d['rounds'][0]['completionResults']=['COMPLETED']*2+['IDEMPOTENT']*4;self.deny(d)
    def test_completion_never_completed(self):d=sample();d['rounds'][0]['completionResults']=['IDEMPOTENT']*6;self.deny(d)
    def test_completion_status_modified(self):d=sample();d['rounds'][0]['finalState']='APPROVED';self.deny(d)
    def test_completion_version_wrong(self):d=sample();d['rounds'][0]['finalVersion']=4;self.deny(d)
    def test_completion_version_bool(self):d=sample();d['rounds'][0]['finalVersion']=True;self.deny(d)
    def test_wrong_shop(self):d=sample();d['rounds'][2]['shop']='street_house_demo';self.deny(d)
    def test_wrong_owner(self):d=sample();d['rounds'][1]['customer']='a1';self.deny(d)
    def test_real_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'proof.json';r.store(sample(),p)
            self.assertTrue(r.verify_report(json.loads(p.read_text(encoding='ascii'))))
            self.assertGreater(p.stat().st_size,1000)
    def test_existing_file_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'proof.json';r.store(sample(),p)
            with self.assertRaises(r.CaseRaceError):r.store(sample(),p)
    def test_missing_parent_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(r.CaseRaceError):r.store(sample(),Path(temp)/'missing'/'proof.json')
    def test_output_symlink_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);base=root/'real.txt';base.write_text('important')
            alias=root/'proof.json';alias.symlink_to(base)
            with self.assertRaises(r.CaseRaceError):r.store(sample(),alias)
            self.assertEqual(base.read_text(),'important')
    def test_probe_no_docker_wrong_path(self):
        with self.assertRaises(r.CaseRaceError):r.probe('a'*12,COMMIT,'/tmp/live.txt')
    def test_probe_no_docker_unknown_container(self):
        with self.assertRaises(r.CaseRaceError):r.probe('not-a-container',COMMIT)
    def test_probe_no_docker_env_wrong(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R168_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.CaseRaceError):r.probe('a'*12,COMMIT)
    def test_concurrent_sql_rejects_dml(self):
        with self.assertRaises(AssertionError):r.concurrent_sql('a'*12,'as','DELETE FROM public.foo;','R138_BAD_COMMAND','COMPLETED')
    def test_concurrent_sql_requires_exact_accept(self):
        with patch.object(r,'concurrent_sql',return_value='REPORT_SAVED') as mock:
            res=r.sql_case_step('a'*12,'as','test_report_key',1,'REPORT',1,note='a valid report',accepted='REPORT_SAVED',rejected='R138_REPLAY_MISMATCH')
            self.assertEqual(res,'REPORT_SAVED');self.assertIn('SELECT car02_r138_qa.case_step(',mock.call_args.args[2])

def gate_case(key,value):
    def test(self):
        d=sample();d[key]=value;self.deny(d)
    return test

BAD={
 'version':'R169','mode':'REAL_AUTH','release':'GO','migration':'READY',
 'realWorldGatesOpen':11,'syntheticOnly':False,'productionTouched':True,
 'productionAuthorized':True,'realAuthenticationVerified':True,'realRLSVerified':True,
 'externalWitnessVerified':True,'externalSignatureVerified':True,
 'independentProductionTest':True,'originalR138BUnchanged':False,
 'originalR159Unchanged':False,'originalR162Unchanged':False,
 'originalR165Unchanged':False,'syntheticDb':'live','fixtureRoles':4,
 'casesTested':2,'concurrentReportOneWinner':False,
 'concurrentQuoteOneWinner':False,'approvalOwnerBound':False,
 'completionIdempotent':False,'deniedOperationsImmutable':False,
 'auditsExactlyOnce':False,'crossShopIsolated':False,
}
for key,value in BAD.items():setattr(CaseRaceContracts,'test_gate_'+key,gate_case(key,value))
if __name__=='__main__':unittest.main()

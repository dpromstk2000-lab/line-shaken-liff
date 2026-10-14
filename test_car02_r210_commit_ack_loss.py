#!/usr/bin/env python3
"""R210: offline adversarial proof, response-discard and I/O regression tests."""
import copy,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock,patch
import car02_r209_commit_ack_loss_isolated as r
COMMIT='f'*40

def snap(i):return {n:format(i*100+j,'032x') for j,n in enumerate(r.TABLES)}
def sample():
    records={}
    for i,n in enumerate(r.SCENARIOS):
        records[n]={'before':snap(i+1),'afterCommit':snap(i+2),
                    'afterIdenticalReplay':snap(i+2),'afterConflict':snap(i+2),
                    'firstServerCommitted':True,'firstClientResponseObserved':False,
                    'identicalReplayResult':'IDEMPOTENT','conflictSqlstate':'22023',
                    'conflictReason':r.DENIALS[n], 'operationRows':0 if n=='booking' else 1,'auditRows':1}
    doc=dict(r.LOCK,githubCommit=COMMIT,scenarios=records,finalSnapshot=snap(5))
    doc['sha256']=r.seal(doc);return doc

class R210Tests(unittest.TestCase):
    def rejected(self,d,reseal=True):
        if reseal and 'sha256' in d:d['sha256']=r.seal(d)
        with self.assertRaises(r.AckLossError):r.verify_report(d)
    def test_valid(self):self.assertTrue(r.verify_report(sample()))
    def test_exact_four(self):self.assertEqual(r.SCENARIOS,('booking','move','quote','decide'))
    def test_expected_per_scenario(self):self.assertEqual(set(r.RESULTS),set(r.DENIALS))
    def test_missing_scenario(self):
        x=sample();del x['scenarios']['quote'];self.rejected(x)
    def test_extra_scenario(self):
        x=sample();x['scenarios']['hijack']=x['scenarios']['booking'];self.rejected(x)
    def test_invalid_scenarios_type(self):
        x=sample();x['scenarios']=[];self.rejected(x)
    def test_wrong_commit_format(self):
        x=sample();x['githubCommit']='z'*40;self.rejected(x)
    def test_wrong_commit_length(self):
        x=sample();x['githubCommit']='f'*39;self.rejected(x)
    def test_digest_missing(self):
        x=sample();del x['sha256'];self.rejected(x,False)
    def test_digest_wrong(self):
        x=sample();x['sha256']='0'*64;self.rejected(x,False)
    def test_final_snapshot_wrong(self):
        x=sample();x['finalSnapshot']=snap(10);self.rejected(x)
    def test_no_production_permission(self):
        x=sample();x['productionAuthorized']=True;self.rejected(x)
    def test_no_false_network_claim(self):
        x=sample();x['networkFailureVerified']=True;self.rejected(x)
    def test_no_false_release(self):
        x=sample();x['release']='GO';self.rejected(x)
    def test_no_closed_gates(self):
        x=sample();x['realWorldGatesOpen']=0;self.rejected(x)
    def test_no_extra_field(self):
        x=sample();x['liveSecurityVerified']=True;self.rejected(x)
    def test_no_response_in_output(self):
        q="SELECT car02_r138_qa.claim_booking('r209_ack_001','foo','2026-10-15'::date,'10:00'::time);"
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=0,stderr='')) as call:
            self.assertTrue(r.execute_discarded_response('a'*12,'as',q))
            self.assertEqual(call.call_args.kwargs['stdout'],r.subprocess.DEVNULL)
            self.assertIn('ON_ERROR_STOP=1',call.call_args.args[0])
    def test_first_sql_failure(self):
        q='SELECT car02_r138_qa.claim_booking(1);'
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=3,stderr='ERROR')):
            with self.assertRaises(r.AckLossError):r.execute_discarded_response('a'*12,'as',q)
    def test_no_arbitrary_sql(self):
        with self.assertRaises(r.AckLossError):r.execute_discarded_response('a'*12,'as','DROP TABLE users;')
    def test_no_second_statement(self):
        with self.assertRaises(r.AckLossError):r.execute_discarded_response('a'*12,'as','SELECT car02_r138_qa.claim_booking(1); COMMIT;')
    def test_no_production_container(self):
        with self.assertRaises(r.AckLossError):r.execute_discarded_response('production','as','SELECT car02_r138_qa.claim_booking(1);')
    def test_no_superuser(self):
        with self.assertRaises(r.AckLossError):r.execute_discarded_response('a'*12,'postgres','SELECT car02_r138_qa.claim_booking(1);')
    def test_rejected_22023_only(self):
        q='SELECT car02_r138_qa.claim_booking(1);'
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=3,stderr='ERROR:  22023: R138_BOOKING_REPLAY_CONFLICT\n')):
            self.assertEqual(r.deny_changed_replay('a'*12,'as',q,r.DENIALS['booking']),'22023')
    def test_rejected_wrong_sqlstate(self):
        q='SELECT car02_r138_qa.claim_booking(1);'
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=3,stderr='ERROR:  42501\n')):
            with self.assertRaises(r.AckLossError):r.deny_changed_replay('a'*12,'as',q,r.DENIALS['booking'])
    def test_rejected_unexpected_success(self):
        q='SELECT car02_r138_qa.claim_booking(1);'
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=0,stderr='')):
            with self.assertRaises(r.AckLossError):r.deny_changed_replay('a'*12,'as',q,r.DENIALS['booking'])
    def test_output_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'proof.json';r.save(sample(),path)
            self.assertTrue(r.verify_report(json.loads(path.read_text(encoding='ascii'))))
    def test_no_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'proof.json';r.save(sample(),path)
            with self.assertRaises(r.AckLossError):r.save(sample(),path)
    def test_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);dest=p/'proof.json';original=p/'real.json';original.write_text('keep')
            dest.symlink_to(original)
            with self.assertRaises(r.AckLossError):r.save(sample(),dest)
            self.assertEqual(original.read_text(),'keep')
    def test_missing_parent_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(r.AckLossError):r.save(sample(),Path(tmp)/'missing'/'p.json')
    def test_probe_guard_before_db(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R209_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.AckLossError):r.probe('a'*12,COMMIT)
    def test_replay_sql_allowlist(self):
        self.assertTrue(r.scoped_sql('SELECT car02_r138_qa.case_step(1);'))
        self.assertFalse(r.scoped_sql('SELECT public.other(1);'))
        self.assertFalse(r.scoped_sql('SELECT car02_r138_qa.case_step(1); DELETE FROM users;'))

def case_mutation(name,field,value):
    def run(self):
        x=sample();x['scenarios'][name][field]=value;self.rejected(x)
    return run
for name in r.SCENARIOS:
    bad={'firstServerCommitted':False,'firstClientResponseObserved':True,'identicalReplayResult':'CREATED',
         'conflictSqlstate':'42501','conflictReason':'R138_ROLE_DENIED','operationRows':3,'auditRows':2,
         'before':{},'afterCommit':snap(300),'afterIdenticalReplay':snap(301),'afterConflict':snap(302)}
    for field,value in bad.items():
        setattr(R210Tests,'test_mutation_'+name+'_'+field,case_mutation(name,field,value))

def wrong_gate(name,val):
    def run(self):
        x=sample();x[name]=val;self.rejected(x)
    return run
for field,value in {'migration':'GO','syntheticOnly':False,'productionTouched':True,'realAuthenticationVerified':True,
                    'realRLSVerified':True,'externalSignatureVerified':True,'fixtureRoles':4,
                    'previousR206Unchanged':False,'clientResponseDiscarded':False,
                    'commitBeforeRetryVerified':False,'identicalReplayNoAdditionalWrites':False}.items():
    setattr(R210Tests,'test_gate_'+field,wrong_gate(field,value))

if __name__=='__main__':unittest.main()

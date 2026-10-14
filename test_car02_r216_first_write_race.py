#!/usr/bin/env python3
"""R216 adversarial proof, concurrent runner and real-output tests (offline)."""
import copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,Mock
import car02_r215_first_write_race_isolated as r

COMMIT='a'*40

def snap(i):return {t:format(i*100+k,'032x') for k,t in enumerate(r.TABLES)}

def good():
    scenarios={};previous=None
    for i,name in enumerate(r.SCENARIOS):
        before=copy.deepcopy(previous) if previous is not None else snap(i*2+1)
        after=snap(i*2+2);previous=after
        records=[]
        for j in range(8):
            v='A' if j%2==0 else 'B'
            if j==0:status={'booking':'CREATED','move':'MOVED','quote':'QUOTE_PRESENTED','decide':'APPROVED'}[name]
            elif v=='A':status='IDEMPOTENT'
            else:status='22023:'+r.REJECTIONS[name]
            records.append(dict(variant=v,result=status))
        scenarios[name]=dict(before=before,after=after,winnerVariant='A',results=records,
                            operationRows=0 if name=='booking' else 1,auditRows=1,
                            storedValue={'booking':'13:00','move':'10:30','quote':'1500','decide':'APPROVED'}[name])
    doc=dict(r.LOCK,githubCommit=COMMIT,scenarios=scenarios,finalSnapshot=copy.deepcopy(previous))
    doc['sha256']=r.seal(doc)
    return doc

class ProofTests(unittest.TestCase):
    def reject(self,x,reseal=True):
        if reseal and 'sha256' in x:x['sha256']=r.seal(x)
        with self.assertRaises(r.FirstWriteRaceError):r.verify_report(x)
    def test_valid(self):self.assertTrue(r.verify_report(good()))
    def test_modes(self):self.assertEqual(r.SCENARIOS,('booking','move','quote','decide'))
    def test_client_count(self):self.assertEqual(r.CLIENTS,8)
    def test_b_winner_valid(self):
        x=good()
        for name,rec in x['scenarios'].items():
            rec['winnerVariant']='B'
            rec['storedValue']={'booking':'13:30','move':'14:00','quote':'1600','decide':'DECLINED'}[name]
            for j,y in enumerate(rec['results']):
                if j==1:y['result']={'booking':'CREATED','move':'MOVED','quote':'QUOTE_PRESENTED','decide':'DECLINED'}[name]
                elif j%2==1:y['result']='IDEMPOTENT'
                else:y['result']='22023:'+r.REJECTIONS[name]
        x['sha256']=r.seal(x)
        self.assertTrue(r.verify_report(x))
    def test_missing_hash(self):
        x=good();del x['sha256'];self.reject(x,False)
    def test_invalid_hash(self):
        x=good();x['sha256']='0'*64;self.reject(x,False)
    def test_unknown_field(self):
        x=good();x['productionPass']=True;self.reject(x)
    def test_missing_case(self):
        x=good();del x['scenarios']['quote'];self.reject(x)
    def test_extra_case(self):
        x=good();x['scenarios']['new']={};self.reject(x)
    def test_wrong_commit(self):
        x=good();x['githubCommit']='zzz';self.reject(x)
    def test_boolean_as_count(self):
        x=good();x['scenarios']['move']['auditRows']=True;self.reject(x)
    def test_chain_mismatch(self):
        x=good();x['scenarios']['move']['before']=snap(999);self.reject(x)
    def test_snapshots_unchanged(self):
        x=good();x['scenarios']['booking']['after']=x['scenarios']['booking']['before'];self.reject(x)
    def test_final_mismatch(self):
        x=good();x['finalSnapshot']=snap(999);self.reject(x)
    def test_unsafe_release(self):
        x=good();x['release']='GO';self.reject(x)
    def test_unsafe_migration(self):
        x=good();x['migration']='ALLOW';self.reject(x)
    def test_claim_real_network(self):
        x=good();x['realNetworkOutageVerified']=True;self.reject(x)
    def test_bad_synthetic_flag(self):
        x=good();x['syntheticOnly']=False;self.reject(x)
    def test_bad_case_results_len(self):
        x=good();x['scenarios']['move']['results'].pop();self.reject(x)
    def test_wrong_stored_winner_value(self):
        x=good();x['scenarios']['quote']['storedValue']='1600';self.reject(x)
    def test_exact_output_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'proof.json';self.assertEqual(r.safe_write(good(),p),p)
            self.assertTrue(r.verify_report(json.loads(p.read_text())))
            with self.assertRaises(r.FirstWriteRaceError):r.safe_write(good(),p)
    def test_bad_path_string(self):
        with self.assertRaises(r.FirstWriteRaceError):r.safe_write(good(),'proof.json')
    def test_missing_output_parent(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(r.FirstWriteRaceError):r.safe_write(good(),Path(d)/'missing'/'proof.json')
    def test_symlink_parent(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'real').mkdir();(root/'link').symlink_to(root/'real',target_is_directory=True)
            with self.assertRaises(r.FirstWriteRaceError):r.safe_write(good(),root/'link'/'proof.json')
    def test_symlink_target(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'actual').write_text('x');(root/'proof.json').symlink_to(root/'actual')
            with self.assertRaises(r.FirstWriteRaceError):r.safe_write(good(),root/'proof.json')
    def test_corrupted_json_io(self):
        with tempfile.TemporaryDirectory() as d:
            x=good();x['scenarios']['quote']['auditRows']=2
            with self.assertRaises(r.FirstWriteRaceError):r.safe_write(x,Path(d)/'proof.json')
    def test_parallel_runner_eight(self):
        with patch.object(r,'call',side_effect=lambda cid,actor,sql,case:sql):
            a=r.parallel_first_writes('a'*12,'as','sql-a','sql-b','booking')
        self.assertEqual([x['variant'] for x in a],['A','B']*4)
        self.assertEqual([x['result'] for x in a],['sql-a','sql-b']*4)
    def test_parallel_scope(self):
        with self.assertRaises(r.FirstWriteRaceError):r.parallel_first_writes('?', 'as','x','y','booking')
    def test_nonallowed_sql(self):
        with self.assertRaises(r.FirstWriteRaceError):r.call('a'*12,'as','DROP TABLE x;','booking')
    def test_query_injection(self):
        with self.assertRaises(r.FirstWriteRaceError):r.call('a'*12,'as',"SELECT car02_r138_qa.claim_booking('a'); DROP TABLE z;",'booking')
    def test_bad_actor(self):
        with self.assertRaises(r.FirstWriteRaceError):r.call('a'*12,'postgres','SELECT car02_r138_qa.claim_booking(1);','booking')

# Generate independent mutation tests. Every test gets a fresh object, resealed.
for case in r.SCENARIOS:
    for idx in range(8):
        def wrong_result(self,case=case,idx=idx):
            x=good();x['scenarios'][case]['results'][idx]['result']='IDEMPOTENT' if idx%2 else '22023:WRONG'
            self.reject(x)
        setattr(ProofTests,f'test_bad_result_{case}_{idx}',wrong_result)
    for mutation in ('winner','audit','op','stored','before_field','result_type','extra','no_commit'):
        def wrong_field(self,case=case,mutation=mutation):
            x=good();z=x['scenarios'][case]
            if mutation=='winner':z['winnerVariant']='C'
            elif mutation=='audit':z['auditRows']=2
            elif mutation=='op':z['operationRows']=8
            elif mutation=='stored':z['storedValue']='FORGED'
            elif mutation=='before_field':z['before']['forged']='a'*32
            elif mutation=='result_type':z['results'][1]['result']=True
            elif mutation=='extra':z['extra']='x'
            else:z['after']=z['before']
            self.reject(x)
        setattr(ProofTests,f'test_bad_{mutation}_{case}',wrong_field)

if __name__=='__main__':unittest.main()

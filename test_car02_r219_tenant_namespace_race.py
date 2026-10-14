#!/usr/bin/env python3
"""R219: offline falsification, concurrency, namespace, and real-file QA for R218."""
from __future__ import annotations
import copy, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import car02_r218_tenant_namespace_race_isolated as r

COMMIT='f'*40

def snap(i):return {name:format(100+i*10+j,'032x') for j,name in enumerate(r.TABLES)}

def example(ow='A',sw='B'):
    def result(winner,positive,negative):
        values=[];won=False
        for idx in range(8):
            variant='A' if idx%2==0 else 'B'
            if variant!=winner:answer=negative
            elif not won:answer=positive;won=True
            else:answer='IDEMPOTENT'
            values.append({'variant':variant,'result':answer})
        return values
    stages={
      'cross_shop_booking':{'before':snap(0),'after':snap(1),'results':['CREATED','CREATED'],
                 'stats':{'shopRows':dict.fromkeys(r.SHOPS,1),'shopAudits':dict.fromkeys(r.SHOPS,1)}},
      'same_shop_owner_key':{'before':snap(1),'after':snap(2),
          'results':result(ow,'CREATED','22023:R138_BOOKING_REPLAY_CONFLICT'),
          'stats':{'winner':ow,'requestRows':1,'auditRows':1}},
      'same_shop_slot':{'before':snap(2),'after':snap(3),
          'results':result(sw,'CREATED','SLOT_TAKEN'),
          'stats':{'winner':sw,'activeRows':1,'auditRows':1}},
      'cross_shop_case':{'before':snap(3),'after':snap(4),'results':['OPENED','OPENED'],
           'stats':{'shopRows':dict.fromkeys(r.SHOPS,1),'shopAudits':dict.fromkeys(r.SHOPS,1)}},
    }
    count=r.expected_visibility(ow,sw)
    visibility={}
    for actor in r.ACTORS:
        numcase=int(actor in ('as','a1','bs','b1'))
        visibility[actor]={'bookings':count[actor],'service_cases':numcase,
                           'case_operations':0,'booking_operations':0,
                           'audit_events':count[actor]+numcase}
    proof=dict(r.LOCK,githubCommit=COMMIT,stages=stages,
               visibility=visibility,finalSnapshot=snap(4))
    proof['sha256']=r.seal(proof)
    return proof

class R219(unittest.TestCase):
    def deny(self,doc,reseal=True):
        if reseal and 'sha256' in doc:doc['sha256']=r.seal(doc)
        with self.assertRaises(r.NamespaceError):r.valid_report(doc)
    def test_valid_a_b(self):self.assertTrue(r.valid_report(example('A','B')))
    def test_valid_b_a(self):self.assertTrue(r.valid_report(example('B','A')))
    def test_valid_a_a(self):self.assertTrue(r.valid_report(example('A','A')))
    def test_valid_b_b(self):self.assertTrue(r.valid_report(example('B','B')))
    def test_scenario_labels(self):self.assertEqual(len(r.STAGES),4)
    def test_role_count(self):self.assertEqual(len(r.ACTORS),5)
    def test_same_shop_owner_winner(self):
        d=example();d['stages']['same_shop_owner_key']['stats']['winner']='B';self.deny(d)
    def test_same_shop_slot_winner(self):
        d=example();d['stages']['same_shop_slot']['stats']['winner']='A';self.deny(d)
    def test_fake_duplicate_audit(self):
        d=example();d['stages']['same_shop_slot']['stats']['auditRows']=2;self.deny(d)
    def test_fake_duplicate_booking(self):
        d=example();d['stages']['same_shop_owner_key']['stats']['requestRows']=2;self.deny(d)
    def test_fake_duplicate_case(self):
        d=example();d['stages']['cross_shop_case']['stats']['shopRows'][r.SHOPS[1]]=2;self.deny(d)
    def test_bad_shop_key_metric(self):
        d=example();d['stages']['cross_shop_booking']['stats']['shopAudits']['fake_shop']=1;self.deny(d)
    def test_missing_stage(self):
        d=example();d['stages'].pop('same_shop_slot');self.deny(d)
    def test_extra_stage(self):
        d=example();d['stages']['fake']=d['stages']['same_shop_slot'];self.deny(d)
    def test_modified_chain(self):
        d=example();d['stages']['same_shop_slot']['before']=snap(10);self.deny(d)
    def test_no_real_mutation(self):
        d=example();d['stages']['cross_shop_case']['after']=d['stages']['cross_shop_case']['before'];self.deny(d)
    def test_final_digest_drift(self):
        d=example();d['finalSnapshot']=snap(10);self.deny(d)
    def test_missing_hash(self):
        d=example();d.pop('sha256');self.deny(d,False)
    def test_wrong_hash(self):
        d=example();d['sha256']='0'*64;self.deny(d,False)
    def test_false_release(self):
        d=example();d['release']='GO';self.deny(d)
    def test_false_production(self):
        d=example();d['productionTouched']=True;self.deny(d)
    def test_bad_commit(self):
        d=example();d['githubCommit']='z'*40;self.deny(d)
    def test_mutated_snapshot(self):
        d=example();d['stages']['cross_shop_booking']['after']['bookings']='G'*32;self.deny(d)
    def test_role_bookings_mismatch(self):
        d=example();d['visibility']['a2']['bookings']+=1;self.deny(d)
    def test_cross_shop_leak(self):
        d=example();d['visibility']['b1']['bookings']=2;self.deny(d)
    def test_cross_owner_leak(self):
        d=example();d['visibility']['a2']['service_cases']=1;self.deny(d)
    def test_audit_leak(self):
        d=example();d['visibility']['a1']['audit_events']+=1;self.deny(d)
    def test_ops_leak(self):
        d=example();d['visibility']['as']['case_operations']=1;self.deny(d)
    def test_boolean_not_integer(self):
        d=example();d['visibility']['as']['bookings']=True;self.deny(d)
    def test_slot_taker_fake_success(self):
        d=example();d['stages']['same_shop_slot']['results'][1]['result']='SLOT_TAKEN';self.deny(d)
    def test_owner_error_reason_wrong(self):
        d=example();d['stages']['same_shop_owner_key']['results'][1]['result']='SLOT_TAKEN';self.deny(d)
    def test_owner_wrong_variant(self):
        d=example();d['stages']['same_shop_owner_key']['results'][1]['variant']='A';self.deny(d)
    def test_loser_fake_idempotent(self):
        d=example();d['stages']['same_shop_owner_key']['results'][3]['result']='IDEMPOTENT';self.deny(d)
    def test_negative_visibility(self):
        d=example();d['visibility']['b1']['case_operations']=-1;self.deny(d)
    def test_expected_visibility(self):
        self.assertEqual(r.expected_visibility('A','B'),{'as':3,'a1':2,'a2':1,'bs':1,'b1':1})
    def test_parallel_barrier(self):
        self.assertEqual(sorted(r.parallel(lambda i:i,8)),list(range(8)))
    def test_parallel_invalid(self):
        with self.assertRaises(r.NamespaceError):r.parallel(lambda i:i,9)
    def test_winner_index(self):
        self.assertEqual(r.winner([{'result':'IDEMPOTENT'},{'result':'CREATED'}]),'B')
    def test_winner_no_winner(self):
        with self.assertRaises(r.NamespaceError):r.winner([{'result':'SLOT_TAKEN'}])
    def test_no_network_secret(self):
        from pathlib import Path
        s=Path(r.__file__).read_text()
        self.assertNotIn('SUPABASE_URL',s);self.assertNotIn('service_role_key',s)
    def test_real_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'proof.json';r.save(example(),p)
            self.assertTrue(r.valid_report(json.loads(p.read_text())))
    def test_no_file_overwrite(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'proof.json';r.save(example(),p)
            with self.assertRaises(r.NamespaceError):r.save(example(),p)
    def test_symlink_denied(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'real.json';p.write_text('unchanged')
            alias=Path(td)/'alias.json';alias.symlink_to(p)
            with self.assertRaises(r.NamespaceError):r.save(example(),alias)
            self.assertEqual(p.read_text(),'unchanged')
    def test_missing_dir_denied(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.NamespaceError):r.save(example(),Path(td)/'missing'/'x.json')
    def test_bad_output_type(self):
        with self.assertRaises(r.NamespaceError):r.save(example(),'/tmp/proof.json')
    def test_counter_scoped(self):
        with self.assertRaises(r.NamespaceError):r.counted('a'*12,'a1','bookings','r218_cross_shop_key')
    def test_audit_scope(self):
        with self.assertRaises(r.NamespaceError):r.audit('a'*12,'a1','bookings','r218_cross_shop_key','BOOKED')
    def test_bad_probe_lock_before_db(self):
        with patch.dict('os.environ',{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R218_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.NamespaceError):r.probe('a'*12,COMMIT)

for field,new_value in {
 'mode':'PRODUCTION','migration':'GO','realWorldGatesOpen':0,
 'syntheticOnly':False,'productionAuthorized':True,'realAuthenticationVerified':True,
 'realRLSVerified':True,'externalWitnessVerified':True,'externalSignatureVerified':True,
 'productionReady':True,'fixtureDb':'production','fixtureRoles':6,
 'fiveTablesCovered':False,'separateShopNamespacesVerified':False,
 'sameShopOwnershipBoundaryVerified':False,'uniqueActiveSlotVerified':False,
 'originalR138BUnchanged':False,'priorR215Unchanged':False,
}.items():
    def mk(f=field,v=new_value):
        def check(self):
            d=example();d[f]=v;self.deny(d)
        return check
    setattr(R219,'test_lock_'+field,mk())

if __name__=='__main__':unittest.main()

#!/usr/bin/env python3
"""R238: strict negative tests for exact-row RLS proof, no DB required."""
from __future__ import annotations
import copy, json, re, tempfile, unittest, os
from pathlib import Path
from unittest.mock import patch
import car02_r237_exact_row_rls_isolated as r

COMMIT='b'*40

def oracle_rows(table):
    return [{'id':i,'shop':('other_demo' if i==3 else 'street_house_demo'),
             'owner':[r.ROLES['a1'],r.ROLES['a2'],r.ROLES['b1']][i-1]}
            for i in (1,2,3)]

def example():
    allrows={t:oracle_rows(t) for t in r.TABLES}
    seen={}
    for actor in r.ACTORS:
        for profile in r.PROFILES:
            seen[actor+':'+profile]=dict(currentUser=r.ROLES[actor],sessionUser=r.ROLES[actor],
                  **{t:r.relevant(allrows[t],actor) for t in r.TABLES})
    snap={t:'a'*32 for t in r.TABLES}
    d=dict(r.LOCK,githubCommit=COMMIT,oracle=allrows,readbacks=seen,
           snapshotBefore=snap,snapshotAfter=snap.copy())
    d['sha256']=r.seal(d)
    return d

class ProofTests(unittest.TestCase):
    def reject(self,d,reseal=True):
        if reseal and 'sha256' in d: d['sha256']=r.seal(d)
        with self.assertRaises(r.R237Error):r.validate(d)
    def test_valid(self):self.assertTrue(r.validate(example()))
    def test_lock(self):self.assertEqual((r.LOCK['release'],r.LOCK['migration'],r.LOCK['realWorldGatesOpen']),('NO_GO','HOLD',12))
    def test_five_tables(self):self.assertEqual(len(r.TABLES),5)
    def test_ten_profiles(self):self.assertEqual(len(r.ACTORS)*len(r.PROFILES),10)
    def test_unique_actors(self):self.assertEqual(len(set(r.ACTORS)),5)
    def test_sql_qualified(self):
        for t in r.TABLES:self.assertIn('car02_r138_qa.'+t,r.query(t))
    def test_bad_query(self):
        for t in ('bookings;', 'audit_events WHERE TRUE','pg_authid','',None):
            with self.assertRaises(r.R237Error):r.query(t)
    def test_release_flags_all_false(self):
        for f in ('productionTouched','productionAuthorized','productionReady','realAuthenticationVerified','realRLSVerified'):
            self.assertIs(r.LOCK[f],False)
    def test_probe_mock_complete(self):
        empty={t:r.hashlib.md5(b'[]').hexdigest() for t in r.TABLES}
        filled={t:'c'*32 for t in r.TABLES}
        allrows={t:oracle_rows(t) for t in r.TABLES}
        def fake_read(cid,actor,profile,table):return r.relevant(allrows[table],actor)
        def fake_identity(cid,db,actor,sql):return 'SET\nR237_ID|'+r.ROLES[actor]+','+r.ROLES[actor]
        with tempfile.TemporaryDirectory() as tmp:
            cwd=os.getcwd()
            try:
                os.chdir(tmp);Path('qa-evidence-r237').mkdir()
                with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true',
                        'R237_DISPOSABLE_QA':'yes'}),\
                     patch.object(r,'snapshot',side_effect=[empty,filled,filled]),\
                     patch.object(r,'seed'),\
                     patch.object(r,'oracle',side_effect=lambda cid,t:allrows[t]),\
                     patch.object(r,'read',side_effect=fake_read),\
                     patch('car02_r138_pg17_lifecycle_qa.psql',side_effect=fake_identity):
                    d=r.probe('a'*64,COMMIT)
                    self.assertTrue(r.validate(d))
                    self.assertTrue(Path(r.OUTPUT).exists())
            finally:os.chdir(cwd)
    def test_seed_mock_calls(self):
        with patch.object(r,'next_business_days',return_value=['2027-01-04']),\
             patch.object(r,'booking',return_value='CREATED') as b,\
             patch.object(r,'case',return_value='OPENED') as c,\
             patch.object(r,'integer',return_value=1),\
             patch.object(r,'step',side_effect=['REPORT_SAVED','QUOTE_PRESENTED']*3) as s,\
             patch.object(r,'change',return_value='MOVED') as m:
            r.seed('a'*64)
            self.assertEqual((b.call_count,c.call_count,s.call_count,m.call_count),(6,3,6,3))
    def test_actual_read_guard(self):
        for a in ('postgres','admin',None):
            with self.assertRaises(r.R237Error):r.read('a'*64,a,'baseline','bookings')
    def test_bad_snapshot(self):
        d=example();d['snapshotAfter']['bookings']='f'*32;self.reject(d)
    def test_save_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'proof.json'
            self.assertEqual(r.save(example(),path),path)
            self.assertEqual(json.loads(path.read_text()),example())
            with self.assertRaises(r.R237Error):r.save(example(),path)
    def test_save_rejects_string_path(self):
        with self.assertRaises(r.R237Error):r.save(example(),'/tmp/not-allowed.json')
    def test_save_symlink_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            real=Path(tmp)/'real';real.mkdir();link=Path(tmp)/'link';link.symlink_to(real,target_is_directory=True)
            with self.assertRaises(r.R237Error):r.save(example(),link/'x.json')
    def test_read_mock(self):
        with patch.object(r,'psql',return_value='SET\nR237_ROW|'+json.dumps(oracle_rows('bookings'))) as fake:
            result=r.read('a'*64,'as','spoof_claims_path','bookings')
            self.assertEqual(len(result),3)
            sql=fake.call_args.args[3]
            self.assertIn('SET search_path TO pg_temp, public;',sql)
            self.assertIn('request.jwt.claims',sql)
    def test_seed_uses_no_production_identifiers(self):
        source=Path(r.__file__).read_text()
        for token in ('SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL','cloudflare','api.github.com'):
            self.assertNotIn(token,source)

# Every actor, every profile and every table: mutate one seen row while
# retaining the same row COUNT. This catches count-only evidence weaknesses.
def make_swap(actor,profile,table):
    def test(self):
        d=example();key=actor+':'+profile
        original=d['readbacks'][key][table]
        replacement=[x for x in d['oracle'][table] if x not in original]
        self.assertTrue(replacement)
        row=copy.deepcopy(replacement[0]);other=copy.deepcopy(original)
        other[0]=row;other.sort(key=lambda x:x['id'])
        d['readbacks'][key][table]=other
        self.reject(d)
    return test
for actor in r.ACTORS:
    for profile in r.PROFILES:
        for table in r.TABLES:
            setattr(ProofTests,'test_same_count_foreign_row_'+actor+'_'+profile+'_'+table,
                    make_swap(actor,profile,table))

def make_missing(actor,profile,table):
    def test(self):
        d=example();d['readbacks'][actor+':'+profile][table].pop()
        self.reject(d)
    return test
for actor in r.ACTORS:
    for profile in r.PROFILES:
        for table in r.TABLES:
            setattr(ProofTests,'test_missing_row_'+actor+'_'+profile+'_'+table,
                    make_missing(actor,profile,table))

def make_wrong_owner(table):
    def test(self):
        d=example();d['oracle'][table][0]['owner']=r.ROLES['b1'];self.reject(d)
    return test
for table in r.TABLES:setattr(ProofTests,'test_cross_shop_owner_in_oracle_'+table,make_wrong_owner(table))

def make_lock(k):
    def test(self):
        d=example()
        d[k]=not d[k] if type(d[k]) is bool else ('GO' if type(d[k]) is str else 0)
        self.reject(d)
    return test
for k in r.LOCK:setattr(ProofTests,'test_tampered_lock_'+k,make_lock(k))

if __name__=='__main__':unittest.main()

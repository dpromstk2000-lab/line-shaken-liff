#!/usr/bin/env python3
"""R250: R249 evidence anti-forgery, phase reset and scope regressions (no live DB)."""
import copy, hashlib, json, os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from car02_r138_pg17_lifecycle_qa import ROLES
import car02_r249_transaction_session_rls_isolated as r

COMMIT='b'*40
SPOOF='{"role":"service_role","sub":"r249-synthetic"}'

def sample_rows():
    return [{'id':i,'shop':'street_house_demo' if role in ('a1','a2') else 'other_demo',
        'owner':ROLES[role]} for i,role in enumerate(('a1','a2','b1','a1','a2','b1'),1)]

def fixture():
    full={t:sample_rows() for t in r.TABLES}
    recs={}
    for actor in r.ACTORS:
        for mode in r.MODES:
            states={p:{'currentUser':ROLES[actor],'sessionUser':ROLES[actor],
                'searchPath':'pg_temp, public' if p in r.LOCAL else '"$user", public',
                'claims':SPOOF if p in r.LOCAL else ''} for p in r.PHASES}
            rows={p:{t:{owner:[item for item in r.relevant(full[t],actor)
                     if item['owner']==ROLES[owner]] for owner in r.OWNERS}
                     for t in r.TABLES} for p in r.PHASES}
            plans={t:({'generic':15,'custom':0} if mode==r.MODES[0] else
                      {'generic':0,'custom':15}) for t in r.TABLES}
            recs[actor+':'+mode]={'states':states,'rows':rows,'plans':plans}
    d=dict(r.LOCK,githubCommit=COMMIT,oracle=full,readbacks=recs,
        snapshotBefore={t:'f'*32 for t in r.TABLES},
        snapshotAfter={t:'f'*32 for t in r.TABLES})
    d['sha256']=r.seal(d)
    return d

def output(d,actor,mode):
    v=d['readbacks'][actor+':'+mode]
    lines=['SET']
    for phase in r.PHASES:
        state=v['states'][phase]
        lines.append('R249|STATE|'+phase+'|'+state['currentUser']+'|'+state['sessionUser']+'|'+state['searchPath']+'|'+state['claims'])
        for table in r.TABLES:
            for owner in r.OWNERS:
                payload=json.dumps(v['rows'][phase][table][owner],separators=(',',':'))
                lines.append(f'R249|ROW|{phase}|{table}|{ROLES[owner]}|'+payload)
    for table in r.TABLES:
        p=v['plans'][table]
        lines.append(f"R249|PLAN|r249_{table}|{p['generic']},{p['custom']}")
    return '\n'.join(lines)

class TestR250(unittest.TestCase):
    def reject(self,d,reseal=True):
        if reseal and 'sha256' in d:d['sha256']=r.seal(d)
        with self.assertRaises(r.R249Error):r.validate(d)
    def test_fixture(self):self.assertTrue(r.validate(fixture()))
    def test_counts(self):
        self.assertEqual((len(r.ACTORS),len(r.TABLES),len(r.MODES),len(r.PHASES),len(r.readback_keys())),(5,5,2,5,10))
    def test_sql_transaction_and_no_write(self):
        for mode in r.MODES:
            s=r.statements(mode)
            for val in ('BEGIN;','COMMIT;','ROLLBACK;',
                        'SET LOCAL search_path TO pg_temp, public;',
                        'SET LOCAL request.jwt.claims',
                        'PREPARE r249_bookings(text,text)',
                        'pg_catalog.pg_prepared_statements'):
                self.assertIn(val,s)
            self.assertEqual(s.count('BEGIN;'),2)
            self.assertEqual(s.count('SET LOCAL search_path'),2)
            for t in r.TABLES:
                self.assertEqual(s.count('EXECUTE r249_'+t+'('),15)
                self.assertIn('FROM car02_r138_qa.'+t,s)
            for bad in ('DELETE FROM ','UPDATE car02_','DROP DATABASE','GRANT ','ALTER ROLE'):
                self.assertNotIn(bad,s)
    def test_parse(self):
        d=fixture()
        for a in r.ACTORS:
            for mode in r.MODES:
                self.assertEqual(r.parse(output(d,a,mode),a),d['readbacks'][a+':'+mode])
    def test_missing_line(self):
        d=fixture();s=output(d,'a1',r.MODES[0]);s='\n'.join(x for x in s.splitlines() if not x.startswith('R249|STATE|after_rollback|'))
        with self.assertRaises(r.R249Error):r.parse(s,'a1')
    def test_duplicate_line(self):
        d=fixture();s=output(d,'a1',r.MODES[0]);s+='\nR249|STATE|baseline|f|f|p|c'
        with self.assertRaises(r.R249Error):r.parse(s,'a1')
    def test_invalid_json(self):
        d=fixture();s=output(d,'a1',r.MODES[0]);s=s.replace('R249|ROW|baseline|bookings|'+ROLES['a1']+'|[','R249|ROW|baseline|bookings|'+ROLES['a1']+'|{',1)
        with self.assertRaises(r.R249Error):r.parse(s,'a1')
    def test_unknown_tag(self):
        with self.assertRaises(r.R249Error):r.parse('R249|UNKNOWN|anything','a1')
    def test_bad_mode(self):
        with self.assertRaises(r.R249Error):r.statements('auto')
    def test_changed_seal(self):
        d=fixture();d['sha256']='f'*64;self.reject(d,False)
    def test_changed_snapshot(self):
        d=fixture();d['snapshotAfter']['bookings']='e'*32;self.reject(d)
    def test_wrong_production_lock(self):
        d=fixture();d['productionTouched']=True;self.reject(d)
    def test_missing_readback(self):
        d=fixture();del d['readbacks'][next(iter(d['readbacks']))];self.reject(d)
    def test_save(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'proof.json';d=fixture()
            self.assertEqual(r.save(d,path),path)
            self.assertEqual(json.loads(path.read_text()),d)
            with self.assertRaises(r.R249Error):r.save(d,path)
    def test_save_bad_path(self):
        with self.assertRaises(r.R249Error):r.save(fixture(),'bad.json')
    def test_save_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);(base/'real').mkdir();(base/'link').symlink_to(base/'real',target_is_directory=True)
            with self.assertRaises(r.R249Error):r.save(fixture(),base/'link'/'proof.json')
    def test_probe_env(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true','R249_DISPOSABLE_QA':'no'}):
            with self.assertRaises(r.R249Error):r.probe('a'*64,COMMIT)
    def test_probe_smoke(self):
        d=fixture();empty={t:hashlib.md5(b'[]').hexdigest() for t in r.TABLES}
        with tempfile.TemporaryDirectory() as tmp:
            previous=os.getcwd()
            try:
                os.chdir(tmp);Path('qa-evidence-r249').mkdir()
                with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true','R249_DISPOSABLE_QA':'yes'}),\
                    patch.object(r,'snapshot',side_effect=[empty,d['snapshotBefore'],d['snapshotAfter']]),\
                    patch.object(r,'seed') as seed,\
                    patch.object(r,'oracle',side_effect=lambda cid,t:d['oracle'][t]),\
                    patch.object(r,'psql',side_effect=lambda cid,db,a,sql:output(d,a,next(mode for mode in r.MODES if 'SET plan_cache_mode TO '+mode in sql))):
                    result=r.probe('a'*64,COMMIT)
                    self.assertEqual(result,d);seed.assert_called_once()
                    self.assertEqual(json.loads(Path(r.OUTPUT).read_text()),d)
            finally:os.chdir(previous)

def wrong_scope(actor,mode,phase,table,owner):
    def check(self):
        d=fixture();d['readbacks'][actor+':'+mode]['rows'][phase][table][owner].append(
            {'id':9876,'shop':'street_house_demo','owner':ROLES[owner]})
        self.reject(d)
    return check

def wrong_state(actor,mode,phase):
    def check(self):
        d=fixture();d['readbacks'][actor+':'+mode]['states'][phase]['claims']='tampered'
        self.reject(d)
    return check

def wrong_plan(actor,mode,table):
    def check(self):
        d=fixture();d['readbacks'][actor+':'+mode]['plans'][table]['generic']+=1
        self.reject(d)
    return check

for a in r.ACTORS:
 for mode in r.MODES:
  for p in r.PHASES:
   setattr(TestR250,f'test_session_state_{a}_{mode}_{p}',wrong_state(a,mode,p))
   for t in r.TABLES:
    for owner in r.OWNERS:
     setattr(TestR250,f'test_scope_{a}_{mode}_{p}_{t}_{owner}',wrong_scope(a,mode,p,t,owner))
  for t in r.TABLES:
   setattr(TestR250,f'test_plan_{a}_{mode}_{t}',wrong_plan(a,mode,t))

if __name__=='__main__': unittest.main()

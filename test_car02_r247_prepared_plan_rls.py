#!/usr/bin/env python3
"""R247 fail-closed proof, plan counter, actor and row-isolation tests (no DB)."""
import copy, hashlib, json, os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import car02_r246_prepared_plan_rls_isolated as r
from car02_r138_pg17_lifecycle_qa import ROLES

COMMIT='a'*40

def rows():
    return [{'id':i,'shop':'street_house_demo' if actor in ('a1','a2') else 'other_demo',
        'owner':ROLES[actor]} for i,actor in enumerate(('a1','a2','b1','a1','a2','b1'),1)]

def fixture():
    full={t:rows() for t in r.TABLES}
    readbacks={}
    for actor in r.ACTORS:
        for mode in r.MODES:
            for profile in r.PROFILES:
                record={'currentUser':ROLES[actor],'sessionUser':ROLES[actor],
                    'plans':{t:({'generic':3,'custom':0} if mode==r.MODES[0] else {'generic':0,'custom':3})
                        for t in r.TABLES}, 'rows':{}}
                for table in r.TABLES:
                    record['rows'][table]={owner:[x for x in r.relevant(full[table],actor)
                        if x['owner']==ROLES[owner]] for owner in r.OWNERS}
                readbacks[actor+':'+mode+':'+profile]=record
    doc=dict(r.LOCK,githubCommit=COMMIT,oracle=full,readbacks=readbacks,
            snapshotBefore={t:'f'*32 for t in r.TABLES},snapshotAfter={t:'f'*32 for t in r.TABLES})
    doc['sha256']=r.seal(doc)
    return doc

def output(doc,actor,mode,profile):
    record=doc['readbacks'][actor+':'+mode+':'+profile]
    lines=['PREPARE','R246|IDENTITY|'+record['currentUser']+','+record['sessionUser']]
    for table in r.TABLES:
        for owner in r.OWNERS:
            payload=json.dumps(record['rows'][table][owner],ensure_ascii=True,separators=(',',':'))
            lines.append(f'R246|ROW|{table}|{ROLES[owner]}|'+payload)
    for table in r.TABLES:
        p=record['plans'][table]
        lines.append(f"R246|PLAN|r246_{table}|{p['generic']},{p['custom']}")
    return '\n'.join(lines)

class Core(unittest.TestCase):
    def reject(self,doc,reseal=True):
        if reseal and 'sha256' in doc:doc['sha256']=r.seal(doc)
        with self.assertRaises(r.R246Error):r.validate(doc)
    def test_fixture(self):self.assertTrue(r.validate(fixture()))
    def test_tables_actors(self):self.assertEqual((len(r.TABLES),len(r.ACTORS)),(5,5))
    def test_mode_profile_count(self):self.assertEqual(len(r.required_keys()),20)
    def test_sql(self):
        for mode in r.MODES:
            for p in r.PROFILES:
                sql='\n'.join(r.statements(mode,p))
                self.assertIn('SET plan_cache_mode TO '+mode,sql)
                self.assertIn('FROM pg_catalog.pg_prepared_statements',sql)
                for t in r.TABLES:
                    self.assertIn('PREPARE r246_'+t+'(text)',sql)
                    self.assertIn('WHERE owner_login=$1',sql)
                for action in ('DELETE FROM ','UPDATE ','DROP TABLE ','TRUNCATE '):
                    self.assertNotIn(action,sql)
    def test_parser_roundtrip(self):
        doc=fixture()
        for a in r.ACTORS:
            for m in r.MODES:
                for p in r.PROFILES:
                    self.assertEqual(r.parse(output(doc,a,m,p),a),doc['readbacks'][a+':'+m+':'+p])
    def test_parser_incorrect_actor(self):
        d=fixture();self.assertRaises(r.R246Error,r.parse,output(d,'a1',r.MODES[0],'baseline'),'a2')
    def test_parser_duplicate(self):
        d=fixture();o=output(d,'a1',r.MODES[0],'baseline');o+='\nR246|ROW|bookings|'+ROLES['a1']+'|[]'
        self.assertRaises(r.R246Error,r.parse,o,'a1')
    def test_parser_missing_plan(self):
        d=fixture();o=output(d,'a1',r.MODES[0],'baseline');o='\n'.join(x for x in o.splitlines() if not x.startswith('R246|PLAN|r246_bookings|'))
        self.assertRaises(r.R246Error,r.parse,o,'a1')
    def test_digest(self):
        d=fixture();d['sha256']='0'*64;self.reject(d,False)
    def test_invalid_scope(self):
        d=fixture();del d['readbacks'][next(iter(d['readbacks']))];self.reject(d)
    def test_original_owner(self):
        d=fixture();d['oracle']['bookings'][0]['owner']=ROLES['b1'];self.reject(d)
    def test_snapshot(self):
        d=fixture();d['snapshotAfter']['bookings']='e'*32;self.reject(d)
    def test_save(self):
        with tempfile.TemporaryDirectory() as tmp:
            f=Path(tmp)/'evidence.json';d=fixture();self.assertEqual(r.save(d,f),f)
            self.assertEqual(json.loads(f.read_text()),d)
            self.assertRaises(r.R246Error,r.save,d,f)
    def test_save_path(self):
        self.assertRaises(r.R246Error,r.save,fixture(),'evidence.json')
    def test_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp);(d/'real').mkdir();(d/'link').symlink_to(d/'real',target_is_directory=True)
            self.assertRaises(r.R246Error,r.save,fixture(),d/'link'/'evidence.json')
    def test_env(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true','R246_DISPOSABLE_QA':'no'}):
            self.assertRaises(r.R246Error,r.probe,'a'*64,COMMIT)
    def test_readback_sql(self):
        d=fixture();raw=output(d,'a1',r.MODES[0],r.PROFILES[1])
        with patch.object(r,'psql',return_value=raw) as fn:
            self.assertEqual(r.readback('a'*64,'a1',r.MODES[0],r.PROFILES[1]),d['readbacks']['a1:'+r.MODES[0]+':'+r.PROFILES[1]])
            self.assertIn('SET search_path TO pg_temp, public',fn.call_args.args[3])
    def test_full_probe_mock(self):
        d=fixture();empty={t:hashlib.md5(b'[]').hexdigest() for t in r.TABLES}
        with tempfile.TemporaryDirectory() as temp:
            old=os.getcwd()
            try:
                os.chdir(temp);Path('qa-evidence-r246').mkdir()
                with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true','R246_DISPOSABLE_QA':'yes'}),\
                    patch.object(r,'snapshot',side_effect=[empty,d['snapshotBefore'],d['snapshotAfter']]),\
                    patch.object(r,'seed') as seed,\
                    patch.object(r,'oracle',side_effect=lambda cid,t:d['oracle'][t]),\
                    patch.object(r,'readback',side_effect=lambda cid,a,m,p:d['readbacks'][a+':'+m+':'+p]):
                    actual=r.probe('a'*64,COMMIT)
                    seed.assert_called_once_with('a'*64)
                    self.assertTrue(r.validate(actual))
                    self.assertEqual(actual,json.loads(Path(r.OUT).read_text()))
            finally:os.chdir(old)

def scope_mutation(actor,mode,profile,table,owner):
    def test(self):
        d=fixture();actual=d['readbacks'][actor+':'+mode+':'+profile]['rows'][table][owner]
        actual.append({'id':999,'shop':'street_house_demo' if owner in ('a1','a2') else 'other_demo','owner':ROLES[owner]})
        self.reject(d)
    return test

def plan_mutation(actor,mode,profile,table):
    def test(self):
        d=fixture();d['readbacks'][actor+':'+mode+':'+profile]['plans'][table]['generic']+=1
        self.reject(d)
    return test

for a in r.ACTORS:
    for mode in r.MODES:
        for profile in r.PROFILES:
            for table in r.TABLES:
                for owner in r.OWNERS:
                    setattr(Core,f'test_scope_{a}_{mode}_{profile}_{table}_{owner}',scope_mutation(a,mode,profile,table,owner))
                setattr(Core,f'test_plan_{a}_{mode}_{profile}_{table}',plan_mutation(a,mode,profile,table))

if __name__=='__main__':unittest.main()

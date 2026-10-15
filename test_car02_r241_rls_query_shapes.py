#!/usr/bin/env python3
"""R241: fail-closed synthetic RLS query-shape evidence and parser tests."""
from __future__ import annotations
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import car02_r240_rls_query_shapes_isolated as r

COMMIT='b'*40

def sample():
    oracle={}
    for table in r.TABLES:
        oracle[table]=[{'id':i, 'shop':r.OWNER_SHOPS[owner], 'owner':r.ROLES[owner]}
                       for i,owner in enumerate(('a1','a1','a2','a2','b1','b1'),1)]
    oracle['service_cases']=[oracle['service_cases'][i] for i in (0,2,4)]
    joined=[{'case':i,'booking':i,'shop':r.OWNER_SHOPS[owner], 'owner':r.ROLES[owner]}
            for i,owner in zip((1,3,5),('a1','a2','b1'))]
    readbacks={}
    for actor in r.ACTORS:
        for profile in r.PROFILES:
            tables={}
            for table in r.TABLES:
                visible=r.relevant(oracle[table],actor)
                tables[table]={'count':len(visible),'pages':r.expected_pages(visible),
                    'owners':{o:sum(x['owner']==r.ROLES[o] for x in visible) for o in r.OWNERS}}
            readbacks[actor+':'+profile]={'currentUser':r.ROLES[actor],
              'sessionUser':r.ROLES[actor], 'tables':tables,
              'join':[{'case':x['case'],'booking':x['booking']} for x in joined if r.allowed(actor,x)]}
    snap={t:'a'*32 for t in r.TABLES}
    doc=dict(r.LOCK,githubCommit=COMMIT,oracle=oracle,oracleJoin=joined,
             readbacks=readbacks,snapshotBefore=snap,snapshotAfter=snap.copy())
    doc['sha256']=r.seal(doc)
    return doc

class ProofTests(unittest.TestCase):
    def reject(self,doc,reseal=True):
        if reseal and 'sha256' in doc:doc['sha256']=r.seal(doc)
        with self.assertRaises((r.R240Error,AssertionError)):
            r.verify(doc)
    def test_valid(self):self.assertTrue(r.verify(sample()))
    def test_scope(self):
        self.assertEqual(len(r.TABLES),5)
        self.assertEqual((len(r.ACTORS),len(r.PROFILES),len(r.OWNERS)),(5,2,3))
        self.assertEqual((r.PAGE_SIZE,r.MAX_PAGES),(2,12))
    def test_locked(self):
        self.assertEqual((r.LOCK['release'],r.LOCK['migration'],r.LOCK['realWorldGatesOpen']),('NO_GO','HOLD',12))
        for key in ('productionTouched','productionAuthorized','productionReady','realAuthenticationVerified','realRLSVerified'):
            self.assertIs(r.LOCK[key],False)
    def test_no_insecure_sql(self):
        text='\n'.join(r.statements())
        for table in r.TABLES:
            self.assertIn('car02_r138_qa.'+table,text)
            self.assertIn('LIMIT 2 OFFSET 0',text)
        self.assertIn('s.booking_id=b.id AND s.shop_code=b.shop_code',text)
        self.assertNotIn('SUPABASE_SERVICE_ROLE_KEY',text)
    def test_query_allowlist(self):
        for bad in ('bookings;DROP TABLE bookings','pg_authid','',None,1):
            with self.assertRaises(r.R240Error):r.query(bad)
    def test_source_read_has_spoof(self):
        with patch.object(r,'psql',return_value='') as fake:
            with self.assertRaises(r.R240Error):r.readback('a'*64,'a1','spoof_claims_path')
            sql=fake.call_args.args[3]
            self.assertIn('SET search_path TO pg_temp, public;',sql)
            self.assertIn('request.jwt.claims',sql)
    def test_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'doc.json';self.assertEqual(r.save(sample(),path),path)
            self.assertEqual(json.loads(path.read_text()),sample())
            with self.assertRaises(r.R240Error):r.save(sample(),path)
    def test_save_reject_path(self):
        with self.assertRaises(r.R240Error):r.save(sample(),'file.json')
    def test_save_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp)/'real';d.mkdir()
            link=Path(tmp)/'link';link.symlink_to(d,target_is_directory=True)
            with self.assertRaises(r.R240Error):r.save(sample(),link/'proof.json')
    def test_bad_sha(self):
        d=sample();d['sha256']='a'*64;self.reject(d,False)
    def test_bad_snap(self):
        d=sample();d['snapshotAfter']['bookings']='f'*32;self.reject(d)
    def test_missing_join_case(self):
        d=sample();d['oracleJoin'].pop();self.reject(d)
    def test_foreign_join_owner(self):
        d=sample();d['oracleJoin'][0]['owner']=r.ROLES['b1'];self.reject(d)
    def test_missing_commit(self):
        d=sample();d['githubCommit']='abc';self.reject(d)
    def test_probe_fake(self):
        doc=sample()
        empty={t:r.hashlib.md5(b'[]').hexdigest() for t in r.TABLES}
        filled={t:'a'*32 for t in r.TABLES}
        import car02_r237_exact_row_rls_isolated as old
        with tempfile.TemporaryDirectory() as tmp:
            cwd=os.getcwd()
            try:
                os.chdir(tmp);Path('qa-evidence-r240').mkdir()
                with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true','R240_DISPOSABLE_QA':'yes'}),\
                     patch.object(r,'snapshot',side_effect=[empty,filled,filled]),\
                     patch.object(r,'seed'),\
                     patch.object(old,'oracle',side_effect=lambda cid,t:doc['oracle'][t]),\
                     patch.object(r,'oracle_join',return_value=doc['oracleJoin']),\
                     patch.object(r,'readback',side_effect=lambda cid,a,p:doc['readbacks'][a+':'+p]):
                    result=r.probe('a'*64,COMMIT)
                    self.assertTrue(r.verify(result))
                    self.assertTrue(Path(r.OUTPUT).exists())
            finally:os.chdir(cwd)
    def test_bad_env(self):
        with patch.dict(os.environ,{'CAR02_RELEASE_LOCK':'false','GITHUB_SHA':COMMIT,'R240_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.R240Error):r.probe('a'*64,COMMIT)
    def test_bad_admin(self):
        for actor in (None,'postgres','superuser'):
            with self.assertRaises(r.R240Error):r.readback('a'*64,actor,'baseline')
    def test_parse_valid_tag_stream(self):
        doc=sample()
        actor='a1'; data=doc['readbacks'][actor+':baseline']
        lines=['R240|IDENTITY|'+r.ROLES[actor]+','+r.ROLES[actor]]
        for table in r.TABLES:
            record=data['tables'][table]
            lines.append('R240|'+table+'|COUNT|'+str(record['count']))
            for page in range(r.MAX_PAGES):
                page_data=record['pages'][page] if page<len(record['pages']) else []
                lines.append('R240|'+table+'|PAGE'+str(page)+'|'+json.dumps(page_data))
            for owner in r.OWNERS:
                lines.append('R240|'+table+'|OWNER'+owner+'|'+str(record['owners'][owner]))
        lines.append('R240|JOIN|'+json.dumps(data['join']))
        self.assertEqual(r.parse('\n'.join(lines),actor),data)
        with self.assertRaises(r.R240Error):r.parse('\n'.join(lines[:-1]),actor)
        with self.assertRaises(r.R240Error):r.parse('\n'.join(lines+[lines[0]]),actor)
        swapped=lines.copy()
        key='R240|bookings|PAGE0|'
        swapped=[key+'[9999,2]' if line.startswith(key) else line for line in swapped]
        self.assertNotEqual(r.parse('\n'.join(swapped),actor),data)
        d=sample();d['readbacks'][actor+':baseline']=r.parse('\n'.join(swapped),actor)
        self.reject(d)
    def test_sql_joins_schema_scoped(self):
        query=r.oracle_join_sql()
        self.assertIn('car02_r138_qa.bookings b',query)
        self.assertIn('s.shop_code=b.shop_code',query)
        self.assertIn('s.owner_login=b.owner_login',query)
    def test_explicit_output(self):
        self.assertEqual(r.OUTPUT,'qa-evidence-r240/r240-rls-query-shapes-proof.json')

    def test_statement_count(self):
        self.assertEqual(len(r.statements()),1+len(r.TABLES)*(1+r.MAX_PAGES+len(r.OWNERS))+1)

# Confirm that a same-count page substitution cannot pass by re-sealing proof.
def swapped_page(actor,profile,table):
    def test(self):
        d=sample();value=d['readbacks'][actor+':'+profile]['tables'][table]
        if len(value['pages'][0])==2:
            value['pages'][0][0]=99999
        else:value['pages'][0][0]=99999
        self.reject(d)
    return test

def inflated_count(actor,profile,table):
    def test(self):
        d=sample();d['readbacks'][actor+':'+profile]['tables'][table]['count']+=1
        self.reject(d)
    return test

def leaked_owner(actor,profile,table):
    def test(self):
        d=sample();key=next(o for o in r.OWNERS if r.ROLES[o] not in
                      [x['owner'] for x in r.relevant(d['oracle'][table],actor)])
        d['readbacks'][actor+':'+profile]['tables'][table]['owners'][key]=1
        self.reject(d)
    return test

for actor in r.ACTORS:
    for profile in r.PROFILES:
        for table in r.TABLES:
            name=actor+'_'+profile+'_'+table
            setattr(ProofTests,'test_swapped_page_'+name,swapped_page(actor,profile,table))
            setattr(ProofTests,'test_inflated_count_'+name,inflated_count(actor,profile,table))
            setattr(ProofTests,'test_leaked_owner_'+name,leaked_owner(actor,profile,table))

for actor in r.ACTORS:
    for profile in r.PROFILES:
        def make_join(a,p):
            def test(self):
                d=sample();d['readbacks'][a+':'+p]['join']=[{'case':999,'booking':999}]
                self.reject(d)
            return test
        setattr(ProofTests,'test_join_leak_'+actor+'_'+profile,make_join(actor,profile))

for key in r.LOCK:
    def make_flag(k):
        def test(self):
            d=sample();v=d[k];d[k]=not v if type(v) is bool else (0 if type(v) is int else 'GO')
            self.reject(d)
        return test
    setattr(ProofTests,'test_flag_'+key,make_flag(key))

if __name__=='__main__':unittest.main()

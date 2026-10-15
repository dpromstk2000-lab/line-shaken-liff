#!/usr/bin/env python3
"""R244: adversarial evidence, parsing and output-scope regression (no DB)."""
from __future__ import annotations
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import car02_r243_rls_aggregate_isolated as r
from car02_r138_pg17_lifecycle_qa import ROLES

COMMIT='b'*40

def fixture():
    rows=[]
    for i,actor in enumerate(('a1','a2','b1','a1','a2','b1'),1):
        rows.append({'id':i,'shop':r.OWNER_SHOPS[actor],'owner':ROLES[actor]})
    oracle={table:copy.deepcopy(rows) for table in r.TABLES}
    joins=[{'case':i,'booking':i,'shop':row['shop'],'owner':row['owner']}
           for i,row in enumerate(rows,1)]
    readbacks={}
    for actor in r.ACTORS:
        for profile in r.PROFILES:
            visible=r.relevant(rows,actor)
            readbacks[actor+':'+profile]={'currentUser':ROLES[actor],
                'sessionUser':ROLES[actor],
                'tables':{table:r.expected_view(visible) for table in r.TABLES},
                'correlatedBookings':[x['booking'] for x in joins if (
                    x['shop']=='street_house_demo' if actor=='as' else
                    x['shop']=='other_demo' if actor=='bs' else x['owner']==ROLES[actor])]}
    doc=dict(r.LOCK,githubCommit=COMMIT,oracle=oracle,oracleJoin=joins,
             readbacks=readbacks,
             snapshotBefore={t:'c'*32 for t in r.TABLES},
             snapshotAfter={t:'c'*32 for t in r.TABLES})
    doc['sha256']=r.seal(doc)
    assert r.validate(doc)
    return doc

def stdout(doc,actor='a1',profile='baseline'):
    rec=doc['readbacks'][actor+':'+profile]
    lines=[f"R243|IDENTITY|{rec['currentUser']},{rec['sessionUser']}"]
    tags=(('COUNT','count'),('GROUP','groups'),('HAVING','having'),
          ('DISTINCT','distinct'),('UNION','unionIds'),('WINDOW','windows'))
    for table in r.TABLES:
        for tag,key in tags:
            v=rec['tables'][table][key]
            serialized=str(v) if tag=='COUNT' else json.dumps(v,ensure_ascii=True,separators=(',',':'))
            lines.append(f'R243|{table}|{tag}|{serialized}')
        for owner in r.OWNERS:
            lines.append(f'R243|{table}|EXISTS{owner}|'+('1' if rec['tables'][table]['existsOwners'][owner] else '0'))
    lines.append('R243|CORRELATED|'+json.dumps(rec['correlatedBookings'],separators=(',',':')))
    return '\n'.join(lines)

class CoreTests(unittest.TestCase):
    def reject(self,doc,reseal=True):
        if reseal and 'sha256' in doc:doc['sha256']=r.seal(doc)
        with self.assertRaises(r.R243Error):r.validate(doc)
    def test_valid(self):self.assertTrue(r.validate(fixture()))
    def test_all_shapes(self):self.assertEqual(len(r.SHAPES),7)
    def test_actor_profiles(self):self.assertEqual((len(r.ACTORS),len(r.PROFILES)),(5,2))
    def test_all_business_tables(self):self.assertEqual(len(r.TABLES),5)
    def test_sql_count(self):self.assertEqual(len(r.statements()),1+len(r.TABLES)*9+1)
    def test_sql_has_set_operations(self):
        sql='\n'.join(r.statements())
        for k in ('GROUP BY owner_login','HAVING count(*) >= 2','UNION ALL','row_number() OVER',
                  'EXISTS (SELECT 1 FROM car02_r138_qa.service_cases','SELECT DISTINCT owner_login'):
            self.assertIn(k,sql)
    def test_no_sql_dml(self):
        sql='\n'.join(r.statements()).upper()
        for action in ('TRUNCATE ','DELETE FROM ','INSERT INTO ','UPDATE ','DROP TABLE '):
            self.assertNotIn(action,sql)
    def test_parse_roundtrip(self):
        doc=fixture()
        for actor in r.ACTORS:
            for profile in r.PROFILES:
                self.assertEqual(r.parse(stdout(doc,actor,profile),actor),doc['readbacks'][actor+':'+profile])
    def test_parse_set_noise(self):
        doc=fixture();self.assertEqual(r.parse('SET\nSET\n'+stdout(doc), 'a1'),doc['readbacks']['a1:baseline'])
    def test_digest(self):
        doc=fixture();doc['sha256']='0'*64;self.reject(doc,False)
    def test_missing_sha(self):
        doc=fixture();del doc['sha256'];self.reject(doc,False)
    def test_commit(self):
        doc=fixture();doc['githubCommit']='wrong';self.reject(doc)
    def test_tenant(self):
        doc=fixture();doc['oracle']['bookings'][0]['shop']='other_demo';self.reject(doc)
    def test_snapshot(self):
        doc=fixture();doc['snapshotAfter']['bookings']='e'*32;self.reject(doc)
    def test_missing_profile(self):
        doc=fixture();del doc['readbacks']['a1:spoof_claims_path'];self.reject(doc)
    def test_correlated_change(self):
        doc=fixture();doc['readbacks']['a1:baseline']['correlatedBookings']=[2,5];self.reject(doc)
    def test_join_foreign_owner(self):
        doc=fixture();doc['oracleJoin'][0]['owner']=ROLES['b1'];self.reject(doc)
    def test_output_save(self):
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/'proof.json';doc=fixture();self.assertEqual(r.save(doc,file),file)
            self.assertEqual(json.loads(file.read_text()),doc)
            with self.assertRaises(r.R243Error):r.save(doc,file)
    def test_output_reject_string_path(self):
        with self.assertRaises(r.R243Error):r.save(fixture(),'proof.json')
    def test_output_reject_symlink(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);(base/'real').mkdir();(base/'alias').symlink_to(base/'real',target_is_directory=True)
            with self.assertRaises(r.R243Error):r.save(fixture(),base/'alias'/'proof.json')
    def test_environment_gate(self):
        with patch.dict('os.environ',{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true',
                 'R243_DISPOSABLE_QA':'no'}):
            with self.assertRaises(r.R243Error):r.probe('a'*64,COMMIT)
    def test_full_probe_mocked_db_sequence(self):
        import hashlib
        import os
        doc=fixture()
        empty={table:hashlib.md5(b'[]').hexdigest() for table in r.TABLES}
        before=doc['snapshotBefore']
        with tempfile.TemporaryDirectory() as folder:
            old=os.getcwd()
            try:
                os.chdir(folder)
                Path('qa-evidence-r243').mkdir()
                with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true',
                         'R243_DISPOSABLE_QA':'yes'}), \
                     patch.object(r,'snapshot',side_effect=[empty,before,before]), \
                     patch.object(r,'seed') as mock_seed, \
                     patch.object(r,'oracle',side_effect=lambda cid,t:doc['oracle'][t]), \
                     patch.object(r,'oracle_join',return_value=doc['oracleJoin']), \
                     patch.object(r,'readback',side_effect=lambda cid,a,p:doc['readbacks'][a+':'+p]):
                    actual=r.probe('a'*64,COMMIT)
                    mock_seed.assert_called_once_with('a'*64)
                    self.assertTrue(r.validate(actual))
                    saved=json.loads(Path(r.OUT).read_text(encoding='ascii'))
                    self.assertEqual(saved,actual)
            finally:
                os.chdir(old)
    def test_readback_wrong_actor(self):
        with self.assertRaises(r.R243Error):r.readback('a'*64,'admin','baseline')
    def test_readback_uses_real_sql_helper(self):
        doc=fixture();raw=stdout(doc,'a1','spoof_claims_path')
        with patch.object(r,'psql',return_value=raw) as fn:
            self.assertEqual(r.readback('a'*64,'a1','spoof_claims_path'),doc['readbacks']['a1:spoof_claims_path'])
            self.assertIn('SET search_path TO pg_temp, public',fn.call_args.args[3])

# Every user / session / table / aggregate must be independently fail-closed.
def shape_tamper(actor,profile,table,shape):
    def test(self):
        doc=fixture(); val=doc['readbacks'][actor+':'+profile]['tables'][table][shape]
        if shape=='count':doc['readbacks'][actor+':'+profile]['tables'][table][shape]+=1
        elif shape=='existsOwners':val['a1']=not val['a1']
        elif shape in ('groups','having'):
            if val:val[0]['count']+=1
            else:val.append({'owner':ROLES['b1'],'count':1})
        elif shape=='windows':val[0]['id']=99999
        elif shape=='unionIds':val[0]=99999
        elif shape=='distinct':val.append(ROLES['bs'])
        self.reject(doc)
    return test
for actor in r.ACTORS:
    for profile in r.PROFILES:
        for table in r.TABLES:
            for shape in r.SHAPES:
                setattr(CoreTests,'test_tamper_'+actor+'_'+profile+'_'+table+'_'+shape,
                        shape_tamper(actor,profile,table,shape))

# Parser tampering: duplicate/missing row/invalid indicator for every table.
def parse_tamper(table,kind):
    def test(self):
        s=stdout(fixture());target='R243|'+table+'|'+kind+'|'
        lines=s.splitlines()
        ix=next(i for i,v in enumerate(lines) if v.startswith(target))
        if kind=='COUNT':lines[ix]=target+'badcount'
        elif kind=='EXISTSa1':lines[ix]=target+'fake'
        elif kind=='GROUP':lines[ix]=target+'{bad'
        with self.assertRaises(r.R243Error):r.parse('\n'.join(lines),'a1')
    return test
for table in r.TABLES:
    for kind in ('COUNT','EXISTSa1','GROUP'):
        setattr(CoreTests,'test_parse_corrupt_'+table+'_'+kind,parse_tamper(table,kind))

if __name__=='__main__':unittest.main()

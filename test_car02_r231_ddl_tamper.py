#!/usr/bin/env python3
"""R231: strict synthetic proof, DDL rejection, file I/O and negative QA. No DB."""
from __future__ import annotations
import copy
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import car02_r230_ddl_tamper_isolated as r

COMMIT='a'*40

def sample():
    fs=[{'name':n,'owner':'postgres','definer':True,'config':['search_path=pg_catalog'],
         'bodyHash':('%032x'% (i+1024)),'acl':None}
        for i,n in enumerate(('case_step','change_booking','claim_booking','open_case'))]
    ts=[{'name':name,'owner':'postgres','rls':True,'force':True,'acl':None}
        for name in sorted(r.TABLES)]
    snapshot={n:'%032x'% (i+100) for i,n in enumerate(r.TABLES)}
    doc=dict(r.LOCK,githubCommit=COMMIT,catalogBefore={'functions':fs,'tables':ts},
        catalogAfter=copy.deepcopy({'functions':fs,'tables':ts}),
        snapshots=[copy.deepcopy(snapshot) for _ in range(6)],
        rejections=[{'actor':a,'operation':o,'sqlstate':'42501'}
                    for a in r.ACTORS for o in r.OPERATIONS],
        visibleBookingsBefore={'as':1,'a1':1,'a2':0,'bs':1,'b1':1},
        visibleBookingsAfter={'as':1,'a1':1,'a2':0,'bs':1,'b1':1})
    doc['sha256']=r.seal(doc)
    return doc

class Proof(unittest.TestCase):
    def bad(self,field,action):
        v=sample()
        action(v)
        v['sha256']=r.seal(v)
        with self.assertRaises(r.TamperError, msg=field):
            r.verify_proof(v)
    def test_clean(self):self.assertTrue(r.verify_proof(sample()))
    def test_negative_digest(self):
        v=sample();v['sha256']='b'*64
        with self.assertRaises(r.TamperError):r.verify_proof(v)
    def test_rejection_count(self):self.assertEqual(len(sample()['rejections']),30)
    def test_each_attempt_exact(self):
        self.assertEqual([f'{a}:{o}' for a in r.ACTORS for o in r.OPERATIONS],
            [f'{x["actor"]}:{x["operation"]}' for x in sample()['rejections']])
    def test_lock(self):self.assertEqual((r.LOCK['release'],r.LOCK['migration'],r.LOCK['realWorldGatesOpen']),('NO_GO','HOLD',12))
    def test_no_environment_claim(self):
        self.assertTrue(all(r.LOCK[key] is False for key in ('productionTouched','productionReady','realRLSVerified','realAuthenticationVerified')))
    def test_no_mutation_required(self):
        s=sample();self.assertTrue(all(v==s['snapshots'][0] for v in s['snapshots']))
    def test_allowed_sql_is_fixed(self):
        self.assertEqual(set(r.SQL),set(r.OPERATIONS))
        self.assertTrue(all('car02_r138_qa.' in sql and sql.endswith(';') and len(sql)<256 for sql in r.SQL.values()))
    def test_actor_list(self):self.assertEqual(set(r.ACTORS),set(r.ROLES))
    def test_canonical_seal_order(self):
        doc=sample(); reversed_order=dict(reversed(list(doc.items())))
        self.assertEqual(r.seal(doc),r.seal(reversed_order))
    def test_output_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'proof.json'
            r.save_proof(sample(),path)
            self.assertEqual(json.loads(path.read_text()),sample())
            with self.assertRaises(r.TamperError):r.save_proof(sample(),path)
    def test_output_missing_parent(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.TamperError):r.save_proof(sample(),Path(td)/'missing'/'x.json')
    def test_output_symlink_parent(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td);real=p/'real';real.mkdir();link=p/'link';link.symlink_to(real,target_is_directory=True)
            with self.assertRaises(r.TamperError):r.save_proof(sample(),link/'x.json')
    def test_output_wrong_type(self):
        with self.assertRaises(r.TamperError):r.save_proof(sample(),'some/path')
    def test_bad_sqlstate_from_subprocess(self):
        with patch.object(r.subprocess,'run',return_value=MagicMock(returncode=1,stderr='ERROR: 42P01: table missing')):
            with self.assertRaises(r.TamperError):r.reject_ddl('a'*64,'a1','drop_function')
    def test_bad_exit_zero_from_subprocess(self):
        with patch.object(r.subprocess,'run',return_value=MagicMock(returncode=0,stderr='')):
            with self.assertRaises(r.TamperError):r.reject_ddl('a'*64,'a1','drop_function')
    def test_valid_denial_from_subprocess(self):
        with patch.object(r.subprocess,'run',return_value=MagicMock(returncode=1,stderr='ERROR:  42501: must be owner of function claim_booking')) as p:
            self.assertEqual(r.reject_ddl('a'*64,'a1','drop_function'),{'actor':'a1','operation':'drop_function','sqlstate':'42501'})
            self.assertNotIn('postgres',p.call_args.args[0][-5:])
    def test_unknown_operation_rejected(self):
        with self.assertRaises(r.TamperError):r.reject_ddl('a'*64,'a1','DROP DATABASE postgres;')
    def test_unknown_role_rejected(self):
        with self.assertRaises(r.TamperError):r.reject_ddl('a'*64,'superuser','drop_function')
    def test_invalid_container_rejected(self):
        with self.assertRaises(r.TamperError):r.reject_ddl('not-container','a1','drop_function')
    def test_no_shell_command(self):
        with patch.object(r.subprocess,'run',return_value=MagicMock(returncode=1,stderr='ERROR: 42501: permission denied')) as p:
            r.reject_ddl('a'*64,'a1','drop_function')
            self.assertIsInstance(p.call_args.args[0],list)
            self.assertNotIn('shell',p.call_args.kwargs)
    def test_no_dangerous_admin_sql(self):
        with self.assertRaises(r.TamperError):r.admin_query('a'*64,'DROP DATABASE car02_r138_qa_ci;')
    def test_admin_queries_use_disposable_db(self):
        with patch.object(r.subprocess,'run',return_value=MagicMock(returncode=0,stdout='[]\n')) as p:
            r.admin_query('a'*64,'SELECT 1;')
            self.assertIn(r.DB,p.call_args.args[0])
            self.assertNotIn('shell',p.call_args.kwargs)
    def test_probe_guard_before_db(self):
        with patch.dict(r.os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true','R230_DISPOSABLE_QA':'no'}):
            with self.assertRaises(r.TamperError):r.probe('a'*64,COMMIT)


    def test_full_probe_mocked_run(self):
        initial={t:r.hashlib.md5(b'[]').hexdigest() for t in r.TABLES}
        populated=sample()['snapshots'][0]
        catalog=sample()['catalogBefore']
        def count_or_id(cid,db,actor,sql):
            if 'WHERE' in sql:
                return 3 if 'service_cases' in sql else (1 if actor=='as' else 2)
            return {'as':1,'a1':1,'a2':0,'bs':1,'b1':1}[actor]
        with tempfile.TemporaryDirectory() as td:
            target=Path(td)/'r230.json'
            with patch.object(r,'OUT',str(target)), \
                 patch.dict(r.os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true','R230_DISPOSABLE_QA':'yes'}), \
                 patch.object(r,'snapshot',side_effect=[initial]+[populated]*6), \
                 patch.object(r,'protected_catalog',side_effect=[copy.deepcopy(catalog),copy.deepcopy(catalog)]), \
                 patch.object(r,'booking',side_effect=['CREATED','CREATED']), \
                 patch.object(r,'change',return_value='MOVED'), \
                 patch.object(r,'case',return_value='OPENED'), \
                 patch.object(r,'step',return_value='REPORT_SAVED'), \
                 patch.object(r,'integer',side_effect=count_or_id), \
                 patch.object(r,'next_business_days',return_value=['2026-10-16']), \
                 patch.object(r,'reject_ddl',side_effect=lambda cid,a,o:{'actor':a,'operation':o,'sqlstate':'42501'}) as denied:
                result=r.probe('a'*64,COMMIT,out=str(target))
                self.assertEqual(denied.call_count,30)
                self.assertTrue(r.verify_proof(result))
                self.assertEqual(json.loads(target.read_text()),result)


def make_mutation(label,func):
    def test(self):self.bad(label,func)
    test.__name__='test_mutation_'+re.sub('[^a-z0-9_]','_',label)
    return test

for key in r.LOCK:
    def f(v,k=key):
        val=v[k]
        v[k]=(not val) if type(val) is bool else ('HACKED' if type(val) is str else val+1)
    setattr(Proof,'test_lock_mutated_'+key,make_mutation('lock_'+key,f))

for name,fn in {
    'extra_field':lambda x:x.update(extra=1),
    'missing_fields':lambda x:x.pop('catalogAfter'),
    'fake_commit':lambda x:x.__setitem__('githubCommit','invalid'),
    'function_removed':lambda x:x['catalogBefore']['functions'].pop(),
    'function_added':lambda x:x['catalogBefore']['functions'].append(copy.deepcopy(x['catalogBefore']['functions'][0])),
    'function_order':lambda x:x['catalogBefore']['functions'].reverse(),
    'table_removed':lambda x:x['catalogBefore']['tables'].pop(),
    'table_added':lambda x:x['catalogBefore']['tables'].append(copy.deepcopy(x['catalogBefore']['tables'][0])),
    'table_wrong_order':lambda x:x['catalogBefore']['tables'].reverse(),
    'snapshots_missing':lambda x:x['snapshots'].pop(),
    'snapshots_extra':lambda x:x['snapshots'].append(copy.deepcopy(x['snapshots'][0])),
    'snapshot_broken':lambda x:x['snapshots'][1].__setitem__('bookings','deadbeef'),
    'snapshot_drift':lambda x:x['snapshots'][3].__setitem__('bookings','c'*32),
    'rejection_missing':lambda x:x['rejections'].pop(),
    'rejection_duplicate':lambda x:x['rejections'].append(copy.deepcopy(x['rejections'][-1])),
    'rejection_order':lambda x:x['rejections'].reverse(),
    'rejection_state':lambda x:x['rejections'][0].__setitem__('sqlstate','42P01'),
    'rejection_actor':lambda x:x['rejections'][0].__setitem__('actor','postgres'),
    'rejection_op':lambda x:x['rejections'][0].__setitem__('operation','fake'),
    'visible_tenant':lambda x:x['visibleBookingsAfter'].__setitem__('bs',2),
    'visible_owner':lambda x:x['visibleBookingsAfter'].__setitem__('a2',1),
    'visible_type':lambda x:x['visibleBookingsAfter'].__setitem__('a1',True),
}.items():setattr(Proof,'test_'+name,make_mutation(name,fn))

for i in range(4):
    for key,val in {'owner':'attacker','definer':False,'config':['search_path=public'],'bodyHash':'0'*32}.items():
        def f(v,i=i,k=key,x=val):v['catalogAfter']['functions'][i][k]=x
        setattr(Proof,f'test_function_{i}_{key}',make_mutation(f'function_{i}_{key}',f))
for i in range(5):
    for key,val in {'owner':'attacker','rls':False,'force':False}.items():
        def f(v,i=i,k=key,x=val):v['catalogAfter']['tables'][i][k]=x
        setattr(Proof,f'test_table_{i}_{key}',make_mutation(f'table_{i}_{key}',f))
for i in range(30):
    def f(v,i=i):v['rejections'][i]['sqlstate']='00000'
    setattr(Proof,f'test_rejected_sqlstate_{i}',make_mutation(f'reject_{i}',f))

if __name__=='__main__':unittest.main()

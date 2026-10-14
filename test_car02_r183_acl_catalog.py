#!/usr/bin/env python3
"""R183: offline adversarial catalog/ACL proof validation and real file I/O.
No Docker or remote connection is required for these tests.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import car02_r182_acl_catalog_isolated as r
COMMIT='f'*40


def catalog():
    return {
        'database':r.DB, 'serverMajor':17,
        'tables':{t:{'rls':True,'force':True,'policyCount':1} for t in r.TABLES},
        'roles':{role:{'login':True,'superuser':False,'createdb':False,
            'createrole':False,'replication':False,'bypassRls':False,'inherits':False}
                 for role in r.ROLES_FULL},
        'functions':{fun:{'definer':True,'settings':['search_path=pg_catalog'],
                          'publicExecute':False} for fun in r.FUNCS},
        'tableGrants':{role+':'+t:{'select':True,'insert':False,'update':False,'delete':False}
                       for role in r.ROLES_FULL for t in r.TABLES},
        'functionGrants':{role+':'+fn:(role in (r.ROLES['as'],r.ROLES['bs'])
                if fn in ('claim_booking','open_case') else True)
                for role in r.ROLES_FULL for fn in r.FUNCS},
    }

def sample():
    c=catalog()
    snap={t:hashlib.md5(b'[]').hexdigest() for t in r.TABLES}
    doc=dict(r.LOCK,githubCommit=COMMIT,catalog=c,catalogSha256=r.digest(c),
             rejectedCommands={x:True for x in r.REJECTIONS},
             fiveTableBefore=snap,fiveTableAfter=snap.copy())
    doc['sha256']=r.digest(doc)
    return doc

def reseal(doc):
    doc['catalogSha256']=r.digest(doc['catalog'])
    doc['sha256']=r.digest({k:v for k,v in doc.items() if k!='sha256'})
    return doc

class R183Offline(unittest.TestCase):
    def fail(self, doc):
        with self.assertRaises(r.ACLError):
            r.verify_report(reseal(doc))
    def test_baseline(self): self.assertTrue(r.verify_report(sample()))
    def test_catalog_baseline(self):self.assertTrue(r.validate_catalog(catalog()))
    def test_json_roundtrip(self):self.assertTrue(r.verify_report(json.loads(json.dumps(sample()))))
    def test_wrong_sha(self):
        d=sample();d['sha256']='0'*64
        with self.assertRaises(r.ACLError):r.verify_report(d)
    def test_wrong_catalog_sha(self):
        d=sample();d['catalogSha256']='0'*64;d['sha256']=r.digest({k:v for k,v in d.items() if k!='sha256'})
        with self.assertRaises(r.ACLError):r.verify_report(d)
    def test_unknown_catalog_field(self):
        d=sample();d['catalog']['unknown']=1;self.fail(d)
    def test_missing_catalog_field(self):
        d=sample();del d['catalog']['roles'];self.fail(d)
    def test_postgres16(self):d=sample();d['catalog']['serverMajor']=16;self.fail(d)
    def test_major_bool(self):d=sample();d['catalog']['serverMajor']=True;self.fail(d)
    def test_wrong_db(self):d=sample();d['catalog']['database']='postgres';self.fail(d)
    def test_missing_table(self):d=sample();del d['catalog']['tables']['audit_events'];self.fail(d)
    def test_extra_table(self):d=sample();d['catalog']['tables']['secrets']={'rls':True,'force':True,'policyCount':1};self.fail(d)
    def test_missing_role(self):d=sample();del d['catalog']['roles'][r.ROLES['a1']];self.fail(d)
    def test_extra_role(self):d=sample();d['catalog']['roles']['production_user']=d['catalog']['roles'][r.ROLES['a1']].copy();self.fail(d)
    def test_missing_function(self):d=sample();del d['catalog']['functions']['case_step'];self.fail(d)
    def test_extra_function(self):d=sample();d['catalog']['functions']['admin']=d['catalog']['functions']['open_case'].copy();self.fail(d)
    def test_missing_table_grant(self):d=sample();del d['catalog']['tableGrants'][r.ROLES['a1']+':bookings'];self.fail(d)
    def test_extra_table_grant(self):d=sample();d['catalog']['tableGrants']['bad:admin']={'select':True};self.fail(d)
    def test_missing_function_grant(self):d=sample();del d['catalog']['functionGrants'][r.ROLES['a1']+':case_step'];self.fail(d)
    def test_extra_function_grant(self):d=sample();d['catalog']['functionGrants']['admin:all']=True;self.fail(d)
    def test_denial_deleted(self):d=sample();del d['rejectedCommands'][r.REJECTIONS[0]];self.fail(d)
    def test_denial_wrong_type(self):d=sample();d['rejectedCommands'][r.REJECTIONS[0]]=1;self.fail(d)
    def test_denial_false(self):d=sample();d['rejectedCommands'][r.REJECTIONS[0]]=False;self.fail(d)
    def test_denial_extra(self):d=sample();d['rejectedCommands']['fake']=True;self.fail(d)
    def test_snapshot_drift(self):d=sample();d['fiveTableAfter']['bookings']='e'*32;self.fail(d)
    def test_snapshot_missing(self):d=sample();del d['fiveTableAfter']['audit_events'];self.fail(d)
    def test_snapshot_invalid_hash(self):d=sample();d['fiveTableBefore']['bookings']='bad';self.fail(d)
    def test_commit_uppercase(self):d=sample();d['githubCommit']='A'*40;self.fail(d)
    def test_commit_invalid(self):d=sample();d['githubCommit']='g'*40;self.fail(d)
    def test_extra_proof_claim(self):d=sample();d['productionReady']=True;self.fail(d)
    def test_real_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            target=Path(td)/'proof.json';r.save(sample(),target)
            self.assertTrue(r.verify_report(json.loads(target.read_text(encoding='ascii'))))
    def test_existing_file(self):
        with tempfile.TemporaryDirectory() as td:
            target=Path(td)/'proof.json';r.save(sample(),target)
            with self.assertRaises(r.ACLError):r.save(sample(),target)
    def test_missing_parent(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.ACLError):r.save(sample(),Path(td)/'missing'/'proof.json')
    def test_symlink(self):
        with tempfile.TemporaryDirectory() as td:
            folder=Path(td);origin=folder/'safe.txt';origin.write_text('safe')
            link=folder/'proof.json';link.symlink_to(origin)
            with self.assertRaises(r.ACLError):r.save(sample(),link)
            self.assertEqual(origin.read_text(),'safe')
    def test_output_path_invalid_before_db(self):
        with self.assertRaises(r.ACLError):r.probe('a'*12,COMMIT,'/tmp/other.json')
    def test_missing_isolation_guard(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R182_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.ACLError):r.probe('a'*12,COMMIT)
    def test_invalid_container_before_db(self):
        with self.assertRaises(r.ACLError):r.probe('production',COMMIT)

def table_mut(name, prop, value):
    def go(self):
        d=sample();d['catalog']['tables'][name][prop]=value;self.fail(d)
    return go

def role_mut(name, prop, value):
    def go(self):
        d=sample();d['catalog']['roles'][name][prop]=value;self.fail(d)
    return go

def func_mut(name, prop, value):
    def go(self):
        d=sample();d['catalog']['functions'][name][prop]=value;self.fail(d)
    return go

for tbl in r.TABLES:
    for prop,val in [('rls',False),('force',False),('policyCount',0)]:
        setattr(R183Offline,'test_table_'+tbl+'_'+prop,table_mut(tbl,prop,val))
for name in r.ROLES_FULL:
    for prop,val in [('superuser',True),('bypassRls',True),('createrole',True),('inherits',True)]:
        setattr(R183Offline,'test_role_'+name+'_'+prop,role_mut(name,prop,val))
for fun in r.FUNCS:
    for prop,val in [('definer',False),('settings',['search_path=public']),('publicExecute',True)]:
        setattr(R183Offline,'test_function_'+fun+'_'+prop,func_mut(fun,prop,val))
for grant in ('insert','update','delete'):
    def new_case(permission):
        def test(self):
            d=sample();d['catalog']['tableGrants'][r.ROLES['a1']+':bookings'][permission]=True;self.fail(d)
        return test
    setattr(R183Offline,'test_unauthorized_table_'+grant,new_case(grant))
for fun in ('claim_booking','open_case'):
    def new_case(name):
        def test(self):
            d=sample();d['catalog']['functionGrants'][r.ROLES['a1']+':'+name]=True;self.fail(d)
        return test
    setattr(R183Offline,'test_customer_cannot_'+fun,new_case(fun))

if __name__=='__main__':unittest.main()

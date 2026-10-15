#!/usr/bin/env python3
"""R234: fail-closed role/grant proof mutation and full probe orchestration QA."""
from __future__ import annotations
import copy, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import car02_r233_role_grant_isolated as r

SHA='a'*40

def snap(i):return {t:format(i*100+j,'032x') for j,t in enumerate(r.TABLES)}
def roles():
    return {'attributes':[{'name':n,'inherit':False,'super':False,
        'createrole':False,'bypassrls':False} for n in sorted(r.ROLES.values())],
        'memberships':0,'functionExec':{'as':True,'a1':False,'a2':False,'bs':True,'b1':False}}
def catalog():
    funcs=[dict(name=n,owner='postgres',definer=True,config=['search_path=pg_catalog'],
        bodyHash='a'*32,acl=None) for n in ('case_step','change_booking','claim_booking','open_case')]
    tables=[dict(name=n,owner='postgres',rls=True,force=True,acl=None) for n in sorted(r.TABLES)]
    return {'functions':funcs,'tables':tables}
def valid():
    x=dict(r.LOCK,githubCommit=SHA,catalogBefore=catalog(),catalogAfter=catalog(),
        rolesBefore=roles(),rolesAfter=roles(),before=snap(1),after=snap(1),
        rejections=[{'actor':a,'operation':op,'sqlstate':'42501'} for a in r.ACTORS for op in r.OPERATIONS],
        visibleBefore={'as':1,'a1':1,'a2':0,'bs':1,'b1':1},
        visibleAfter={'as':1,'a1':1,'a2':0,'bs':1,'b1':1})
    x['sha256']=r.seal(x)
    return x

class Report(unittest.TestCase):
    def reject(self,d,reseal=True):
        if reseal and 'sha256' in d:d['sha256']=r.seal(d)
        with self.assertRaises(r.GrantError):r.verify_proof(d)
    def test_valid(self):
        self.assertTrue(r.verify_proof(valid()))
        d=valid()
        d['rejections'][2]['sqlstate']='01007' # table GRANT ineffective, no rights added
        d['sha256']=r.seal(d)
        self.assertTrue(r.verify_proof(d))
        d['rejections'][2]['sqlstate']='00000' # silent successful GRANT is NEVER safe
        self.reject(d)
        for op in ('grant_execute','grant_select_option'):
            d=valid()
            pos=r.OPERATIONS.index(op)
            d['rejections'][pos]['sqlstate']='01007'
            d['sha256']=r.seal(d)
            self.assertTrue(r.verify_proof(d))
    def test_denial_count(self):self.assertEqual(len(valid()['rejections']),25)
    def test_ops_exact(self):self.assertEqual(set(r.SQL),set(r.OPERATIONS))
    def test_sql_no_delete(self):self.assertFalse(any('DELETE ' in q or 'DROP ' in q for q in r.SQL.values()))
    def test_sql_no_prod(self):self.assertFalse(any('supabase' in q.lower() for q in r.SQL.values()))
    def test_no_sql_multi_statement(self):
        for q in r.SQL.values():self.assertEqual(q.count(';'),1)
    def test_five_actors(self):self.assertEqual(set(r.ACTORS),set(r.ROLES))
    def test_valid_role_catalog(self):self.assertTrue(r.validate_roles(roles()))
    def test_seal_deterministic(self):self.assertEqual(r.seal(valid()),r.seal(valid()))
    def test_output_roundtrip(self):
        with tempfile.TemporaryDirectory() as root:
            p=Path(root)/'evidence.json'
            self.assertEqual(r.save(valid(),p),p)
            self.assertEqual(json.loads(p.read_text()),valid())
    def test_output_no_overwrite(self):
        with tempfile.TemporaryDirectory() as root:
            p=Path(root)/'proof.json';p.write_text('original')
            with self.assertRaises(r.GrantError):r.save(valid(),p)
            self.assertEqual(p.read_text(),'original')
    def test_output_parent_missing(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(r.GrantError):r.save(valid(),Path(root)/'missing'/'a.json')
    def test_output_str_rejected(self):
        with self.assertRaises(r.GrantError):r.save(valid(),'text.json')
    def test_bad_digest(self):
        d=valid();d['sha256']='0'*64;self.reject(d,False)
    def test_fake_sqlstate_not_accepted(self):
        d=valid();d['rejections'][0]['sqlstate']='00000';self.reject(d)
    def test_grant_command_denied_strict(self):
        p=type('Fake',(),{'returncode':1,'stderr':'ERROR:  42501: permission denied'})()
        with patch.object(r.subprocess,'run',return_value=p) as m:
            self.assertEqual(r.reject_grant('a'*16,'as','grant_staff_role')['sqlstate'],'42501')
            self.assertEqual(m.call_args.args[0][0:3],['docker','exec','-i'])
    def test_successful_grant_refused(self):
        p=type('Fake',(),{'returncode':0,'stderr':''})()
        with patch.object(r.subprocess,'run',return_value=p):
            with self.assertRaises(r.GrantError):r.reject_grant('a'*16,'as','grant_staff_role')
        # PostgreSQL WARNING 01007 means *no privileges were granted*, but
        # it is accepted only if independent catalog/role/data checks agree.
        warning=type('Fake',(),{'returncode':0,
            'stderr':'WARNING:  01007: no privileges were granted for "bookings"\n'})()
        args=('a'*16,'as','grant_table_mutate',catalog(),roles(),snap(1))
        with patch.object(r.subprocess,'run',return_value=warning),\
             patch.object(r,'protected_catalog',return_value=catalog()),\
             patch.object(r,'role_catalog',return_value=roles()),\
             patch.object(r,'snapshot',return_value=snap(1)):
            self.assertEqual(r.reject_grant(*args)['sqlstate'],'01007')
            with self.assertRaises(r.GrantError):
                r.reject_grant('a'*16,'as','grant_table_mutate')
            with self.assertRaises(r.GrantError):
                r.reject_grant('a'*16,'as','grant_staff_role',catalog(),roles(),snap(1))
        # Each grantable-object operation can warn, but no other GRANT action can.
        with patch.object(r.subprocess,'run',return_value=warning),\
             patch.object(r,'protected_catalog',return_value=catalog()),\
             patch.object(r,'role_catalog',return_value=roles()),\
             patch.object(r,'snapshot',return_value=snap(1)):
            for op in ('grant_execute','grant_select_option'):
                self.assertEqual(r.reject_grant('a'*16,'as',op,catalog(),roles(),snap(1))['sqlstate'],'01007')
        # A warning is not sufficient proof if even one ACL, role or row changed.
        changed=catalog();changed['tables'][0]['acl']='unexpected grant'
        with patch.object(r.subprocess,'run',return_value=warning),\
             patch.object(r,'protected_catalog',return_value=changed):
            with self.assertRaises(r.GrantError):r.reject_grant(*args)
        changed_roles=roles();changed_roles['memberships']=1
        with patch.object(r.subprocess,'run',return_value=warning),\
             patch.object(r,'protected_catalog',return_value=catalog()),\
             patch.object(r,'role_catalog',return_value=changed_roles):
            with self.assertRaises(r.GrantError):r.reject_grant(*args)
        with patch.object(r.subprocess,'run',return_value=warning),\
             patch.object(r,'protected_catalog',return_value=catalog()),\
             patch.object(r,'role_catalog',return_value=roles()),\
             patch.object(r,'snapshot',return_value=snap(2)):
            with self.assertRaises(r.GrantError):r.reject_grant(*args)
        # Other warnings, fabricated SQLSTATEs and silent successes fail closed.
        for response in ('WARNING:  01006: privilege not revoked',
                         'WARNING:  01007: some privileges granted',
                         'ERROR:  01007: no privileges were granted for "bookings"'):
            with patch.object(r.subprocess,'run',return_value=type('Fake',(),{
                    'returncode':0,'stderr':response})()):
                with self.assertRaises(r.GrantError):r.reject_grant(*args)
    def test_other_error_refused(self):
        p=type('Fake',(),{'returncode':1,'stderr':'ERROR:  42P01: fake'})()
        with patch.object(r.subprocess,'run',return_value=p):
            with self.assertRaises(r.GrantError):r.reject_grant('a'*16,'as','grant_staff_role')
    def test_bad_container_refused(self):
        with self.assertRaises(r.GrantError):r.reject_grant('localhost','as','grant_staff_role')
    def test_bad_actor_refused(self):
        with self.assertRaises(r.GrantError):r.reject_grant('a'*16,'root','grant_staff_role')
    def test_bad_operation_refused(self):
        with self.assertRaises(r.GrantError):r.reject_grant('a'*16,'as','DROP EVERYTHING')
    def test_fail_closed_probe_env(self):
        with patch.dict(r.os.environ,{},clear=True):
            with self.assertRaises(r.GrantError):r.probe('a'*16,SHA)
    def test_invalid_commit_probe(self):
        with self.assertRaises(r.GrantError):r.probe('a'*16,'bad')
    def test_mock_probe_flow(self):
        with tempfile.TemporaryDirectory() as folder:
            out=r.OUT
            import os
            old=os.getcwd();os.chdir(folder)
            try:
                Path('qa-evidence-r233').mkdir()
                with patch.dict(r.os.environ,{'GITHUB_SHA':SHA,'CAR02_RELEASE_LOCK':'true','R233_DISPOSABLE_QA':'yes'}),\
                     patch.object(r,'snapshot',side_effect=[dict.fromkeys(r.TABLES,r.hashlib.md5(b'[]').hexdigest()),snap(1),snap(1)]),\
                     patch.object(r,'next_business_days',return_value=['2099-01-01']),\
                     patch.object(r,'booking',side_effect=['CREATED','CREATED']),\
                     patch.object(r,'integer',side_effect=[1,1,0,1,1,1,1,0,1,1]),\
                     patch.object(r,'role_catalog',side_effect=[roles(),roles()]),\
                     patch.object(r,'protected_catalog',side_effect=[catalog(),catalog()]),\
                     patch.object(r,'reject_grant',side_effect=[{'actor':a,'operation':op,'sqlstate':'42501'} for a in r.ACTORS for op in r.OPERATIONS]):
                    doc=r.probe('a'*16,SHA)
                    self.assertTrue(r.verify_proof(doc))
                    self.assertTrue(Path(out).exists())
            finally:os.chdir(old)


def make_lock_mutation(k):
    def f(self):
        d=valid();v=d[k]
        d[k] = (not v) if type(v) is bool else (v+1 if type(v) is int else 'TAMPER')
        self.reject(d)
    return f
for key in r.LOCK:
    setattr(Report,'test_lock_'+key,make_lock_mutation(key))

def make_roles_mutation(key,which):
    def f(self):
        d=valid();row=d[which]
        if key=='membership':row['memberships']=1
        elif key=='super':row['attributes'][0]['super']=True
        elif key=='bypassrls':row['attributes'][0]['bypassrls']=True
        elif key=='inherit':row['attributes'][0]['inherit']=True
        elif key=='createrole':row['attributes'][0]['createrole']=True
        elif key=='name':row['attributes'][0]['name']='postgres'
        elif key=='staff-execute':row['functionExec']['as']=False
        else:row['functionExec']['a1']=True
        self.reject(d)
    return f
for k in ('membership','super','bypassrls','inherit','createrole','name','staff-execute','customer-execute'):
    for w in ('rolesBefore','rolesAfter'):
        setattr(Report,'test_role_'+w+'_'+k.replace('-','_'),make_roles_mutation(k,w))

def make_rejection_mutation(i,kind):
    def f(self):
        d=valid()
        if kind=='actor':d['rejections'][i]['actor']='postgres'
        elif kind=='op':d['rejections'][i]['operation']='allowed'
        elif kind=='state':d['rejections'][i]['sqlstate']='23505'
        elif kind=='drop':d['rejections'].pop(i)
        else:d['rejections'].append(copy.deepcopy(d['rejections'][i]))
        self.reject(d)
    return f
for i in range(25):
    for kind in ('actor','op','state'):
        setattr(Report,f'test_denial_{i:02}_{kind}',make_rejection_mutation(i,kind))
for i in (0,12,24):
    for kind in ('drop','duplicate'):
        setattr(Report,f'test_denial_{i:02}_{kind}',make_rejection_mutation(i,kind))

def make_catalog_mutation(target):
    def f(self):
        d=valid()
        if target=='before':d['catalogBefore']['functions'][0]['definer']=False
        elif target=='after':d['catalogAfter']['tables'][0]['force']=False
        else:d['catalogAfter']['functions'][0]['acl']='tampered'
        self.reject(d)
    return f
for t in ('before','after','acl'):
    setattr(Report,'test_catalog_'+t,make_catalog_mutation(t))

def make_simple_mutation(k):
    def f(self):
        d=valid()
        if k=='snap-before':d['before'][r.TABLES[0]]='0'*32
        elif k=='snap-after':d['after'][r.TABLES[0]]='0'*32
        elif k=='vis-before':d['visibleBefore']['a1']=2
        elif k=='vis-after':d['visibleAfter']['b1']=2
        elif k=='commit':d['githubCommit']='not a sha'
        elif k=='extra':d['unknown']=True
        else:del d['after']
        self.reject(d)
    return f
for k in ('snap-before','snap-after','vis-before','vis-after','commit','extra','missing'):
    setattr(Report,'test_invariant_'+k.replace('-','_'),make_simple_mutation(k))

if __name__=='__main__':unittest.main()

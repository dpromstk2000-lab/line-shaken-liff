#!/usr/bin/env python3
"""R182: disposable PostgreSQL 17 catalog/ACL/definer/RLS audit only.

READ-ONLY catalog queries plus denied impersonation commands by synthetic roles.
No production identity, storage, endpoints, auth assurance, migration or release.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from car02_r138_pg17_lifecycle_qa import ROLES, psql
from car02_r159_concurrent_booking_isolated import DB, CID, COMMIT
from car02_r171_rejection_immutability_isolated import snapshot, TABLES

OUTPUT = 'qa-evidence-r182/r182-catalog-acl-proof.json'
FUNCS = ('claim_booking', 'open_case', 'case_step', 'change_booking')
ROLES_FULL = tuple(sorted(ROLES.values()))
REJECTIONS = ('set_role_staff_denied', 'set_session_authorization_denied',
              'set_role_other_shop_denied', 'direct_insert_denied')
LOCK = dict(version='R182', mode='DISPOSABLE_PG17_CATALOG_ACL_RLS_AUDIT_ONLY',
            release='NO_GO', migration='HOLD', realWorldGatesOpen=12,
            syntheticOnly=True, productionTouched=False, productionAuthorized=False,
            realAuthenticationVerified=False, realRLSVerified=False,
            externalWitnessVerified=False, externalSignatureVerified=False,
            independentProductionTest=False, fixtureDb=DB,
            sourceR138BUnchanged=True, sourceR171Unchanged=True,
            catalogReadOnly=True, realProductionAclNotVerified=True)

class ACLError(AssertionError):
    pass

def require(ok, label):
    if not ok:
        raise ACLError('R182_' + label)

def digest(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=True,
                        allow_nan=False, separators=(',', ':')).encode('ascii')).hexdigest()

# All SQL is constant and scoped to a throwaway database + fixed fixture object names.
CATALOG_SQL = r"""SELECT jsonb_build_object(
 'database',current_database(),
 'serverMajor',current_setting('server_version_num')::int/10000,
 'tables',(SELECT jsonb_object_agg(c.relname,jsonb_build_object(
  'rls',c.relrowsecurity,'force',c.relforcerowsecurity,
  'policyCount',(SELECT count(*) FROM pg_policies p WHERE p.schemaname='car02_r138_qa' AND p.tablename=c.relname)))
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='car02_r138_qa' AND c.relkind='r'),
 'roles',(SELECT jsonb_object_agg(r.rolname,jsonb_build_object(
  'login',r.rolcanlogin,'superuser',r.rolsuper,'createdb',r.rolcreatedb,
  'createrole',r.rolcreaterole,'replication',r.rolreplication,
  'bypassRls',r.rolbypassrls,'inherits',r.rolinherit))
  FROM pg_roles r WHERE r.rolname LIKE 'car02_r138_%_ci'),
 'functions',(SELECT jsonb_object_agg(p.proname,jsonb_build_object(
  'definer',p.prosecdef,'settings',p.proconfig,
  'publicExecute',(SELECT EXISTS(SELECT 1 FROM aclexplode(
    coalesce(p.proacl,acldefault('f',p.proowner))) acl
    WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'))))
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='car02_r138_qa'),
 'tableGrants',(SELECT jsonb_object_agg(r.rolname||':'||c.relname,
    jsonb_build_object('select',has_table_privilege(r.rolname,c.oid,'SELECT'),
    'insert',has_table_privilege(r.rolname,c.oid,'INSERT'),
    'update',has_table_privilege(r.rolname,c.oid,'UPDATE'),
    'delete',has_table_privilege(r.rolname,c.oid,'DELETE')))
  FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE r.rolname LIKE 'car02_r138_%_ci'
    AND n.nspname='car02_r138_qa' AND c.relkind='r'),
 'functionGrants',(SELECT jsonb_object_agg(r.rolname||':'||p.proname,
    has_function_privilege(r.rolname,p.oid,'EXECUTE'))
   FROM pg_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE r.rolname LIKE 'car02_r138_%_ci' AND n.nspname='car02_r138_qa')
)::text;"""

def validate_catalog(cat):
    require(type(cat) is dict and set(cat)=={
        'database','serverMajor','tables','roles','functions','tableGrants','functionGrants'}, 'CATALOG_FIELDS')
    require(cat['database']==DB and type(cat['serverMajor']) is int
            and cat['serverMajor']==17, 'PG17_SCOPE')
    require(type(cat['tables']) is dict and set(cat['tables'])==set(TABLES), 'TABLE_SET')
    for table, data in cat['tables'].items():
        require(type(data) is dict and data == {'rls':True,'force':True,'policyCount':1}, 'TABLE_RLS_'+table)
    require(type(cat['roles']) is dict and set(cat['roles'])==set(ROLES_FULL), 'ROLE_SET')
    for role,data in cat['roles'].items():
        require(type(data) is dict and data == {
            'login':True,'superuser':False,'createdb':False,'createrole':False,
            'replication':False,'bypassRls':False,'inherits':False}, 'ROLE_PRIVILEGES_'+role)
    require(type(cat['functions']) is dict and set(cat['functions'])==set(FUNCS), 'FUNCTION_SET')
    for fun,data in cat['functions'].items():
        require(type(data) is dict and data == {'definer':True,
            'settings':['search_path=pg_catalog'],'publicExecute':False}, 'FUNCTION_SAFETY_'+fun)
    table_keys={role+':'+table for role in ROLES_FULL for table in TABLES}
    require(type(cat['tableGrants']) is dict and set(cat['tableGrants'])==table_keys, 'TABLE_GRANT_SET')
    for key,data in cat['tableGrants'].items():
        require(type(data) is dict and data == {'select':True,'insert':False,
            'update':False,'delete':False}, 'DML_GRANT_'+key)
    fun_keys={role+':'+fun for role in ROLES_FULL for fun in FUNCS}
    require(type(cat['functionGrants']) is dict and set(cat['functionGrants'])==fun_keys,'FUNCTION_GRANT_SET')
    for role in ROLES_FULL:
        is_staff=role in (ROLES['as'],ROLES['bs'])
        for fun in FUNCS:
            expected=is_staff if fun in ('claim_booking','open_case') else True
            granted=cat['functionGrants'][role+':'+fun]
            require(type(granted) is bool and granted is expected, 'FUNCTION_ACL_'+role+'_'+fun)
    return True

def verify_report(report):
    require(type(report) is dict and set(report)==set(LOCK)|{
        'githubCommit','catalog','catalogSha256','rejectedCommands','fiveTableBefore',
        'fiveTableAfter','sha256'}, 'FIELDS')
    for k,v in LOCK.items():
        require(type(report[k]) is type(v) and report[k]==v,'LOCK_'+k)
    require(type(report['githubCommit']) is str and COMMIT.fullmatch(report['githubCommit']), 'COMMIT')
    validate_catalog(report['catalog'])
    require(type(report['catalogSha256']) is str and report['catalogSha256']==digest(report['catalog']), 'CATALOG_HASH')
    require(type(report['rejectedCommands']) is dict and set(report['rejectedCommands'])==set(REJECTIONS)
            and all(type(v) is bool and v is True for v in report['rejectedCommands'].values()), 'IMPERSONATION_DENIED')
    for name in ('fiveTableBefore','fiveTableAfter'):
        s=report[name]
        require(type(s) is dict and set(s)==set(TABLES) and all(
            type(v) is str and re.fullmatch('[a-f0-9]{32}',v) for v in s.values()), 'SNAPSHOT')
    require(report['fiveTableBefore']==report['fiveTableAfter'], 'DENIED_MUTATION')
    require(type(report['sha256']) is str and re.fullmatch('[a-f0-9]{64}',report['sha256'])
            and report['sha256']==digest({k:v for k,v in report.items() if k!='sha256'}),'SHA256')
    return True

def read_catalog(cid):
    require(type(cid) is str and CID.fullmatch(cid),'CID')
    args=['docker','exec','-i',cid,'psql','-X','-A','-t','-v','ON_ERROR_STOP=1',
          '-U','postgres','-d',DB,'-c',CATALOG_SQL]
    res=subprocess.run(args,capture_output=True,text=True,timeout=30)
    require(res.returncode==0,'CATALOG_QUERY_'+res.stderr[-160:])
    try: cat=json.loads(res.stdout.strip())
    except (ValueError,TypeError) as exc: raise ACLError('R182_CATALOG_JSON') from exc
    validate_catalog(cat)
    return cat

def save(report, target):
    require(isinstance(target,Path) and target.parent.is_dir() and not target.parent.is_symlink()
            and not target.exists() and not target.is_symlink(),'OUTPUT_PATH')
    verify_report(report)
    with target.open('x',encoding='ascii') as stream:
        stream.write(json.dumps(report,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False)+'\n')
    reread=json.loads(target.read_text(encoding='ascii'))
    require(reread==report and verify_report(reread),'OUTPUT_ROUNDTRIP')
    return target

def probe(cid, commit, output=OUTPUT):
    require(type(cid) is str and CID.fullmatch(cid),'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit),'COMMIT_ARG')
    require(output==OUTPUT and os.environ.get('GITHUB_SHA')==commit
            and os.environ.get('CAR02_RELEASE_LOCK')=='true'
            and os.environ.get('R182_DISPOSABLE_QA')=='yes','ISOLATION_LOCK')
    target=Path(output)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'OUTPUT_EXISTS')
    before=snapshot(cid)
    require(all(v==hashlib.md5(b'[]').hexdigest() for v in before.values()),'EMPTY_FIXTURE')
    cat=read_catalog(cid)
    denied={}
    for label,actor,command in (
      ('set_role_staff_denied','a1','SET ROLE car02_r138_a_staff_ci;'),
      ('set_session_authorization_denied','a1','SET SESSION AUTHORIZATION car02_r138_a_staff_ci;'),
      ('set_role_other_shop_denied','a1','SET ROLE car02_r138_b_staff_ci;'),
      ('direct_insert_denied','a1',"INSERT INTO car02_r138_qa.audit_events(shop_code,owner_login,entity_id,action) VALUES ('street_house_demo','car02_r138_a_one_ci',1,'BOOKED');"),
    ):
        require(psql(cid,DB,actor,command,False,expected_error='permission denied')=='REJECTED','REFUSE_'+label)
        denied[label]=True
        require(snapshot(cid)==before,'REJECTED_CHANGED_'+label)
    require(read_catalog(cid)==cat,'CATALOG_CHANGED')
    report=dict(LOCK,githubCommit=commit,catalog=cat,catalogSha256=digest(cat),
                rejectedCommands=denied,fiveTableBefore=before,fiveTableAfter=snapshot(cid))
    report['sha256']=digest(report)
    save(report,target)
    print('R182_DISPOSABLE_PG17_CATALOG_ACL_RLS_IMPERSONATION_PASS_NO_GO_HOLD')
    return report

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--cid',required=True)
    ap.add_argument('--commit',required=True)
    ap.add_argument('--out',default=OUTPUT)
    x=ap.parse_args();probe(x.cid,x.commit,x.out)

if __name__=='__main__':main()

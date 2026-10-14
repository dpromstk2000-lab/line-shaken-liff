#!/usr/bin/env python3
"""R143/R144: disposable PG17 authz boundary probe. NOT a migration.

Only the fixed R138 QA database, fixed synthetic roles and an isolated GitHub
Postgres service container are permitted. The probe never mutates persisted
business records: its adversarial SQL is exclusively expected-to-fail.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

DB = 'car02_r138_qa_ci'
ROLE_PASSWORD = 'r138-throwaway-only'  # throwaway fixture from frozen R138B
ROLES = {
 'as': 'car02_r138_a_staff_ci', 'a1':'car02_r138_a_one_ci',
 'a2':'car02_r138_a_two_ci', 'bs':'car02_r138_b_staff_ci',
 'b1':'car02_r138_b_one_ci'
}
TABLES = ('bookings','service_cases','case_operations','booking_operations','audit_events')
EXPECTED = {
 'as':(6,2), 'a1':(3,1), 'a2':(3,1), 'bs':(2,1), 'b1':(2,1)
}
# Frozen R138B fixture booking counts after its full lifecycle_source run.
# These exact values detect test-data drift and accidental wider RLS visibility.
PROOF_FILE = Path('qa-evidence-r143/r143-r144-boundary-proof.json')
SOURCE_FILE = Path('qa-evidence-r143/r138-source.json')

class GateError(AssertionError): pass

def must(value, code):
    if not value: raise GateError('R143_'+code)

def guard(cid, source, output):
    must(os.environ.get('CAR02_RELEASE_LOCK')=='true', 'RELEASE_LOCK')
    must(os.environ.get('R138_DISPOSABLE_QA')=='yes' and
         os.environ.get('R143_DISPOSABLE_QA')=='yes', 'DISPOSABLE_FLAG')
    must(type(cid) is str and re.fullmatch('[0-9a-f]{12,64}',cid) is not None, 'CID')
    must(type(source) is str and Path(source)==SOURCE_FILE, 'SOURCE_LOCATION')
    must(type(output) is str and Path(output)==PROOF_FILE, 'PROOF_LOCATION')

def run(cid, sql, role='postgres', expected_error=None):
    must(os.environ.get('CAR02_RELEASE_LOCK')=='true' and
         os.environ.get('R138_DISPOSABLE_QA')=='yes' and
         os.environ.get('R143_DISPOSABLE_QA')=='yes','DISPOSABLE_FLAG')
    must(type(cid) is str and re.fullmatch('[0-9a-f]{12,64}',cid) is not None,'CID')
    must(type(sql) is str and 0<len(sql)<5000 and '\x00' not in sql,'QUERY_SHAPE')
    must(role=='postgres' or role in ROLES,'ROLE_SCOPE')
    cmd=['docker','exec','-i',cid]
    if role!='postgres':
        cmd+=['env','PGPASSWORD='+ROLE_PASSWORD]
        cmd+=['psql','-h','127.0.0.1','-U',ROLES[role]]
    else:
        cmd+=['psql','-U','postgres']
    cmd+=['-d',DB,'-X','-A','-t','-v','ON_ERROR_STOP=1','-c',sql]
    p=subprocess.run(cmd,text=True,capture_output=True,timeout=20,check=False)
    if expected_error is not None:
        must(p.returncode!=0,'DENY_EXPECTED')
        must(expected_error in p.stderr,'DENY_WRONG_ERROR')
        return 'DENIED'
    must(p.returncode==0,'PG_COMMAND_FAILED:'+p.stderr[-180:])
    return p.stdout.strip()

def scalar(cid,sql, role='postgres'):
    v=run(cid,sql,role)
    must('\n' not in v,'UNEXPECTED_ROW_COUNT')
    return v

def integer(cid,sql,role='postgres'):
    s=scalar(cid,sql,role)
    must(re.fullmatch(r'[0-9]+',s) is not None,'NOT_INTEGER')
    return int(s)

def proof_source(source):
    obj=json.loads(Path(source).read_text(encoding='utf-8'))
    must(type(obj) is dict and obj.get('version')=='R138' and obj.get('mode')=='source', 'SOURCE_VERSION')
    must(obj.get('syntheticOnly') is True and obj.get('release')=='NO_GO' and obj.get('migration')=='HOLD','SOURCE_RELEASE')
    must(obj.get('lifecycleChecks',{}).get('sixWayMove') is True and obj.get('lifecycleChecks',{}).get('sixWayCancel') is True,'SOURCE_LIFECYCLE')
    must(set(obj.get('caseIds',{}))=={'a1','a2','b1'},'SOURCE_CASE_IDS')
    for item in ('a1','a2','b1'):
        must(type(obj['caseIds'][item]) is int and obj['caseIds'][item]>0,'SOURCE_CASE_ID')
    return obj

def probe(cid,source=SOURCE_FILE,output=PROOF_FILE):
    guard(cid,str(source),str(output))
    original=proof_source(source)
    must(scalar(cid,'SELECT current_database();')==DB,'UNEXPECTED_DATABASE')
    must(170000 <= integer(cid,"SELECT current_setting('server_version_num')::int;") < 180000,'PG17_ONLY')
    must(integer(cid,"SELECT count(*) FROM pg_roles WHERE rolname LIKE 'car02_r138_%_ci' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb;")==5,'ROLE_FLAGS')
    must(integer(cid,"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='car02_r138_qa' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity;")==5,'FORCED_RLS')
    must(integer(cid,"SELECT count(*) FROM pg_policies WHERE schemaname='car02_r138_qa' AND cmd='SELECT';")==5,'READ_POLICIES')
    must(integer(cid,"SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='car02_r138_qa' AND p.proname IN ('claim_booking','open_case','case_step','change_booking') AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog']::text[];")==4,'DEFINER_LOCK')
    caseids=original['caseIds']
    checks=[]
    # A role cannot inherit, create roles, bypass RLS, write tables, or claim an
    # unassigned tenant by setting an arbitrary session GUC.
    for key,user in ROLES.items():
        must(scalar(cid,'SELECT session_user||\'|\'||current_user;',key)==user+'|'+user,'SESSION_IDENTITY')
        checks.append('session_identity_'+key)
        for table in TABLES:
            must(scalar(cid,f"SELECT CASE WHEN has_table_privilege(current_user,'car02_r138_qa.{table}','SELECT') AND NOT has_table_privilege(current_user,'car02_r138_qa.{table}','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN 'PASS' ELSE 'FAIL' END;",key)=='PASS','TABLE_PRIVILEGE_'+key+'_'+table)
            checks.append('table_acl_'+key+'_'+table)
        # The set_config expression must actually execute within the same
        # statement; a fake app.role variable must not affect security.
        c=integer(cid,"WITH fake AS MATERIALIZED (SELECT set_config('app.role','OWNER',false) AS forged) SELECT count(*) FROM car02_r138_qa.bookings, fake WHERE fake.forged='OWNER';",key)
        expected_count=EXPECTED[key][0]
        must(c==expected_count,'GUC_IMPERSONATION_'+key)
        checks.append('guc_impersonation_'+key)
        # No persisted edits are allowed even when the operation is targeted at
        # no matching rows: permissions must fail before row evaluation.
        run(cid,'UPDATE car02_r138_qa.bookings SET version=version WHERE false;',key,'permission denied')
        checks.append('direct_update_denied_'+key)
        run(cid,'DELETE FROM car02_r138_qa.audit_events WHERE false;',key,'permission denied')
        checks.append('direct_audit_delete_denied_'+key)
    # RLS predicates hide other customers in the same shop and cross-shop rows.
    for key,foreign_owner in [('a1',ROLES['a2']),('a2',ROLES['a1']),('b1',ROLES['a1'])]:
        must(integer(cid,f"SELECT count(*) FROM car02_r138_qa.bookings WHERE owner_login='{foreign_owner}';",key)==0,'CROSS_OBJECT_'+key)
        must(integer(cid,f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE owner_login='{foreign_owner}';",key)==0,'CROSS_AUDIT_'+key)
        checks.extend(('customer_row_hidden_'+key,'audit_hidden_'+key))
    # Separate shop staff must be blocked from a completed cross-shop case.
    run(cid,f"SELECT car02_r138_qa.case_step('r143_crossshop_bad_001',{caseids['a1']},'COMPLETE',5,NULL,NULL,NULL,NULL);",'bs','R138_CASE_NOT_FOUND')
    checks.append('cross_shop_definer_denied')
    # Same shop different customer cannot decide another customer's case even
    # if the caller supplies a fabricated authority context.
    run(cid,f"SELECT car02_r138_qa.case_step('r143_forgedapproval_001',{caseids['a1']},'DECIDE',3,NULL,NULL,NULL,'APPROVE');",'a2','R138_OWNER_DENIED')
    checks.append('cross_customer_decision_denied')
    # Restrict secret R138 fixture to PG17 QA; can't be a live authentication
    # mechanism. Untrusted roles cannot execute privileged direct SQL.
    for key in ('a1','a2','b1'):
        run(cid,"SELECT car02_r138_qa.claim_booking('r143_customer_forbidden','car02_r138_a_one_ci',DATE '2030-01-01',TIME '09:00');",key,'permission denied')
        checks.append('customer_booking_function_denied_'+key)
    before={k:{t:integer(cid,f'SELECT count(*) FROM car02_r138_qa.{t};',k) for t in TABLES} for k in ROLES}
    # Extra adversarial read-only check: every foreign owner remains invisible
    # after all deliberately rejected operations.
    after={k:{t:integer(cid,f'SELECT count(*) FROM car02_r138_qa.{t};',k) for t in TABLES} for k in ROLES}
    must(before==after,'DENIAL_CHANGED_VISIBLE_DATA')
    # This is not an external witness: digest merely identifies reproducible
    # synthetic evidence and is compared with R139's independent full audit.
    report={'version':'R143_R144','assurance':'EPHEMERAL_PG17_SYNTHETIC_ONLY',
            'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
            'productionTouched':False,'realAuthenticationVerified':False,
            'realRLSVerified':False,'checks':checks,'checkCount':len(checks),
            'visibleCounts':before,'sourceSynthetic':True,
            'sourceCaseIds':caseids}
    report['sha256']=hashlib.sha256(json.dumps(report,sort_keys=True,ensure_ascii=True,separators=(',',':')).encode()).hexdigest()
    proof_path=Path(output)
    proof_path.parent.mkdir(parents=True,exist_ok=True)
    proof_path.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    print('R143_R144_PG17_SYNTHETIC_ACCESS_BOUNDARY_PASS_NO_GO_HOLD')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--cid',required=True)
    parser.add_argument('--source',default=str(SOURCE_FILE))
    parser.add_argument('--out',default=str(PROOF_FILE))
    opts=parser.parse_args()
    probe(opts.cid,opts.source,opts.out)

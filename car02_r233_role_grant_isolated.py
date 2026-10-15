#!/usr/bin/env python3
"""R233: role-membership and GRANT OPTION tampering must fail on throwaway PG17.

The five identities/DB/schema are disposable R138B CI fixtures. No production
network, credentials, authentication, billing or API changes are performed.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, subprocess
from pathlib import Path
from car02_r138_pg17_lifecycle_qa import ROLES, PASSWORD, booking, integer
from car02_r159_concurrent_booking_isolated import DB, CID, COMMIT
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import TABLES, snapshot
from car02_r230_ddl_tamper_isolated import protected_catalog, admin_query, TamperError

ACTORS=('as','a1','a2','bs','b1')
OPERATIONS=('grant_staff_role','grant_cross_tenant_role','grant_table_mutate',
            'grant_execute','grant_select_option')
SQL={
 'grant_staff_role':'GRANT car02_r138_a_staff_ci TO car02_r138_a_one_ci;',
 'grant_cross_tenant_role':'GRANT car02_r138_b_staff_ci TO car02_r138_a_one_ci;',
 'grant_table_mutate':'GRANT INSERT, UPDATE ON TABLE car02_r138_qa.bookings TO car02_r138_a_one_ci;',
 'grant_execute':'GRANT EXECUTE ON FUNCTION car02_r138_qa.claim_booking(text,text,date,time) TO car02_r138_a_one_ci;',
 'grant_select_option':'GRANT SELECT ON TABLE car02_r138_qa.audit_events TO car02_r138_a_one_ci WITH GRANT OPTION;',
}
OUT='qa-evidence-r233/r233-role-grant-proof.json'
LOCK={
 'version':'R233','mode':'DISPOSABLE_PG17_ROLE_GRANT_AND_MEMBERSHIP_DENIAL_ONLY',
 'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
 'fixtureDb':DB,'fixtureRoles':5,'syntheticOnly':True,'productionTouched':False,
 'productionAuthorized':False,'productionReady':False,
 'realAuthenticationVerified':False,'realRLSVerified':False,
 'externalWitnessVerified':False,'externalSignatureVerified':False,
 'operationsPerRole':5,'expectedDenials':25,'protectedTables':5,
 'previousR230SourceUnmodified':True,
}
class GrantError(AssertionError):pass
def require(condition,code):
    if not condition:raise GrantError('R233_'+code)
def seal(doc):
    return hashlib.sha256(json.dumps({k:v for k,v in doc.items() if k!='sha256'},
        ensure_ascii=True,allow_nan=False,separators=(',',':'),sort_keys=True).encode('ascii')).hexdigest()
def validate_snap(value):
    require(type(value) is dict and set(value)==set(TABLES),'SNAP_FIELDS')
    require(all(type(v) is str and re.fullmatch(r'[0-9a-f]{32}',v) for v in value.values()),'SNAP_VALUE')
def validate_roles(value):
    require(type(value) is dict and set(value)=={'attributes','memberships','functionExec'},'ROLE_KEYS')
    attrs=value['attributes']
    require(type(attrs) is list and len(attrs)==5,'ROLE_COUNT')
    require([x['name'] for x in attrs]==sorted(ROLES.values()),'ROLE_NAMES')
    for row in attrs:
        require(type(row) is dict and set(row)=={'name','inherit','super','createrole','bypassrls'},'ROLE_ATTR')
        require(row['inherit'] is False and row['super'] is False and row['createrole'] is False
                and row['bypassrls'] is False,'ROLE_ESCALATION')
    require(type(value['memberships']) is int and value['memberships']==0,'ROLE_MEMBERSHIPS')
    expected={'as':True,'a1':False,'a2':False,'bs':True,'b1':False}
    require(type(value['functionExec']) is dict and set(value['functionExec'])==set(ACTORS),'EXEC_KEYS')
    for name in ACTORS:
        require(type(value['functionExec'][name]) is bool and
                value['functionExec'][name] is expected[name],'EXEC_'+name)
    return True

def verify_proof(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','catalogBefore','catalogAfter',
            'rolesBefore','rolesAfter','before','after','rejections','visibleBefore',
            'visibleAfter','sha256'},'PROOF_FIELDS')
    for k,v in LOCK.items():require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']),'COMMIT')
    from car02_r230_ddl_tamper_isolated import catalog_valid
    try:
        catalog_valid(doc['catalogBefore']);catalog_valid(doc['catalogAfter'])
    except TamperError as err:
        raise GrantError('R233_PROTECTED_CATALOG') from err
    require(doc['catalogBefore']==doc['catalogAfter'],'CATALOG_DRIFT')
    validate_roles(doc['rolesBefore']);validate_roles(doc['rolesAfter'])
    require(doc['rolesBefore']==doc['rolesAfter'],'ROLE_DRIFT')
    validate_snap(doc['before']);validate_snap(doc['after'])
    require(doc['before']==doc['after'],'DATA_DRIFT')
    # PostgreSQL can signal an ineffective GRANT with SQLSTATE 01007 (WARNING),
    # not 42501 (ERROR).  The probe accepts 01007 only after independently
    # proving that role membership, ACLs and all five tables were unchanged.
    require(type(doc['rejections']) is list and len(doc['rejections'])==25,'DENIAL_COUNT')
    for entry,(actor,operation) in zip(doc['rejections'],
                                       ((a,op) for a in ACTORS for op in OPERATIONS)):
        allowed={'42501','01007'} if operation in (
            'grant_table_mutate','grant_execute','grant_select_option') else {'42501'}
        require(type(entry) is dict and set(entry)=={'actor','operation','sqlstate'}
            and entry['actor']==actor and entry['operation']==operation
            and type(entry['sqlstate']) is str and entry['sqlstate'] in allowed,
            'DENIAL_MATRIX')
    for name in ('visibleBefore','visibleAfter'):
        require(type(doc[name]) is dict and set(doc[name])==set(ACTORS),'VISIBLE_KEYS')
        require(all(type(v) is int and v>=0 for v in doc[name].values()),'VISIBLE_TYPES')
        require(doc[name]=={'as':1,'a1':1,'a2':0,'bs':1,'b1':1},'VISIBLE_BOUNDARY')
    require(doc['visibleBefore']==doc['visibleAfter'],'VISIBLE_DRIFT')
    require(type(doc['sha256']) is str and re.fullmatch(r'[a-f0-9]{64}',doc['sha256'])
            and doc['sha256']==seal(doc),'DIGEST')
    return True

def role_catalog(cid):
    roles=json.loads(admin_query(cid,"SELECT coalesce(json_agg(json_build_object('name',rolname,"
        "'inherit',rolinherit,'super',rolsuper,'createrole',rolcreaterole,'bypassrls',rolbypassrls)"
        " ORDER BY rolname)::text,'[]') FROM pg_roles WHERE rolname LIKE 'car02_r138_%_ci';"))
    memberships=int(admin_query(cid,"SELECT count(*) FROM pg_auth_members m "
        "JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles member ON member.oid=m.member "
        "WHERE r.rolname LIKE 'car02_r138_%_ci' OR member.rolname LIKE 'car02_r138_%_ci';"))
    results={}
    for actor in ACTORS:
        expected=ROLES[actor]
        results[actor]=(admin_query(cid,"SELECT has_function_privilege('"+expected+
            "','car02_r138_qa.claim_booking(text,text,date,time)','EXECUTE');")== 't')
    doc=dict(attributes=roles,memberships=memberships,functionExec=results)
    validate_roles(doc)
    return doc

def reject_grant(cid,actor,operation,baseline_catalog=None,baseline_roles=None,baseline_data=None):
    require(type(cid) is str and CID.fullmatch(cid) is not None and actor in ACTORS,'ACTOR')
    require(operation in OPERATIONS,'OPERATION')
    p=subprocess.run(['docker','exec','-i',cid,'env','PGPASSWORD='+PASSWORD,'psql',
        '-h','127.0.0.1','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',
        '-U',ROLES[actor],'-d',DB,'-c',SQL[operation]],capture_output=True,text=True,timeout=25)
    stderr=p.stderr if type(p.stderr) is str else ''
    if p.returncode!=0 and re.search(r'(?m)^ERROR:\s+42501:',stderr):
        return {'actor':actor,'operation':operation,'sqlstate':'42501'}
    # An ineffective GRANT may end with status 0 and WARNING 01007.
    # Never treat an ordinary successful GRANT, another warning, or another
    # SQLSTATE as a rejection.  Only object GRANTs have this alternate path.
    allowed_warning=operation in ('grant_table_mutate','grant_execute','grant_select_option')
    no_grant_warning=(p.returncode==0 and allowed_warning
        and re.search(r'(?m)^WARNING:\s+01007:\s+no privileges were granted for\s+',stderr)
        and re.search(r'(?m)^ERROR:',stderr) is None)
    require(bool(no_grant_warning),'EXPECTED_42501_OR_01007_'+actor+'_'+operation)
    # Status 0 is accepted ONLY after independent, immediate non-mutation checks.
    require(baseline_catalog is not None and baseline_roles is not None
        and baseline_data is not None,'WARNING_BASELINE_MISSING')
    require(protected_catalog(cid)==baseline_catalog,'WARNING_ACL_MUTATED')
    require(role_catalog(cid)==baseline_roles,'WARNING_ROLE_MUTATED')
    require(snapshot(cid)==baseline_data,'WARNING_DATA_MUTATED')
    return {'actor':actor,'operation':operation,'sqlstate':'01007'}

def save(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
            and not path.exists() and not path.is_symlink(),'OUTPUT_SCOPE')
    verify_proof(doc)
    with path.open('x',encoding='ascii') as f:
        json.dump(doc,f,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False);f.write('\n')
    restored=json.loads(path.read_text(encoding='ascii'))
    require(restored==doc and verify_proof(restored),'OUTPUT_ROUNDTRIP')
    return path

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None and
        type(commit) is str and COMMIT.fullmatch(commit) is not None,'ARGS')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit and
        os.environ.get('CAR02_RELEASE_LOCK')=='true' and os.environ.get('R233_DISPOSABLE_QA')=='yes','ENV_LOCK')
    target=Path(out)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'OUT')
    require(snapshot(cid)==dict.fromkeys(TABLES,hashlib.md5(b'[]').hexdigest()),'FIXTURE_NONEMPTY')
    day=next_business_days(1)[0]
    require(booking(cid,DB,'as','r233_seed_a_book',ROLES['a1'],day,'10:00')=='CREATED','SEED_A')
    require(booking(cid,DB,'bs','r233_seed_b_book',ROLES['b1'],day,'11:00')=='CREATED','SEED_B')
    before=snapshot(cid)
    visible=lambda:{a:integer(cid,DB,a,'SELECT count(*) FROM car02_r138_qa.bookings;') for a in ACTORS}
    visible_before=visible();roles_before=role_catalog(cid);catalog_before=protected_catalog(cid)
    denied=[reject_grant(cid,a,op,catalog_before,roles_before,before)
            for a in ACTORS for op in OPERATIONS]
    roles_after=role_catalog(cid);catalog_after=protected_catalog(cid)
    after=snapshot(cid);visible_after=visible()
    doc=dict(LOCK,githubCommit=commit,catalogBefore=catalog_before,catalogAfter=catalog_after,
        rolesBefore=roles_before,rolesAfter=roles_after,before=before,after=after,
        rejections=denied,visibleBefore=visible_before,visibleAfter=visible_after)
    doc['sha256']=seal(doc);save(doc,target)
    print('R233_DISPOSABLE_PG17_TWENTY_FIVE_ROLE_GRANT_DENIALS_AND_DATA_IMMUTABILITY_PASS_NO_GO_HOLD')
    return doc

def main():
    a=argparse.ArgumentParser();a.add_argument('--cid',required=True)
    a.add_argument('--commit',required=True);a.add_argument('--out',default=OUT)
    v=a.parse_args();probe(v.cid,v.commit,v.out)
if __name__=='__main__':main()

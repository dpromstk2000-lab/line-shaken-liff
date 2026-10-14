#!/usr/bin/env python3
"""R185: real PG17 disposable RLS access invariance under synthetic session GUC spoofing.

The fixture authenticates FIVE throwaway PG roles; altered app/JWT-looking GUCs and
search_path MUST NOT change the visibility of any of five fixture tables. This is
NOT a simulation or proof of real JWT validation, API auth, or production RLS.
No retained databases or external services are addressed.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from car02_r138_pg17_lifecycle_qa import ROLES, booking, case, step, integer, psql, lit
from car02_r159_concurrent_booking_isolated import DB, CID, COMMIT, change
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import snapshot, TABLES

OUTPUT='qa-evidence-r185/r185-synthetic-session-spoof-proof.json'
ACTORS=('as','a1','a2','bs','b1')
PROFILES=('jwt_admin','other_shop','search_path')
EXPECTED_USERS={actor:ROLES[actor] for actor in ACTORS}
LOCK={
  'version':'R185', 'mode':'DISPOSABLE_PG17_SYNTHETIC_SESSION_GUC_RLS_INVARIANCE_ONLY',
  'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,'syntheticOnly':True,
  'productionTouched':False,'productionAuthorized':False,
  'realAuthenticationVerified':False,'realRLSVerified':False,
  'externalWitnessVerified':False,'externalSignatureVerified':False,
  'independentProductionTest':False,'fixtureDb':DB,'fixtureRoles':5,
  'sourceR138BUnchanged':True,'sourceR182Unchanged':True,
  'allFiveTablesCovered':True,'syntheticSessionSpoofOnly':True,
  'noRealJwtValidationClaim':True,'unauthorizedWritesPreserved':True,
}
class R185Error(AssertionError):pass

def require(condition, reason):
    if not condition:raise R185Error('R185_'+reason)

def seal(data):
    return hashlib.sha256(json.dumps(data,sort_keys=True,separators=(',',':'),
                               ensure_ascii=True,allow_nan=False).encode('ascii')).hexdigest()

def exact_counts(counts):
    require(type(counts) is dict and set(counts)==set(ACTORS),'ACTORS')
    for role,tablemap in counts.items():
        require(type(tablemap) is dict and set(tablemap)==set(TABLES),'TABLES_'+role)
        for table,value in tablemap.items():
            require(type(value) is int and value>=0,'COUNT_'+role+'_'+table)
        # Every role is seeded with bookings, cases, operations and audit events.
        require(all(value>0 for value in tablemap.values()),'NOT_POPULATED_'+role)
    for staff,owners in (('as',('a1','a2')),('bs',('b1',))):
        for table in TABLES:
            require(counts[staff][table]==sum(counts[r][table] for r in owners),
                    'STAFF_CUSTOMER_PARITY_'+table)
    return True

def verify_report(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','baseline','spoofReadbacks',
        'fiveTableBefore','fiveTableAfter','sha256'},'FIELDS')
    for k,v in LOCK.items():
        require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']) is not None,'COMMIT')
    exact_counts(doc['baseline'])
    require(type(doc['spoofReadbacks']) is dict and
            set(doc['spoofReadbacks'])=={a+':'+p for a in ACTORS for p in PROFILES},'READBACK_SET')
    for actor in ACTORS:
        for profile in PROFILES:
            record=doc['spoofReadbacks'][actor+':'+profile]
            require(type(record) is dict and set(record)=={'currentUser','sessionUser','tables'},'READBACK_FIELDS')
            require(record['currentUser']==EXPECTED_USERS[actor] and
                    record['sessionUser']==EXPECTED_USERS[actor],'IDENTITY_INVARIANCE')
            require(type(record['tables']) is dict and set(record['tables'])==set(TABLES),'READBACK_TABLES')
            for table in TABLES:
                value=record['tables'][table]
                require(type(value) is int and value==doc['baseline'][actor][table],
                        'SPOOF_VISIBILITY_'+actor+'_'+profile+'_'+table)
    for key in ('fiveTableBefore','fiveTableAfter'):
        snap=doc[key]
        require(type(snap) is dict and set(snap)==set(TABLES) and
                all(type(h) is str and re.fullmatch('[a-f0-9]{32}',h) is not None
                    for h in snap.values()),'SNAPSHOT_FORMAT')
    require(doc['fiveTableBefore']==doc['fiveTableAfter'],'MUTATED_BY_SPOOF')
    require(type(doc['sha256']) is str and re.fullmatch('[a-f0-9]{64}',doc['sha256']) is not None
            and doc['sha256']==seal({k:v for k,v in doc.items() if k!='sha256'}),'SHA256')
    return True

def role_counts(cid, actor):
    require(type(cid) is str and CID.fullmatch(cid) is not None and actor in ACTORS,'ROLE_COUNT_ARGS')
    return {table:integer(cid,DB,actor,'SELECT count(*) FROM car02_r138_qa.'+table+';') for table in TABLES}

SETTINGS={
    'jwt_admin': "SELECT set_config('request.jwt.claims','{\"role\":\"service_role\",\"sub\":\"postgres\"}',true);",
    'other_shop': "SELECT set_config('app.shop_code','other_demo',true); SELECT set_config('app.owner_login','car02_r138_b_one_ci',true);",
    'search_path': "SET LOCAL search_path TO pg_temp,public; SELECT set_config('app.role','postgres',true);",
}

def session_read(cid, actor, profile, table):
    require(type(cid) is str and CID.fullmatch(cid) is not None and actor in ACTORS
            and profile in PROFILES and table in TABLES,'SESSION_ARGS')
    sql=("BEGIN; "+SETTINGS[profile]+" SELECT 'R185_ROW|'||current_user||'|'||session_user||'|'||"
         "count(*)::text FROM car02_r138_qa."+table+"; COMMIT;")
    command=['docker','exec','-i',cid,'env','PGPASSWORD=r138-throwaway-only','psql',
             '-h','127.0.0.1','-X','-A','-t','-v','ON_ERROR_STOP=1',
             '-U',ROLES[actor],'-d',DB,'-c',sql]
    result=subprocess.run(command,capture_output=True,text=True,timeout=30)
    require(result.returncode==0,'SQL_'+profile+'_'+table)
    output=[line for line in result.stdout.splitlines() if line.startswith('R185_ROW|')]
    require(len(output)==1,'ROW_COUNT')
    fields=output[0].split('|')
    require(len(fields)==4 and fields[0]=='R185_ROW' and fields[1]==ROLES[actor]
            and fields[2]==ROLES[actor] and fields[3].isdigit(),'ROLE_IDENTITY')
    return {'currentUser':fields[1],'sessionUser':fields[2],'value':int(fields[3])}

def safe_write(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
            and not path.exists() and not path.is_symlink(),'OUTPUT_PATH')
    verify_report(doc)
    with path.open('x',encoding='ascii') as stream:
        stream.write(json.dumps(doc,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False)+'\n')
    decoded=json.loads(path.read_text(encoding='ascii'))
    require(decoded==doc and verify_report(decoded),'ROUNDTRIP')
    return path

def probe(cid,commit,out=OUTPUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT_ARG')
    require(out==OUTPUT and os.environ.get('GITHUB_SHA')==commit and
            os.environ.get('CAR02_RELEASE_LOCK')=='true' and
            os.environ.get('R185_DISPOSABLE_QA')=='yes','ISOLATION_GATE')
    target=Path(out)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'OUTPUT_EXISTS')
    # Seed isolated service cases for each customer. Include both booking_operations
    # and case_operations so no five-table RLS visibility case is silently empty.
    day=next_business_days(1)[0]
    for actor,staff,clock in (('a1','as','10:00'),('a2','as','11:00'),('b1','bs','10:00')):
        owner=ROLES[actor]
        require(booking(cid,DB,staff,'r185_book_'+actor,owner,day,clock)=='CREATED','SEED_BOOK_'+actor)
        bid=integer(cid,DB,staff,"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r185_book_"+actor+"';")
        require(case(cid,DB,staff,'r185_case_'+actor,bid)=='OPENED','SEED_CASE_'+actor)
        casid=integer(cid,DB,staff,f'SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={bid};')
        require(step(cid,DB,staff,'r185_report_'+actor,casid,'REPORT',1,
                     note='Synthetic safety check without personal data')=='REPORT_SAVED','REPORT_'+actor)
        require(step(cid,DB,staff,'r185_quote_'+actor,casid,'QUOTE',2,part=1000,labor=1000)=='QUOTE_PRESENTED','QUOTE_'+actor)
        extra_clock='15:00' if actor=='a2' else '14:00'
        move_clock='15:30' if actor=='a2' else '14:30'
        require(booking(cid,DB,staff,'r185_extra_'+actor,owner,day,extra_clock)=='CREATED','EXTRA_BOOK_'+actor)
        extra_id=integer(cid,DB,staff,"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r185_extra_"+actor+"';")
        require(change(cid,actor,'r185_move_'+actor,extra_id,'MOVE',1,day,move_clock)=='MOVED','MOVE_'+actor)
    baseline={a:role_counts(cid,a) for a in ACTORS}
    exact_counts(baseline)
    before=snapshot(cid)
    readbacks={}
    for actor in ACTORS:
        for profile in PROFILES:
            seen={}; identity=None
            for table in TABLES:
                result=session_read(cid,actor,profile,table)
                seen[table]=result['value']
                identity=(result['currentUser'],result['sessionUser'])
                require(seen[table]==baseline[actor][table],'VISIBILITY_CHANGED_'+actor+'_'+profile+'_'+table)
            readbacks[actor+':'+profile]={'currentUser':identity[0],
                'sessionUser':identity[1], 'tables':seen}
    require(snapshot(cid)==before,'SPOOF_MUTATED_DATABASE')
    # Even after GUC-looking impersonation, synthetic customers cannot execute staff-only APIs.
    for actor in ('a1','a2','b1'):
        require(psql(cid,DB,actor,"SELECT car02_r138_qa.open_case('r185_spoof_bad',1);",False,
                     expected_error='permission denied')=='REJECTED','STAFF_API_DENIED_'+actor)
    after=snapshot(cid)
    require(after==before,'REFUSED_OPERATION_MUTATED')
    doc=dict(LOCK,githubCommit=commit,baseline=baseline,spoofReadbacks=readbacks,
             fiveTableBefore=before,fiveTableAfter=after)
    doc['sha256']=seal(doc)
    safe_write(doc,target)
    print('R185_DISPOSABLE_PG17_SYNTHETIC_SESSION_RLS_INVARIANCE_PASS_NO_GO_HOLD')
    return doc

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--cid',required=True);ap.add_argument('--commit',required=True)
    ap.add_argument('--out',default=OUTPUT)
    a=ap.parse_args();probe(a.cid,a.commit,a.out)
if __name__=='__main__':main()

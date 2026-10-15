#!/usr/bin/env python3
"""R237: exact synthetic row identities across five RLS tables on disposable PG17 only.

The PostgreSQL superuser is used solely as an oracle on the throwaway CI
container. This does NOT test production JWT/authentication or retained DBs.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re
from pathlib import Path
from car02_r138_pg17_lifecycle_qa import ROLES, booking, case, step, integer, psql
from car02_r159_concurrent_booking_isolated import CID, COMMIT, DB, change
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import TABLES, snapshot
from car02_r230_ddl_tamper_isolated import admin_query

ACTORS=('as','a1','a2','bs','b1')
PROFILES=('baseline','spoof_claims_path')
OUTPUT='qa-evidence-r237/r237-exact-row-rls-proof.json'
OWNER_SHOPS={'a1':'street_house_demo','a2':'street_house_demo','b1':'other_demo'}
LOCK=dict(version='R237',mode='DISPOSABLE_PG17_EXACT_ROW_VISIBILITY_ONLY',release='NO_GO',
          migration='HOLD',realWorldGatesOpen=12,syntheticOnly=True,
          fixtureDb=DB,fixtureRoles=5,protectedTables=5,productionTouched=False,
          productionAuthorized=False,productionReady=False,realAuthenticationVerified=False,
          realRLSVerified=False,externalWitnessVerified=False,externalSignatureVerified=False,
          sourceR138BUnchanged=True,sourceR236Unchanged=True,
          ownerScopedRowsNotJustCounts=True,spoofedSessionDoesNotExpandRows=True)

class R237Error(AssertionError): pass

def require(ok,code):
    if not ok: raise R237Error('R237_'+code)

def seal(doc):
    return hashlib.sha256(json.dumps({k:v for k,v in doc.items() if k!='sha256'},
        sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('ascii')).hexdigest()

def row_valid(rows):
    require(type(rows) is list,'ROWS_TYPE')
    for x in rows:
        require(type(x) is dict and set(x)=={'id','shop','owner'} and
                type(x['id']) is int and x['id']>0 and
                type(x['shop']) is str and x['shop'] in {'street_house_demo','other_demo'} and
                type(x['owner']) is str and x['owner'] in (ROLES['a1'],ROLES['a2'],ROLES['b1']),
                'ROW_FORMAT')
        require((x['shop']=='street_house_demo')==(x['owner'] in (ROLES['a1'],ROLES['a2'])),
                'ROW_TENANT')
    require([x['id'] for x in rows]==sorted(set(x['id'] for x in rows)),'SORTED_UNIQUE_ID')

def relevant(rows,actor):
    if actor=='as': return [x for x in rows if x['shop']=='street_house_demo']
    if actor=='bs': return [x for x in rows if x['shop']=='other_demo']
    return [x for x in rows if x['owner']==ROLES[actor]]

def valid_snapshot(s):
    require(type(s) is dict and set(s)==set(TABLES) and all(
        type(v) is str and re.fullmatch(r'[a-f0-9]{32}',v) for v in s.values()),'SNAPSHOT')

def validate(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{
        'githubCommit','oracle','readbacks','snapshotBefore','snapshotAfter','sha256'},'FIELDS')
    for k,v in LOCK.items():
        require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']),'COMMIT')
    require(type(doc['oracle']) is dict and set(doc['oracle'])==set(TABLES),'ORACLE_TABLES')
    require(type(doc['readbacks']) is dict and
            set(doc['readbacks'])=={actor+':'+profile for actor in ACTORS for profile in PROFILES},
            'READBACK_ACTORS')
    for table in TABLES:
        rows=doc['oracle'][table]
        row_valid(rows)
        require(len(rows)>=3 and {x['owner'] for x in rows}=={
                ROLES['a1'],ROLES['a2'],ROLES['b1']},'ORACLE_POPULATED_'+table)
        for actor in ACTORS:
            expected=relevant(rows,actor)
            require(len(expected)>0 and len(expected)<len(rows),'NONTRIVIAL_SCOPE_'+actor+'_'+table)
            for profile in PROFILES:
                result=doc['readbacks'][actor+':'+profile]
                require(type(result) is dict and set(result)==set(TABLES)|{'currentUser','sessionUser'},
                        'READBACK_FIELDS')
                require(result['currentUser']==ROLES[actor] and result['sessionUser']==ROLES[actor],
                        'IDENTITY_'+actor)
                row_valid(result[table])
                require(result[table]==expected,'RLS_SCOPE_'+actor+'_'+table+'_'+profile)
    valid_snapshot(doc['snapshotBefore']);valid_snapshot(doc['snapshotAfter'])
    require(doc['snapshotBefore']==doc['snapshotAfter'],'READ_MUTATION')
    require(type(doc['sha256']) is str and re.fullmatch(r'[a-f0-9]{64}',doc['sha256']) and
            doc['sha256']==seal(doc),'SHA256')
    return True

def query(table):
    require(type(table) is str and table in TABLES,'TABLE_NAME')
    return ("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'shop',shop_code,'owner',owner_login) "
            "ORDER BY id),'[]'::jsonb)::text FROM car02_r138_qa."+table+';')

def read(cid,actor,profile,table):
    require(type(cid) is str and CID.fullmatch(cid) and actor in ACTORS and profile in PROFILES,'READ_ARGS')
    prefix=''
    if profile=='spoof_claims_path':
        prefix=("SET request.jwt.claims TO '{\"role\":\"service_role\",\"sub\":\"fake-admin\"}'; "
                "SET search_path TO pg_temp, public; ")
    sql=query(table).replace('SELECT coalesce',"SELECT 'R237_ROW|' || coalesce",1)
    output=psql(cid,DB,actor,prefix+sql)
    matching=[line[len('R237_ROW|'):] for line in output.splitlines()
              if line.startswith('R237_ROW|')]
    require(len(matching)==1,'ROW_TAG_'+actor+'_'+profile+'_'+table)
    data=json.loads(matching[0]);row_valid(data)
    return data

def oracle(cid,table):
    require(type(cid) is str and CID.fullmatch(cid),'ORACLE_CID')
    data=json.loads(admin_query(cid,query(table)));row_valid(data)
    return data

def save(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink() and
            not path.is_symlink() and not path.exists(),'OUTPUT_SCOPE')
    validate(doc)
    with path.open('x',encoding='ascii') as f:
        json.dump(doc,f,sort_keys=True,ensure_ascii=True,allow_nan=False,indent=2);f.write('\n')
    restored=json.loads(path.read_text(encoding='ascii'))
    require(restored==doc and validate(restored),'ROUNDTRIP')
    return path

def seed(cid):
    day=next_business_days(1)[0]
    for actor,staff,time in [('a1','as','10:00'),('a2','as','11:00'),('b1','bs','10:00')]:
        owner=ROLES[actor]
        key='r237_primary_'+actor
        require(booking(cid,DB,staff,key,owner,day,time)=='CREATED','BOOK_'+actor)
        bid=integer(cid,DB,staff,"SELECT id FROM car02_r138_qa.bookings WHERE request_key='"+key+"';")
        require(case(cid,DB,staff,'r237_case_'+actor,bid)=='OPENED','CASE_'+actor)
        cid_case=integer(cid,DB,staff,f'SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={bid};')
        require(step(cid,DB,staff,'r237_report_'+actor,cid_case,'REPORT',1,
                note='Synthetic audit row ownership evidence')=='REPORT_SAVED','REPORT_'+actor)
        require(step(cid,DB,staff,'r237_quote_'+actor,cid_case,'QUOTE',2,
                part=1200,labor=800)=='QUOTE_PRESENTED','QUOTE_'+actor)
        extra_time={'a1':'13:00','a2':'14:00','b1':'13:00'}[actor]
        move_time={'a1':'13:30','a2':'14:30','b1':'13:30'}[actor]
        extra='r237_extra_'+actor
        require(booking(cid,DB,staff,extra,owner,day,extra_time)=='CREATED','EXTRA_'+actor)
        eid=integer(cid,DB,staff,"SELECT id FROM car02_r138_qa.bookings WHERE request_key='"+extra+"';")
        require(change(cid,actor,'r237_move_'+actor,eid,'MOVE',1,day,move_time)=='MOVED','MOVE_'+actor)

def probe(cid,commit,out=OUTPUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None and
            type(commit) is str and COMMIT.fullmatch(commit) is not None,'PROBE_ARGS')
    require(out==OUTPUT and os.environ.get('GITHUB_SHA')==commit and
            os.environ.get('CAR02_RELEASE_LOCK')=='true' and
            os.environ.get('R237_DISPOSABLE_QA')=='yes','ENV_LOCK')
    target=Path(out)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'OUTPUT')
    require(snapshot(cid)==dict.fromkeys(TABLES,hashlib.md5(b'[]').hexdigest()),'NONEMPTY_FIXTURE')
    seed(cid)
    before=snapshot(cid)
    full={table:oracle(cid,table) for table in TABLES}
    seen={}
    for actor in ACTORS:
        for profile in PROFILES:
            item={'currentUser':ROLES[actor],'sessionUser':ROLES[actor]}
            # Verify real session roles, not just caller-provided labels.
            from car02_r138_pg17_lifecycle_qa import psql as rpsql
            prefix=("SET request.jwt.claims TO '{\"role\":\"service_role\"}'; "
                    "SET search_path TO pg_temp,public; ") if profile!='baseline' else ''
            output=rpsql(cid,DB,actor,prefix+"SELECT 'R237_ID|'||current_user||','||session_user;")
            identity=[line[len('R237_ID|'):].split(',') for line in output.splitlines()
                      if line.startswith('R237_ID|')]
            require(identity==[[ROLES[actor],ROLES[actor]]],'ROLE_IDENTITY')
            for table in TABLES: item[table]=read(cid,actor,profile,table)
            seen[actor+':'+profile]=item
    after=snapshot(cid)
    doc=dict(LOCK,githubCommit=commit,oracle=full,readbacks=seen,
             snapshotBefore=before,snapshotAfter=after)
    doc['sha256']=seal(doc)
    save(doc,target)
    print('R237_DISPOSABLE_PG17_EXACT_FIVE_TABLE_ROW_VISIBILITY_5_ROLES_TWO_PROFILES_NO_GO_HOLD_PASS')
    return doc

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--cid',required=True)
    ap.add_argument('--commit',required=True);ap.add_argument('--out',default=OUTPUT)
    a=ap.parse_args();probe(a.cid,a.commit,a.out)
if __name__=='__main__':main()

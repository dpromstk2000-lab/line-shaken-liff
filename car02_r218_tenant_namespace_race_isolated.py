#!/usr/bin/env python3
"""R218: cross-shop request-key namespace & same-shop owner/slot races.

Disposable R138B PostgreSQL 17 only. These synthetic fixture identities are NOT
real user authentication or production RLS assurance. NO_GO / HOLD / 12 OPEN.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib, json, os, re
from pathlib import Path
from threading import Barrier
from car02_r138_pg17_lifecycle_qa import ROLES, booking, case, integer, psql
from car02_r159_concurrent_booking_isolated import DB, CID, COMMIT
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import TABLES, snapshot
from car02_r185_rls_session_spoof_isolated import role_counts, ACTORS
from car02_r191_transaction_rollback_isolated import sql_book
from car02_r215_first_write_race_isolated import call as guarded_call

OUT='qa-evidence-r218/r218-tenant-namespace-race-proof.json'
STAGES=('cross_shop_booking','same_shop_owner_key','same_shop_slot','cross_shop_case')
SHOPS=('street_house_demo','other_demo')
CLIENTS=8
LOCK={
 'version':'R218','mode':'DISPOSABLE_PG17_TENANT_NAMESPACE_OWNER_SLOT_RACE_ONLY',
 'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
 'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
 'realAuthenticationVerified':False,'realRLSVerified':False,
 'externalWitnessVerified':False,'externalSignatureVerified':False,
 'productionReady':False,'fixtureDb':DB,'fixtureRoles':5,
 'fiveTablesCovered':True,'separateShopNamespacesVerified':True,
 'sameShopOwnershipBoundaryVerified':True,'uniqueActiveSlotVerified':True,
 'originalR138BUnchanged':True,'priorR215Unchanged':True,
}
class NamespaceError(AssertionError): pass

def require(ok,tag):
    if not ok:raise NamespaceError('R218_'+tag)

def seal(obj):
    return hashlib.sha256(json.dumps({k:v for k,v in obj.items() if k!='sha256'},
        ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode('ascii')).hexdigest()

def snap_valid(s):
    require(type(s) is dict and set(s)==set(TABLES),'SNAP_TABLES')
    require(all(type(v) is str and re.fullmatch('[a-f0-9]{32}',v) for v in s.values()),'SNAP_DIGEST')

def expected_visibility(owner_variant,slot_variant):
    require(owner_variant in 'AB' and slot_variant in 'AB','WINNER_VARIANT')
    return {'as':3,'a1':1+int(owner_variant=='A')+int(slot_variant=='A'),
            'a2':int(owner_variant=='B')+int(slot_variant=='B'),
            'bs':1,'b1':1}

def valid_report(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','stages','visibility','finalSnapshot','sha256'},'FIELDS')
    for k,v in LOCK.items():require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']),'COMMIT')
    data=doc['stages']
    require(type(data) is dict and set(data)==set(STAGES),'STAGES')
    last=None
    for name in STAGES:
        entry=data[name]
        require(type(entry) is dict and set(entry)=={'before','after','results','stats'},'STAGE_FIELDS_'+name)
        snap_valid(entry['before']);snap_valid(entry['after'])
        require(entry['before']!=entry['after'],'STAGE_UNCHANGED_'+name)
        if last is not None:require(entry['before']==last,'STAGE_CHAIN_'+name)
        last=entry['after']
        results=entry['results']; stats=entry['stats']
        require(type(results) is list and type(stats) is dict,'RESULT_TYPES_'+name)
        if name in ('cross_shop_booking','cross_shop_case'):
            require(len(results)==2 and results==['CREATED','CREATED'] if name=='cross_shop_booking'
                    else len(results)==2 and results==['OPENED','OPENED'],'CROSS_SHOP_SUCCESS_'+name)
            require(set(stats)=={'shopRows','shopAudits'},'CROSS_STATS_'+name)
            for metric in ('shopRows','shopAudits'):
                require(type(stats[metric]) is dict and set(stats[metric])==set(SHOPS)
                        and all(type(v) is int and v==1 for v in stats[metric].values()),'SHOP_COUNTS_'+name)
        elif name=='same_shop_owner_key':
            require(len(results)==CLIENTS and set(stats)=={'winner','requestRows','auditRows'},'OWNER_SHAPE')
            winner=stats['winner']
            require(type(winner) is str and winner in ('A','B'),'OWNER_WINNER')
            require(type(stats['requestRows']) is int and stats['requestRows']==1,'OWNER_ROWS')
            require(type(stats['auditRows']) is int and stats['auditRows']==1,'OWNER_AUDITS')
            require([(type(x) is dict and set(x)=={'variant','result'} and
                     x['variant']==('A' if i%2==0 else 'B') and type(x['result']) is str) for i,x in enumerate(results)]==[True]*CLIENTS,'OWNER_RESULTS_SHAPE')
            values=[x['result'] for x in results]
            require(values.count('CREATED')==1 and values.count('IDEMPOTENT')==3 and
                    values.count('22023:R138_BOOKING_REPLAY_CONFLICT')==4,'OWNER_DISTRIBUTION')
            require(all(x['result'] in ('CREATED','IDEMPOTENT') if x['variant']==winner
                        else x['result']=='22023:R138_BOOKING_REPLAY_CONFLICT' for x in results),'OWNER_ISOLATION')
        else:
            require(len(results)==CLIENTS and set(stats)=={'winner','activeRows','auditRows'},'SLOT_SHAPE')
            winner=stats['winner']
            require(type(winner) is str and winner in ('A','B'),'SLOT_WINNER')
            require(type(stats['activeRows']) is int and stats['activeRows']==1,'SLOT_ROWS')
            require(type(stats['auditRows']) is int and stats['auditRows']==1,'SLOT_AUDIT')
            require([(type(x) is dict and set(x)=={'variant','result'} and
                     x['variant']==('A' if i%2==0 else 'B') and type(x['result']) is str) for i,x in enumerate(results)]==[True]*CLIENTS,'SLOT_RESULTS_SHAPE')
            values=[x['result'] for x in results]
            require(values.count('CREATED')==1 and values.count('IDEMPOTENT')==3 and
                    values.count('SLOT_TAKEN')==4,'SLOT_DISTRIBUTION')
            require(all(x['result'] in ('CREATED','IDEMPOTENT') if x['variant']==winner
                        else x['result']=='SLOT_TAKEN' for x in results),'SLOT_ISOLATION')
    vis=doc['visibility']
    require(type(vis) is dict and set(vis)==set(ACTORS),'VIS_ACTORS')
    expected=expected_visibility(data['same_shop_owner_key']['stats']['winner'],data['same_shop_slot']['stats']['winner'])
    for actor in ACTORS:
        x=vis[actor]
        require(type(x) is dict and set(x)==set(TABLES),'VIS_TABLES')
        require(all(type(v) is int and v>=0 for v in x.values()),'VIS_COUNTS')
        require(x['bookings']==expected[actor],'VIS_BOOKINGS_'+actor)
        require(x['service_cases']==1 if actor in ('as','a1','bs','b1') else x['service_cases']==0,'VIS_CASES_'+actor)
        require(x['case_operations']==0 and x['booking_operations']==0,'VIS_OPERATIONS_'+actor)
        require(x['audit_events']==x['bookings']+x['service_cases'],'VIS_AUDIT_'+actor)
    snap_valid(doc['finalSnapshot'])
    require(doc['finalSnapshot']==data[STAGES[-1]]['after'],'FINAL_DIGEST')
    require(type(doc['sha256']) is str and re.fullmatch('[a-f0-9]{64}',doc['sha256']) and doc['sha256']==seal(doc),'HASH')
    return True

def parallel(fn,n):
    require(type(n) is int and 1<n<=CLIENTS and callable(fn),'PARALLEL_ARGS')
    gate=Barrier(n)
    def worker(i):
        gate.wait(timeout=15)
        return fn(i)
    with ThreadPoolExecutor(max_workers=n) as ex:
        futures=[ex.submit(worker,i) for i in range(n)]
        return [f.result(timeout=50) for f in futures]

def winner(results):
    indexes=[i for i,x in enumerate(results) if x['result']=='CREATED']
    require(len(indexes)==1,'WINNER_COUNT')
    return 'A' if indexes[0]%2==0 else 'B'

def counted(cid,staff,table,key):
    require(staff in ('as','bs') and table in ('bookings','service_cases'),'COUNT_SCOPE')
    require(re.fullmatch(r'[a-z0-9_]{12,64}',key) is not None,'COUNT_KEY')
    return integer(cid,DB,staff,f"SELECT count(*) FROM car02_r138_qa.{table} WHERE request_key='{key}';")

def audit(cid,staff,table,key,action):
    require(staff in ('as','bs') and table in ('bookings','service_cases') and action in ('BOOKED','CASE_OPENED'),'AUDIT_SCOPE')
    require(re.fullmatch(r'[a-z0-9_]{12,64}',key) is not None,'AUDIT_KEY')
    return integer(cid,DB,staff,f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE action='{action}' AND entity_id IN (SELECT id FROM car02_r138_qa.{table} WHERE request_key='{key}');")

def save(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
            and not path.exists() and not path.is_symlink(),'OUTPUT_PATH')
    valid_report(doc)
    with path.open('x',encoding='ascii') as f:
        json.dump(doc,f,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False);f.write('\n')
    reread=json.loads(path.read_text(encoding='ascii'))
    require(reread==doc and valid_report(reread),'ROUNDTRIP')
    return path

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT_ARG')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit and
            os.environ.get('CAR02_RELEASE_LOCK')=='true' and
            os.environ.get('R218_DISPOSABLE_QA')=='yes','LOCK_ENV')
    path=Path(out)
    require(path.parent.is_dir() and not path.parent.is_symlink() and not path.exists(),'OUTPUT')
    require(snapshot(cid)==dict.fromkeys(TABLES,hashlib.md5(b'[]').hexdigest()),'FIXTURE_NOT_EMPTY')
    day=next_business_days(1)[0]
    key='r218_cross_shop_key'
    a1=ROLES['a1']; a2=ROLES['a2']; b1=ROLES['b1']
    stage={}
    before=snapshot(cid)
    outcomes=parallel(lambda i:booking(cid,DB,'as' if i==0 else 'bs',key,a1 if i==0 else b1,day,'10:00'),2)
    require(outcomes==['CREATED','CREATED'],'CROSS_BOOK')
    stage['cross_shop_booking']=dict(before=before,after=snapshot(cid),results=outcomes,
        stats=dict(shopRows={SHOPS[0]:counted(cid,'as','bookings',key),SHOPS[1]:counted(cid,'bs','bookings',key)},
                   shopAudits={SHOPS[0]:audit(cid,'as','bookings',key,'BOOKED'),SHOPS[1]:audit(cid,'bs','bookings',key,'BOOKED')}))
    ownkey='r218_same_shop_owner_key'
    before=snapshot(cid)
    outcomes=parallel(lambda i:{'variant':'A' if i%2==0 else 'B','result':guarded_call(cid,'as',
             sql_book(ownkey,a1 if i%2==0 else a2,day,'11:00' if i%2==0 else '11:30'),'booking')},CLIENTS)
    owner_win=winner(outcomes)
    stage['same_shop_owner_key']=dict(before=before,after=snapshot(cid),results=outcomes,
        stats=dict(winner=owner_win,requestRows=counted(cid,'as','bookings',ownkey),
                   auditRows=audit(cid,'as','bookings',ownkey,'BOOKED')))
    slotkey_a='r218_same_slot_key_a';slotkey_b='r218_same_slot_key_b'
    before=snapshot(cid)
    outcomes=parallel(lambda i:{'variant':'A' if i%2==0 else 'B',
          'result':booking(cid,DB,'as',slotkey_a if i%2==0 else slotkey_b,
                           a1 if i%2==0 else a2,day,'12:00')},CLIENTS)
    slot_win=winner(outcomes)
    stage['same_shop_slot']=dict(before=before,after=snapshot(cid),results=outcomes,
        stats=dict(winner=slot_win,
                   activeRows=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.bookings WHERE booking_day='{day}' AND begins_at='12:00' AND state='ACTIVE';"),
                   auditRows=audit(cid,'as','bookings',slotkey_a if slot_win=='A' else slotkey_b,'BOOKED')))
    before=snapshot(cid)
    bids={staff:integer(cid,DB,staff,f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='{key}';")
          for staff in ('as','bs')}
    case_key='r218_cross_shop_case_key'
    outcomes=parallel(lambda i:case(cid,DB,'as' if i==0 else 'bs',case_key,
                                   bids['as'] if i==0 else bids['bs']),2)
    require(outcomes==['OPENED','OPENED'],'CROSS_CASE')
    stage['cross_shop_case']=dict(before=before,after=snapshot(cid),results=outcomes,
        stats=dict(shopRows={SHOPS[0]:counted(cid,'as','service_cases',case_key),SHOPS[1]:counted(cid,'bs','service_cases',case_key)},
                   shopAudits={SHOPS[0]:audit(cid,'as','service_cases',case_key,'CASE_OPENED'),SHOPS[1]:audit(cid,'bs','service_cases',case_key,'CASE_OPENED')}))
    visibility={actor:role_counts(cid,actor) for actor in ACTORS}
    report=dict(LOCK,githubCommit=commit,stages=stage,visibility=visibility,finalSnapshot=snapshot(cid))
    report['sha256']=seal(report)
    save(report,path)
    print('R218_DISPOSABLE_PG17_TENANT_NAMESPACE_OWNER_SLOT_RACES_PASS_NO_GO_HOLD')
    return report

def main():
    p=argparse.ArgumentParser();p.add_argument('--cid',required=True)
    p.add_argument('--commit',required=True);p.add_argument('--out',default=OUT)
    x=p.parse_args();probe(x.cid,x.commit,x.out)
if __name__=='__main__':main()

#!/usr/bin/env python3
"""R135 disposable PostgreSQL 17 integration assertions; never connects to a user database."""
import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from zoneinfo import ZoneInfo

DBS = {'source': 'car02_r135_qa_ci', 'restore': 'car02_r135_restore_ci'}
ROLES = {'a': 'car02_r135_a_ci', 'b': 'car02_r135_b_ci'}
PG_PASS = 'r135-only-in-disposable-container'  # CI-only, not a production secret
PREFIX = 'R135_' 


def require(check, reason):
    if not check:
        raise AssertionError(PREFIX + reason)


def as_day():
    day = dt.datetime.now(ZoneInfo('Asia/Tokyo')).date() + dt.timedelta(days=5)
    while day.isoweekday() == 7:
        day += dt.timedelta(days=1)
    return day.isoformat()


def sql_quote(value):
    require(re.fullmatch(r'[A-Za-z0-9_:\-]+', value) is not None, 'UNSAFE_FIXTURE')
    return "'" + value + "'"


def psql(cid, db, who, sql, ok=True):
    require(bool(re.fullmatch(r'[a-f0-9]{12,64}', cid)), 'INVALID_SERVICE_CONTAINER')
    require(db in DBS.values(), 'UNAPPROVED_DATABASE')
    require(who in ROLES, 'UNAPPROVED_LOGIN')
    command = ['docker', 'exec', '-i', cid, 'env', 'PGPASSWORD=' + PG_PASS,
               'psql', '-h', '127.0.0.1', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
               '-U', ROLES[who], '-d', db, '-c', sql]
    result = subprocess.run(command, text=True, capture_output=True, timeout=25)
    if ok:
        require(result.returncode == 0, 'SQL_' + result.stderr[-500:])
        return result.stdout.strip()
    require(result.returncode != 0, 'EXPECTED_REJECTION')
    return 'REJECTED'


def claim(cid, db, who, key, day, clock='10:00', service='INSPECTION', ok=True):
    return psql(cid, db, who, 'SELECT car02_r135_qa.claim_slot(' +
                ','.join([sql_quote(key), sql_quote(day) + '::date',
                          sql_quote(clock) + '::time', sql_quote(service)]) + ');', ok)


def cancel(cid, db, who, key):
    return psql(cid, db, who, f'SELECT car02_r135_qa.cancel_slot({sql_quote(key)});')


def parallel(fn, n=6):
    with concurrent.futures.ThreadPoolExecutor(max_workers=n) as ex:
        futures = [ex.submit(fn, i) for i in range(n)]
        return [f.result(timeout=35) for f in futures]


def snapshot(cid, db):
    def value(who, table, column='count(*)'):
        return psql(cid, db, who, f'SELECT {column} FROM car02_r135_qa.{table};')
    a_book = int(value('a', 'bookings'))
    b_book = int(value('b', 'bookings'))
    a_audit = int(value('a', 'audit_events'))
    b_audit = int(value('b', 'audit_events'))
    rows = psql(cid, db, 'a', "SELECT string_agg(request_key||':'||state,',' ORDER BY request_key) FROM car02_r135_qa.bookings;")
    brows = psql(cid, db, 'b', "SELECT string_agg(request_key||':'||state,',' ORDER BY request_key) FROM car02_r135_qa.bookings;")
    audit_a = psql(cid, db, 'a', "SELECT string_agg(action||':'||booking_id::text,',' ORDER BY id) FROM car02_r135_qa.audit_events;")
    audit_b = psql(cid, db, 'b', "SELECT string_agg(action||':'||booking_id::text,',' ORDER BY id) FROM car02_r135_qa.audit_events;")
    raw=json.dumps({'rowsA': rows,'rowsB': brows,'auditA':audit_a,'auditB':audit_b},sort_keys=True)
    digest=hashlib.sha256(raw.encode()).hexdigest()
    return {'rowsA': a_book, 'rowsB': b_book, 'auditA': a_audit, 'auditB': b_audit, 'digest': digest}


def deny_mutations(cid, db):
    for who in ('a', 'b'):
        require(psql(cid, db, who,"DELETE FROM car02_r135_qa.audit_events;",False)=='REJECTED','AUDIT_DELETE_ALLOWED')
        require(psql(cid, db, who,"UPDATE car02_r135_qa.bookings SET state='CANCELLED';",False)=='REJECTED','RAW_BOOKING_UPDATE_ALLOWED')
        require(psql(cid, db, who,"INSERT INTO car02_r135_qa.audit_events(shop_code,booking_id,action) VALUES ('other_demo',1,'CREATED');",False)=='REJECTED','RAW_AUDIT_INSERT_ALLOWED')


def source(cid, evidence):
    db=DBS['source'];day=as_day()
    same='same_request_0001'; slot='10:00'; second='11:00'
    result=parallel(lambda i: claim(cid,db,'a',same,day,slot))
    require(result.count('CREATED')==1 and result.count('IDEMPOTENT')==5,'PARALLEL_REPLAY')
    result2=parallel(lambda i: claim(cid,db,'a',f'race_request_{i:04d}',day,second))
    require(result2.count('CREATED')==1 and result2.count('SLOT_TAKEN')==5,'PARALLEL_UNIQUE_SLOT')
    require(int(psql(cid,db,'a',"SELECT count(*) FROM car02_r135_qa.audit_events WHERE action='CREATED';"))==2,'DUPLICATE_CREATE_AUDIT')
    cancelled=parallel(lambda i: cancel(cid,db,'a',same))
    require(cancelled.count('CANCELLED')==1 and cancelled.count('IDEMPOTENT_CANCEL')==5,'PARALLEL_CANCEL')
    require(claim(cid,db,'a',same,day,slot)=='CANCELLED_REQUEST','STALE_REPLAY_REVIVAL')
    require(claim(cid,db,'a','rebook_request_0001',day,slot)=='CREATED','REBOOK_NEW_KEY')
    require(claim(cid,db,'a','rebook_request_0002',day,slot)=='SLOT_TAKEN','REBOOK_COLLISION')
    require(claim(cid,db,'b','tenantb_req_0001',day,slot)=='CREATED','TENANT_INDEPENDENCE')
    require(cancel(cid,db,'b',same)=='NOT_FOUND','CROSS_TENANT_CANCEL')
    require(claim(cid,db,'a',same,day,'10:30',ok=False)=='REJECTED','PAYLOAD_REPLAY_CONFLICT')
    require(claim(cid,db,'a','invalid_req_0001',day,'10:15',ok=False)=='REJECTED','NON_HALF_HOUR')
    today=dt.datetime.now(ZoneInfo('Asia/Tokyo')).date().isoformat()
    require(claim(cid,db,'a','invalid_req_0002','2020-01-01',ok=False)=='REJECTED','PAST_ALLOWED')
    sunday=dt.date.fromisoformat(day)
    while sunday.isoweekday()!=7:sunday+=dt.timedelta(days=1)
    require(claim(cid,db,'a','invalid_req_0003',sunday.isoformat(),ok=False)=='REJECTED','SUNDAY_ALLOWED')
    require(claim(cid,db,'a','invalid_req_0004',day,'18:00',ok=False)=='REJECTED','AFTER_HOURS_ALLOWED')
    require(claim(cid,db,'a','invalid_req_0005',day,'08:30',ok=False)=='REJECTED','BEFORE_HOURS_ALLOWED')
    deny_mutations(cid,db)
    before=snapshot(cid,db)
    require((before['rowsA'],before['rowsB'],before['auditA'],before['auditB'])==(3,1,4,1),'SOURCE_COUNTS')
    out={'version':'R135','mode':'source','syntheticOnly':True,'release':'NO_GO','migration':'HOLD','realBookingCreated':False,
         'validated':{'sixConcurrentSameRequest':True,'sixConcurrentSameSlot':True,'sixConcurrentCancel':True,
                      'staleReplayDenied':True,'rebookUsesFreshKey':True,'tenantRls':True,
                      'rawMutationDenied':True,'bookingRules':True},'day':day, 'summary':before}
    Path(evidence).write_text(json.dumps(out,indent=2)+'\n',encoding='utf-8')
    print('R135_PG17_CONCURRENCY_CANCEL_REBOOK_RLS_PASS')
    print('R135_RELEASE_NO_GO_MIGRATION_HOLD')


def restore(cid,evidence,source_evidence):
    db=DBS['restore'];p=json.loads(Path(source_evidence).read_text(encoding='utf-8'))
    require(p['release']=='NO_GO' and p['migration']=='HOLD' and p['syntheticOnly'] is True,'SOURCE_PROOF_GATE')
    after=snapshot(cid,db)
    require(after==p['summary'],'RESTORE_SNAPSHOT_MISMATCH')
    deny_mutations(cid,db)
    day=p['day']
    require(claim(cid,db,'a','same_request_0001',day)=='CANCELLED_REQUEST','RESTORE_STALE_REPLAY')
    require(claim(cid,db,'a','rebook_request_0001',day)=='IDEMPOTENT','RESTORE_FRESH_REPLAY')
    require(claim(cid,db,'a','different_req_0001',day)=='SLOT_TAKEN','RESTORE_DUPLICATE_SLOT')
    require(cancel(cid,db,'b','same_request_0001')=='NOT_FOUND','RESTORE_TENANT_GUARD')
    require(snapshot(cid,db)==after,'RESTORE_CHANGED_READONLY')
    out={'version':'R135','mode':'restore','syntheticOnly':True,'release':'NO_GO','migration':'HOLD',
         'realBookingCreated':False,'restoredProofMatches':True,'summary':after}
    Path(evidence).write_text(json.dumps(out,indent=2)+'\n',encoding='utf-8')
    print('R135_PG17_RESTORE_REPLAY_RLS_PASS')
    print('R135_RELEASE_NO_GO_MIGRATION_HOLD')


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('mode',choices=['source','restore'])
    ap.add_argument('--cid',required=True)
    ap.add_argument('--evidence',required=True)
    ap.add_argument('--source-evidence')
    a=ap.parse_args()
    require(os.environ.get('CAR02_RELEASE_LOCK')=='true' and os.environ.get('R135_DISPOSABLE_QA')=='yes','ENV_ISOLATION')
    if a.mode=='restore':require(bool(a.source_evidence),'MISSING_SOURCE_EVIDENCE')
    (source(a.cid,a.evidence) if a.mode=='source' else restore(a.cid,a.evidence,a.source_evidence))


if __name__=='__main__': main()

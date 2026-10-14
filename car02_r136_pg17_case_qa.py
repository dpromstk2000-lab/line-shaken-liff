#!/usr/bin/env python3
"""R136 disposable PostgreSQL 17 CI integration test; never access retained databases."""
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

DBS={'source':'car02_r136_qa_ci','restore':'car02_r136_restore_ci'}
ROLES={'as':'car02_r136_a_staff_ci','ac':'car02_r136_a_customer_ci',
       'bs':'car02_r136_b_staff_ci','bc':'car02_r136_b_customer_ci'}
PASSWORD='r136-throwaway-only'  # CI disposable only; NEVER production


def require(ok,reason):
    if not ok: raise AssertionError('R136_'+reason)


def q(s):
    require(isinstance(s,str) and re.fullmatch(r'[A-Za-z0-9_:\-]+',s) is not None,'UNSAFE_STRING')
    return "'"+s+"'"


def literal(x):
    if x is None: return 'NULL'
    if isinstance(x,int):
        require(0<=x<=100000000,'UNSAFE_INTEGER')
        return str(x)
    if isinstance(x,str):
        require(re.fullmatch(r'[A-Za-z0-9 _:\-\.]+',x) is not None,'UNSAFE_STRING')
        return "'"+x+"'"
    require(False,'UNSAFE_TYPE')


def psql(cid,db,actor,sql,ok=True):
    require(bool(re.fullmatch(r'[a-f0-9]{12,64}',cid)),'UNSAFE_CONTAINER')
    require(db in DBS.values() and actor in ROLES,'DISPOSABLE_ONLY')
    cmd=['docker','exec','-i',cid,'env','PGPASSWORD='+PASSWORD,'psql','-h','127.0.0.1','-X','-A','-t',
         '-v','ON_ERROR_STOP=1','-U',ROLES[actor],'-d',db,'-c',sql]
    result=subprocess.run(cmd,text=True,capture_output=True,timeout=25)
    if not ok:
        require(result.returncode!=0,'EXPECTED_REJECTION')
        return 'REJECTED'
    require(result.returncode==0,'SQL_FAILURE_'+result.stderr[-350:])
    return result.stdout.strip()


def booking(cid,db,actor,key,day,time='10:00',ok=True):
    return psql(cid,db,actor,'SELECT car02_r136_qa.claim_booking('+q(key)+','+q(day)+'::date,'+q(time)+'::time);',ok)


def open_case(cid,db,actor,key,booking_id,ok=True):
    return psql(cid,db,actor,f'SELECT car02_r136_qa.open_case({q(key)},{int(booking_id)});',ok)


def step(cid,db,actor,key,case_id,op,version,note=None,part=None,labor=None,choice=None,ok=True):
    args=[q(key),str(case_id),q(op),str(version),literal(note),literal(part),literal(labor),literal(choice)]
    return psql(cid,db,actor,'SELECT car02_r136_qa.case_step('+','.join(args)+');',ok)


def parallel(fn,n=6):
    with concurrent.futures.ThreadPoolExecutor(max_workers=n) as pool:
        fut=[pool.submit(fn,i) for i in range(n)]
        return [f.result(timeout=35) for f in fut]


def count(cid,db,actor,table):
    require(table in ('bookings','service_cases','case_operations','audit_events'),'TABLE_ALLOWLIST')
    return int(psql(cid,db,actor,'SELECT count(*) FROM car02_r136_qa.'+table+';'))


def snapshot(cid,db):
    out={}
    for actor,tag in (('as','A'),('bs','B')):
        out[tag]={t:count(cid,db,actor,t) for t in ('bookings','service_cases','case_operations','audit_events')}
        data=[]
        for table,expr in [('bookings',"request_key||':'||status"),
                           ('service_cases',"request_key||':'||state||':'||version::text||':'||coalesce(total_yen::text,'-')"),
                           ('case_operations',"request_key||':'||op"),('audit_events',"action||':'||entity_id::text")]:
            # Order by a stable stored identity, which survives pg_dump/pg_restore.
            x=psql(cid,db,actor,f'SELECT coalesce(string_agg({expr},\',\' ORDER BY id),\'\') FROM car02_r136_qa.{table};')
            data.append([table,x])
        out[tag]['digest']=hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()
    return out


def deny_raw_dml(cid,db):
    for a in ROLES:
        for sql in ('DELETE FROM car02_r136_qa.audit_events;',
                    'UPDATE car02_r136_qa.service_cases SET state=\'COMPLETED\';',
                    'DELETE FROM car02_r136_qa.case_operations;',
                    "INSERT INTO car02_r136_qa.audit_events(shop_code,entity_id,action) VALUES ('other_demo',1,'FAKE');"):
            require(psql(cid,db,a,sql,False)=='REJECTED','RAW_WRITE_ALLOWED')


def source(cid,path):
    db=DBS['source'];day=dt.datetime.now(ZoneInfo('Asia/Tokyo')).date()+dt.timedelta(days=5)
    while day.isoweekday()==7:day+=dt.timedelta(days=1)
    day=day.isoformat()
    simultaneous=parallel(lambda i: booking(cid,db,'as','r136_reserve_same_0001',day))
    require(simultaneous.count('CREATED')==1 and simultaneous.count('IDEMPOTENT')==5,'CONCURRENT_BOOKING_REPLAY')
    unique=parallel(lambda i: booking(cid,db,'as',f'r136_race_slot_{i:04d}',day,'11:00'))
    require(unique.count('CREATED')==1 and unique.count('SLOT_TAKEN')==5,'CONCURRENT_SLOT_COLLISION')
    require(booking(cid,db,'bs','r136_tenant_b_0001',day)=='CREATED','TENANT_B_BOOKING')
    require(booking(cid,db,'ac','r136_fake_custom_001',day,ok=False)=='REJECTED','CUSTOMER_CLAIM')
    require(booking(cid,db,'as','r136_reserve_same_0001',day,'10:30',False)=='REJECTED','BOOKING_PAYLOAD_CHANGE')
    a_id=int(psql(cid,db,'as',"SELECT id FROM car02_r136_qa.bookings WHERE request_key='r136_reserve_same_0001';"))
    b_id=int(psql(cid,db,'bs',"SELECT id FROM car02_r136_qa.bookings WHERE request_key='r136_tenant_b_0001';"))
    require(open_case(cid,db,'bs','r136_foreign_case_001',a_id,False)=='REJECTED','CROSS_TENANT_CASE')
    cases=parallel(lambda i: open_case(cid,db,'as','r136_case_same_00001',a_id))
    require(cases.count('OPENED')==1 and cases.count('IDEMPOTENT')==5,'CONCURRENT_CASE_CREATION')
    require(open_case(cid,db,'as','r136_diff_case_0001',a_id,False)=='REJECTED','DOUBLE_CASE')
    require(open_case(cid,db,'ac','r136_customer_case_1',a_id,False)=='REJECTED','CUSTOMER_CASE_OPEN')
    require(open_case(cid,db,'bs','r136_case_tenant_b1',b_id)=='OPENED','TENANT_B_CASE')
    a_case=int(psql(cid,db,'as',"SELECT id FROM car02_r136_qa.service_cases WHERE request_key='r136_case_same_00001';"))
    b_case=int(psql(cid,db,'bs',"SELECT id FROM car02_r136_qa.service_cases WHERE request_key='r136_case_tenant_b1';"))
    note='Front brake pad inspected in synthetic QA'
    require(step(cid,db,'ac','r136_bad_report_0001',a_case,'REPORT',1,note=note,ok=False)=='REJECTED','CUSTOMER_REPORT_ROLE')
    require(step(cid,db,'bs','r136_foreign_rep_001',a_case,'REPORT',1,note=note,ok=False)=='REJECTED','TENANT_REPORT_ROLE')
    results=parallel(lambda i:step(cid,db,'as','r136_report_same_0001',a_case,'REPORT',1,note=note))
    require(results.count('REPORT_SAVED')==1 and results.count('IDEMPOTENT')==5,'CONCURRENT_REPORT_REPLAY')
    require(step(cid,db,'as','r136_report_same_0001',a_case,'REPORT',1,note='Different synthetic note',ok=False)=='REJECTED','REPLAY_MISMATCH')
    require(step(cid,db,'as','r136_stale_quote_0001',a_case,'QUOTE',1,part=9800,labor=6600,ok=False)=='REJECTED','STALE_VERSION')
    require(step(cid,db,'as','r136_bad_quote_0001',a_case,'QUOTE',2,part=0,labor=0,ok=False)=='REJECTED','ZERO_QUOTE')
    require(step(cid,db,'as','r136_quote_same_00001',a_case,'QUOTE',2,part=9800,labor=6600)=='QUOTE_PRESENTED','QUOTE')
    require(psql(cid,db,'as',f'SELECT total_yen FROM car02_r136_qa.service_cases WHERE id={a_case};')=='18040','TAX_TOTAL')
    require(step(cid,db,'as','r136_bad_decide_0001',a_case,'DECIDE',3,choice='APPROVE',ok=False)=='REJECTED','STAFF_APPROVAL')
    require(step(cid,db,'bc','r136_cross_decide_001',a_case,'DECIDE',3,choice='APPROVE',ok=False)=='REJECTED','CROSS_TENANT_APPROVAL')
    require(step(cid,db,'as','r136_before_approve1',a_case,'COMPLETE',3,ok=False)=='REJECTED','WORK_BEFORE_APPROVE')
    require(step(cid,db,'ac','r136_customer_approve1',a_case,'DECIDE',3,choice='APPROVE')=='APPROVED','CUSTOMER_APPROVES')
    require(step(cid,db,'as','r136_work_completed1',a_case,'COMPLETE',4)=='COMPLETED','WORK_COMPLETED')
    require(step(cid,db,'as','r136_double_work_001',a_case,'COMPLETE',5,ok=False)=='REJECTED','WORK_DOUBLE_EXECUTE')
    require(step(cid,db,'as','r136_work_completed1',a_case,'COMPLETE',4)=='IDEMPOTENT','REPLAY_AFTER_COMPLETION')
    require(step(cid,db,'bs','r136_b_report_00001',b_case,'REPORT',1,note=note)=='REPORT_SAVED','B_REPORT')
    require(step(cid,db,'bs','r136_b_quote_000001',b_case,'QUOTE',2,part=1100,labor=2200)=='QUOTE_PRESENTED','B_QUOTE')
    require(step(cid,db,'bc','r136_b_decline_0001',b_case,'DECIDE',3,choice='DECLINE')=='DECLINED','B_DECLINES')
    require(step(cid,db,'bs','r136_b_complete_001',b_case,'COMPLETE',4,ok=False)=='REJECTED','DECLINED_WORK')
    deny_raw_dml(cid,db)
    snap=snapshot(cid,db)
    require(snap['A']['bookings']==2 and snap['B']['bookings']==1,'BOOKING_COUNTS')
    require(snap['A']['service_cases']==1 and snap['B']['service_cases']==1,'CASE_COUNTS')
    require(snap['A']['case_operations']==4 and snap['B']['case_operations']==3,'IDEMPOTENCY_COUNTS')
    require(snap['A']['audit_events']==7 and snap['B']['audit_events']==5,'AUDIT_COUNTS')
    proof={'version':'R136','mode':'source','syntheticOnly':True,'release':'NO_GO','migration':'HOLD',
           'realCustomerAuthenticated':False,'realOrdersCreated':False,'day':day,'snapshot':snap,
           'checks':['concurrent booking','concurrent case creation','atomic role-gated workflow',
                     'tenant RLS','replay and stale version rejection','read-only audit']}
    Path(path).write_text(json.dumps(proof,indent=2,ensure_ascii=False)+'\n')
    print('R136_PG17_BOOKING_CASE_ATOMICITY_RLS_PASS')
    print('R136_RELEASE_NO_GO_MIGRATION_HOLD')


def restore(cid,path,source_path):
    x=json.loads(Path(source_path).read_text());require(x['release']=='NO_GO' and x['migration']=='HOLD' and x['syntheticOnly'],'SOURCE_GATE')
    db=DBS['restore'];before=snapshot(cid,db)
    require(before==x['snapshot'],'RESTORE_SNAPSHOT_MISMATCH')
    deny_raw_dml(cid,db)
    a_case=int(psql(cid,db,'as',"SELECT id FROM car02_r136_qa.service_cases WHERE request_key='r136_case_same_00001';"))
    require(step(cid,db,'as','r136_work_completed1',a_case,'COMPLETE',4)=='IDEMPOTENT','RESTORED_REPLAY')
    require(step(cid,db,'as','r136_replay_fail0001',a_case,'COMPLETE',5,ok=False)=='REJECTED','RESTORED_NO_DUPLICATE')
    require(snapshot(cid,db)==before,'RESTORE_READ_ONLY')
    Path(path).write_text(json.dumps({'version':'R136','mode':'restore','release':'NO_GO','migration':'HOLD',
        'syntheticOnly':True,'matchesSource':True,'snapshot':before},indent=2)+'\n')
    print('R136_PG17_RESTORE_READONLY_REPLAY_PASS')
    print('R136_RELEASE_NO_GO_MIGRATION_HOLD')


def main():
    p=argparse.ArgumentParser();p.add_argument('mode',choices=('source','restore'));p.add_argument('--cid',required=True)
    p.add_argument('--evidence',required=True);p.add_argument('--source-evidence');a=p.parse_args()
    require(os.getenv('CAR02_RELEASE_LOCK')=='true' and os.getenv('R136_DISPOSABLE_QA')=='yes','ENV_ISOLATION')
    if a.mode=='restore':
        require(a.source_evidence is not None,'SOURCE_EVIDENCE_REQUIRED');restore(a.cid,a.evidence,a.source_evidence)
    else:source(a.cid,a.evidence)

if __name__=='__main__':main()

#!/usr/bin/env python3
"""R138 synthetic customer-level ownership QA, disposable GitHub PG17 only."""
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

DBS = {'source': 'car02_r138_qa_ci', 'restore': 'car02_r138_restore_ci'}
ROLES = {
    'as': 'car02_r138_a_staff_ci', 'a1': 'car02_r138_a_one_ci',
    'a2': 'car02_r138_a_two_ci', 'bs': 'car02_r138_b_staff_ci',
    'b1': 'car02_r138_b_one_ci'
}
PASSWORD = 'r138-throwaway-only'  # GitHub disposable PG17 fixture only


def require(condition, reason):
    if not condition:
        raise AssertionError('R138_' + reason)


def lit(x):
    if x is None:
        return 'NULL'
    if isinstance(x, int) and not isinstance(x, bool):
        require(0 <= x <= 100_000_000, 'BAD_NUMBER')
        return str(x)
    require(isinstance(x, str) and re.fullmatch(r'[A-Za-z0-9 _:\-.]+', x) is not None, 'BAD_LITERAL')
    return "'" + x + "'"


def psql(cid, db, actor, sql, success=True):
    require(re.fullmatch(r'[a-f0-9]{12,64}', cid) is not None, 'UNKNOWN_CONTAINER')
    require(db in DBS.values() and actor in ROLES, 'UNKNOWN_DISPOSABLE_DB_OR_ROLE')
    command = ['docker', 'exec', '-i', cid, 'env', 'PGPASSWORD=' + PASSWORD,
               'psql', '-h', '127.0.0.1', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
               '-U', ROLES[actor], '-d', db, '-c', sql]
    result = subprocess.run(command, capture_output=True, text=True, timeout=25)
    if not success:
        require(result.returncode != 0, 'EXPECTED_REJECTION')
        return 'REJECTED'
    require(result.returncode == 0, 'SQL_' + result.stderr[-300:])
    return result.stdout.strip()


def booking(cid, db, who, key, owner, day, clock='10:00', success=True):
    sql = f'SELECT car02_r138_qa.claim_booking({lit(key)},{lit(owner)},{lit(day)}::date,{lit(clock)}::time);'
    return psql(cid, db, who, sql, success)


def case(cid, db, who, key, booking_id, success=True):
    return psql(cid, db, who, f'SELECT car02_r138_qa.open_case({lit(key)},{int(booking_id)});', success)


def step(cid, db, who, key, case_id, op, version, note=None, part=None, labor=None, choice=None, success=True):
    args = [lit(key), lit(case_id), lit(op), lit(version), lit(note), lit(part), lit(labor), lit(choice)]
    return psql(cid, db, who, 'SELECT car02_r138_qa.case_step(' + ','.join(args) + ');', success)


def pool(fn, n=6):
    with concurrent.futures.ThreadPoolExecutor(max_workers=n) as executor:
        futures = [executor.submit(fn, i) for i in range(n)]
        return [x.result(timeout=40) for x in futures]


def integer(cid, db, who, sql):
    return int(psql(cid, db, who, sql))


def own_counts(cid, db, who):
    return {table: integer(cid, db, who, f'SELECT count(*) FROM car02_r138_qa.{table};') for table in
            ('bookings', 'service_cases', 'case_operations', 'audit_events')}


def digest(cid, db):
    result = {}
    for actor in ROLES:
        tables = []
        for table, expression in (
            ('bookings', "request_key||':'||owner_login||':'||state||':'||version::text||':'||booking_day::text||':'||begins_at::text"),
            ('service_cases', "request_key||':'||owner_login||':'||state||':'||version::text||':'||coalesce(total_yen::text,'-')"),
            ('case_operations', "request_key||':'||actor_login||':'||op"),
            ('booking_operations', "request_key||':'||actor_login||':'||op||':'||request_hash"),
            ('audit_events', "owner_login||':'||action||':'||entity_id::text")):
            sql = f"SELECT coalesce(string_agg({expression},',' ORDER BY id),'') FROM car02_r138_qa.{table};"
            tables.append([table, psql(cid, db, actor, sql)])
        result[actor] = {'counts': own_counts(cid, db, actor),
                         'sha256': hashlib.sha256(json.dumps(tables, sort_keys=True).encode()).hexdigest()}
    return result


def deny_direct_writes(cid, db):
    for role in ROLES:
        for sql in (
            'DELETE FROM car02_r138_qa.audit_events;',
            'DELETE FROM car02_r138_qa.booking_operations;',
            "UPDATE car02_r138_qa.service_cases SET state='COMPLETED';",
            "UPDATE car02_r138_qa.bookings SET owner_login='car02_r138_a_two_ci';",
            "UPDATE car02_r138_qa.bookings SET state='ACTIVE',version=1;",
            "INSERT INTO car02_r138_qa.audit_events(shop_code,owner_login,entity_id,action) VALUES ('street_house_demo','car02_r138_a_one_ci',1,'FAKE');"
        ):
            require(psql(cid, db, role, sql, False) == 'REJECTED', 'DIRECT_WRITE')


def synthetic_day():
    day = dt.datetime.now(ZoneInfo('Asia/Tokyo')).date() + dt.timedelta(days=5)
    while day.isoweekday() == 7:
        day += dt.timedelta(days=1)
    return day.isoformat()


def source(cid, output):
    db = DBS['source']; day = synthetic_day()
    a1 = ROLES['a1']; a2 = ROLES['a2']; b1 = ROLES['b1']
    first = pool(lambda _: booking(cid, db, 'as', 'r138_book_owner_one', a1, day))
    require(first.count('CREATED') == 1 and first.count('IDEMPOTENT') == 5, 'SIX_WAY_BOOKING_REPLAY')
    require(booking(cid, db, 'as', 'r138_book_owner_two', a2, day, '11:00') == 'CREATED', 'A2_BOOKING')
    require(booking(cid, db, 'bs', 'r138_book_owner_bone', b1, day) == 'CREATED', 'B1_BOOKING')
    require(booking(cid, db, 'as', 'r138_mismatch_tenant', b1, day, '12:00', False) == 'REJECTED', 'FOREIGN_OWNER_ASSIGNMENT')
    require(booking(cid, db, 'as', 'r138_book_owner_one', a2, day, '10:00', False) == 'REJECTED', 'OWNER_REPLAY_SWAP')
    require(booking(cid, db, 'a1', 'r138_customer_books', a1, day, '12:00', False) == 'REJECTED', 'CUSTOMER_STAFF_ROLE')
    ids = {
        'a1': integer(cid,db,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r138_book_owner_one';"),
        'a2': integer(cid,db,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r138_book_owner_two';"),
        'b1': integer(cid,db,'bs',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r138_book_owner_bone';")
    }
    require(case(cid,db,'bs','r138_cross_case_bad',ids['a1'],False)=='REJECTED','CROSS_SHOP_CASE')
    a_cases=pool(lambda _: case(cid,db,'as','r138_case_owner_one',ids['a1']))
    require(a_cases.count('OPENED')==1 and a_cases.count('IDEMPOTENT')==5,'SIX_WAY_CASE_REPLAY')
    require(case(cid,db,'as','r138_case_owner_two',ids['a2'])=='OPENED','A2_CASE')
    require(case(cid,db,'bs','r138_case_owner_bone',ids['b1'])=='OPENED','B1_CASE')
    require(case(cid,db,'as','r138_double_case_bad',ids['a1'],False)=='REJECTED','DOUBLE_CASE')
    cids={
        'a1':integer(cid,db,'as',"SELECT id FROM car02_r138_qa.service_cases WHERE request_key='r138_case_owner_one';"),
        'a2':integer(cid,db,'as',"SELECT id FROM car02_r138_qa.service_cases WHERE request_key='r138_case_owner_two';"),
        'b1':integer(cid,db,'bs',"SELECT id FROM car02_r138_qa.service_cases WHERE request_key='r138_case_owner_bone';")
    }
    # Verify visibility *inside the same shop* is restricted per customer.
    require(own_counts(cid,db,'as')['service_cases']==2, 'A_STAFF_NOT_ALL_CASES')
    require(own_counts(cid,db,'a1')['service_cases']==1, 'A1_CASE_VISIBILITY')
    require(own_counts(cid,db,'a2')['service_cases']==1, 'A2_CASE_VISIBILITY')
    require(own_counts(cid,db,'b1')['service_cases']==1, 'B1_CASE_VISIBILITY')
    require(integer(cid,db,'a2',f'SELECT count(*) FROM car02_r138_qa.service_cases WHERE id={cids["a1"]};')==0,'A2_SEES_A1')
    require(integer(cid,db,'a1',f'SELECT count(*) FROM car02_r138_qa.bookings WHERE id={ids["a2"]};')==0,'A1_SEES_A2_BOOKING')
    require(integer(cid,db,'a2',"SELECT count(*) FROM car02_r138_qa.audit_events WHERE owner_login='car02_r138_a_one_ci';")==0,'A2_SEES_A1_AUDIT')
    note='Brake pad inspected in isolated demonstration'
    require(step(cid,db,'as','r138_a1_report_001',cids['a1'],'REPORT',1,note=note)=='REPORT_SAVED','A1_REPORT')
    require(step(cid,db,'as','r138_a1_quote_0001',cids['a1'],'QUOTE',2,part=9800,labor=6600)=='QUOTE_PRESENTED','A1_QUOTE')
    require(integer(cid,db,'as',f'SELECT total_yen FROM car02_r138_qa.service_cases WHERE id={cids["a1"]};')==18040,'TAX_TOTAL')
    require(step(cid,db,'a2','r138_cross_customer1',cids['a1'],'DECIDE',3,choice='APPROVE',success=False)=='REJECTED','SAME_SHOP_OTHER_CUSTOMER_APPROVES')
    require(step(cid,db,'b1','r138_cross_shop_bad',cids['a1'],'DECIDE',3,choice='APPROVE',success=False)=='REJECTED','CROSS_SHOP_APPROVES')
    require(step(cid,db,'as','r138_staff_approve1',cids['a1'],'DECIDE',3,choice='APPROVE',success=False)=='REJECTED','STAFF_APPROVES')
    require(step(cid,db,'as','r138_early_complete',cids['a1'],'COMPLETE',3,success=False)=='REJECTED','UNAPPROVED_COMPLETE')
    approvals=pool(lambda _: step(cid,db,'a1','r138_a1_approval_01',cids['a1'],'DECIDE',3,choice='APPROVE'))
    require(approvals.count('APPROVED')==1 and approvals.count('IDEMPOTENT')==5,'SIX_WAY_APPROVAL_REPLAY')
    require(step(cid,db,'a2','r138_foreign_replay',cids['a1'],'DECIDE',3,choice='APPROVE',success=False)=='REJECTED','FOREIGN_APPROVAL_REPLAY')
    require(step(cid,db,'as','r138_a1_complete_01',cids['a1'],'COMPLETE',4)=='COMPLETED','A1_COMPLETED')
    require(step(cid,db,'as','r138_a2_report_001',cids['a2'],'REPORT',1,note=note)=='REPORT_SAVED','A2_REPORT')
    require(step(cid,db,'as','r138_a2_quote_0001',cids['a2'],'QUOTE',2,part=1100,labor=2200)=='QUOTE_PRESENTED','A2_QUOTE')
    require(step(cid,db,'a1','r138_reverse_cross_01',cids['a2'],'DECIDE',3,choice='APPROVE',success=False)=='REJECTED','A1_APPROVES_A2')
    require(step(cid,db,'a2','r138_a2_decline_01',cids['a2'],'DECIDE',3,choice='DECLINE')=='DECLINED','A2_DECLINED')
    require(step(cid,db,'as','r138_a2_completebad',cids['a2'],'COMPLETE',4,success=False)=='REJECTED','DECLINED_WORK')
    require(step(cid,db,'bs','r138_b1_report_001',cids['b1'],'REPORT',1,note=note)=='REPORT_SAVED','B1_REPORT')
    require(step(cid,db,'bs','r138_b1_quote_0001',cids['b1'],'QUOTE',2,part=4400,labor=2200)=='QUOTE_PRESENTED','B1_QUOTE')
    require(step(cid,db,'b1','r138_b1_approval_01',cids['b1'],'DECIDE',3,choice='APPROVE')=='APPROVED','B1_APPROVED')
    require(step(cid,db,'bs','r138_b1_complete_01',cids['b1'],'COMPLETE',4)=='COMPLETED','B1_COMPLETED')
    deny_direct_writes(cid,db)
    snap=digest(cid,db)
    expected={'as':(2,2,7,11),'a1':(1,1,4,6),'a2':(1,1,3,5),'bs':(1,1,4,6),'b1':(1,1,4,6)}
    # Independent staff/audit event counts are defined by actual operation history.
    for actor,(book,case_count,ops,audits) in expected.items():
        require(snap[actor]['counts']==dict(bookings=book,service_cases=case_count,case_operations=ops,audit_events=audits),'COUNTS_'+actor)
    proof={'version':'R138','mode':'source','syntheticOnly':True,'realCustomerAuthenticated':False,
           'release':'NO_GO','migration':'HOLD','customerObjectAccessVerified':True,
           'customersPerShop':['A1','A2'],'day':day,'caseIds':cids,'snapshot':snap}
    Path(output).write_text(json.dumps(proof,sort_keys=True,indent=2)+'\n',encoding='utf-8')
    print('R138_PG17_CUSTOMER_OBJECT_ISOLATION_PASS')
    print('R138_RELEASE_NO_GO_MIGRATION_HOLD')


def restore(cid, output, source_path):
    original=json.loads(Path(source_path).read_text(encoding='utf-8'))
    require(original['release']=='NO_GO' and original['migration']=='HOLD' and original['syntheticOnly'] is True,'SOURCE_GATE')
    db=DBS['restore']
    before=digest(cid,db)
    require(before==original['snapshot'],'RESTORE_SNAPSHOT_MISMATCH')
    deny_direct_writes(cid,db)
    ids=original['caseIds']
    require(step(cid,db,'a1','r138_a1_approval_01',ids['a1'],'DECIDE',3,choice='APPROVE')=='IDEMPOTENT','RESTORED_REPLAY')
    require(step(cid,db,'a2','r138_restore_ownerbad',ids['a1'],'DECIDE',3,choice='APPROVE',success=False)=='REJECTED','RESTORED_CROSS_CUSTOMER')
    require(step(cid,db,'as','r138_restore_doublework',ids['a1'],'COMPLETE',5,success=False)=='REJECTED','RESTORED_DOUBLE_WORK')
    require(digest(cid,db)==before,'RESTORE_MUTATED')
    Path(output).write_text(json.dumps({'version':'R138','mode':'restore','release':'NO_GO','migration':'HOLD',
            'syntheticOnly':True,'matchesSource':True,'snapshot':before},sort_keys=True,indent=2)+'\n',encoding='utf-8')
    print('R138_PG17_RESTORE_CUSTOMER_RLS_REPLAY_PASS')
    print('R138_RELEASE_NO_GO_MIGRATION_HOLD')



def change_booking(cid, db, actor, key, booking_id, op, version, day=None, clock=None, success=True):
    args=[lit(key), lit(booking_id), lit(op), lit(version),
          'NULL' if day is None else lit(day)+'::date',
          'NULL' if clock is None else lit(clock)+'::time']
    return psql(cid,db,actor,'SELECT car02_r138_qa.change_booking('+','.join(args)+');',success)


def lifecycle_source(cid, path):
    db=DBS['source']
    day=json.loads(Path(path).read_text())['day']
    a1=ROLES['a1']; a2=ROLES['a2']; b1=ROLES['b1']
    require(booking(cid,db,'as','r138_lifecycle_a1_01',a1,day,'13:00')=='CREATED','LC_A1_BOOKED')
    id1=integer(cid,db,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r138_lifecycle_a1_01';")
    require(change_booking(cid,db,'a2','r138_lc_other_move01',id1,'MOVE',1,day,'14:00',False)=='REJECTED','LC_OTHER_CUSTOMER_MOVE')
    require(change_booking(cid,db,'b1','r138_lc_other_shop01',id1,'MOVE',1,day,'14:00',False)=='REJECTED','LC_OTHER_SHOP_MOVE')
    moves=pool(lambda _:change_booking(cid,db,'a1','r138_move_a1_00001',id1,'MOVE',1,day,'13:30'))
    require(moves.count('MOVED')==1 and moves.count('IDEMPOTENT')==5,'LC_SIX_WAY_MOVE')
    require(integer(cid,db,'a1',f'SELECT version FROM car02_r138_qa.bookings WHERE id={id1};')==2,'LC_VERSION')
    require(change_booking(cid,db,'a1','r138_move_a1_00001',id1,'MOVE',1,day,'15:00',False)=='REJECTED','LC_MOVE_REPLAY_CHANGED')
    require(change_booking(cid,db,'a1','r138_move_stale0001',id1,'MOVE',1,day,'15:00',False)=='REJECTED','LC_STALE_VERSION')
    require(change_booking(cid,db,'a1','r138_move_sunday001',id1,'MOVE',2,'2030-01-06','15:00',False)=='REJECTED','LC_OUT_OF_RANGE')
    require(booking(cid,db,'as','r138_lifecycle_a2_01',a2,day,'14:00')=='CREATED','LC_A2_BOOKED')
    id2=integer(cid,db,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r138_lifecycle_a2_01';")
    require(change_booking(cid,db,'a1','r138_move_collision1',id1,'MOVE',2,day,'14:00',False)=='REJECTED','LC_SLOT_CONFLICT')
    require(integer(cid,db,'a1',f"SELECT count(*) FROM car02_r138_qa.bookings WHERE id={id1} AND begins_at='13:30'::time AND version=2;")==1,'LC_ATOMIC_COLLISION_ROLLBACK')
    cancels=pool(lambda _:change_booking(cid,db,'a1','r138_cancel_a1_001',id1,'CANCEL',2))
    require(cancels.count('CANCELLED')==1 and cancels.count('IDEMPOTENT')==5,'LC_SIX_WAY_CANCEL')
    require(booking(cid,db,'as','r138_lifecycle_a1_01',a1,day,'13:00')=='CANCELLED_ALREADY','LC_OLD_KEY_NOT_REACTIVATED')
    require(change_booking(cid,db,'a1','r138_cancel_again001',id1,'CANCEL',3,success=False)=='REJECTED','LC_CANCEL_IMMUTABLE')
    require(change_booking(cid,db,'a1','r138_move_cancelled1',id1,'MOVE',3,day,'14:30',False)=='REJECTED','LC_MOVE_CANCELLED')
    require(change_booking(cid,db,'a2','r138_cross_replay001',id1,'CANCEL',2,success=False)=='REJECTED','LC_FOREIGN_CANCEL')
    require(booking(cid,db,'as','r138_lifecycle_a2_02',a2,day,'13:30')=='CREATED','LC_CANCEL_FREED_SLOT')
    require(booking(cid,db,'as','r138_lifecycle_a1_02',a1,day,'13:00')=='CREATED','LC_REBOOK_NEW_KEY')
    id3=integer(cid,db,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r138_lifecycle_a1_02';")
    require(case(cid,db,'as','r138_case_new_booking',id3)=='OPENED','LC_OPEN_CASE')
    require(change_booking(cid,db,'a1','r138_case_move_denied',id3,'MOVE',1,day,'15:00',False)=='REJECTED','LC_CASE_LOCKED_MOVE')
    require(change_booking(cid,db,'as','r138_case_cancel_bad',id3,'CANCEL',1,success=False)=='REJECTED','LC_CASE_LOCKED_CANCEL')
    require(change_booking(cid,db,'a1','r138_cancel_with_day1',id3,'CANCEL',1,day,'15:00',False)=='REJECTED','LC_INVALID_CANCEL_PAYLOAD')
    # Separate tenant can use the identical clock without colliding with shop A.
    require(booking(cid,db,'bs','r138_lifecycle_b1_01',b1,day,'13:30')=='CREATED','LC_TENANT_SLOT_SEPARATE')
    require(integer(cid,db,'a2',f'SELECT count(*) FROM car02_r138_qa.booking_operations WHERE booking_id={id1};')==0,'LC_OWNER_OPERATION_RLS')
    require(integer(cid,db,'b1',f'SELECT count(*) FROM car02_r138_qa.booking_operations WHERE booking_id={id1};')==0,'LC_SHOP_OPERATION_RLS')
    require(integer(cid,db,'a1',f'SELECT count(*) FROM car02_r138_qa.booking_operations WHERE booking_id={id1};')==2,'LC_OWNER_SEES_TWO_OPERATIONS')
    deny_direct_writes(cid,db)
    old=json.loads(Path(path).read_text())
    old['snapshot']=digest(cid,db)
    old['lifecycleChecks']={'sixWayMove':True,'sixWayCancel':True,'crossCustomerDenied':True,
        'caseBoundBookingImmutable':True,'cancelledKeyNotReused':True,'slotReuse':True,'tenantIsolation':True}
    old['lifecycleBookingIds']={'cancelled':id1,'caseBound':id3,'otherCustomer':id2}
    Path(path).write_text(json.dumps(old,sort_keys=True,indent=2)+'\n',encoding='utf-8')
    print('R138_PG17_BOOKING_LIFECYCLE_OWNERSHIP_PASS')
    print('R138_RELEASE_NO_GO_MIGRATION_HOLD')


def lifecycle_restore(cid, path, source_path):
    db=DBS['restore']
    source_data=json.loads(Path(source_path).read_text())
    before=digest(cid,db)
    require(before==source_data['snapshot'],'LC_RESTORE_MISMATCH')
    ids=source_data['lifecycleBookingIds']
    require(change_booking(cid,db,'a1','r138_cancel_a1_001',ids['cancelled'],'CANCEL',2)=='IDEMPOTENT','LC_RESTORED_CANCEL_REPLAY')
    require(change_booking(cid,db,'a2','r138_wrong_owner_restore',ids['cancelled'],'CANCEL',3,success=False)=='REJECTED','LC_RESTORED_OTHER_CUSTOMER')
    require(change_booking(cid,db,'as','r138_restore_case_move',ids['caseBound'],'MOVE',1,source_data['day'],'15:00',False)=='REJECTED','LC_RESTORED_CASE_BLOCK')
    require(digest(cid,db)==before,'LC_RESTORED_MUTATION')
    old=json.loads(Path(path).read_text())
    old['lifecycleVerifiedRestore']=True
    old['snapshot']=before
    Path(path).write_text(json.dumps(old,sort_keys=True,indent=2)+'\n',encoding='utf-8')
    print('R138_PG17_RESTORE_LIFECYCLE_READONLY_PASS')
    print('R138_RELEASE_NO_GO_MIGRATION_HOLD')


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('mode',choices=['source','restore'])
    ap.add_argument('--cid',required=True)
    ap.add_argument('--evidence',required=True)
    ap.add_argument('--source-evidence')
    a=ap.parse_args()
    require(os.environ.get('CAR02_RELEASE_LOCK')=='true' and os.environ.get('R138_DISPOSABLE_QA')=='yes','ENV_ISOLATION')
    if a.mode=='restore':
        require(bool(a.source_evidence),'NO_SOURCE_EVIDENCE')
        restore(a.cid,a.evidence,a.source_evidence)
        lifecycle_restore(a.cid,a.evidence,a.source_evidence)
    else:
        source(a.cid,a.evidence)
        lifecycle_source(a.cid,a.evidence)


if __name__=='__main__':
    main()

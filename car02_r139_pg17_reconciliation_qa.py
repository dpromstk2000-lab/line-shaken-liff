#!/usr/bin/env python3
"""R139: independent, read-only reconciliation of *disposable* R138B PG17 fixture.

This is NOT a production API, a migration, or a replacement for authentication.
Only queries the dedicated R138B disposable databases with fixture-scoped roles.
"""
import argparse
from collections import Counter
from datetime import date
import hashlib
import json
import os
from pathlib import Path
import re

from car02_r138_pg17_lifecycle_qa import psql, DBS, ROLES

TABLE_COLUMNS = {
    'bookings': 'id,shop_code,owner_login,request_key,booking_day,begins_at,original_booking_day,original_begins_at,state,version',
    'service_cases': 'id,booking_id,shop_code,owner_login,request_key,state,version,report,part_yen,labor_yen,total_yen',
    'case_operations': 'id,case_id,shop_code,owner_login,actor_login,request_key,request_hash,op',
    'booking_operations': 'id,booking_id,shop_code,owner_login,actor_login,request_key,request_hash,op',
    'audit_events': 'id,shop_code,owner_login,entity_id,action',
}
SHOP_ROLES = {
    'as': ('street_house_demo', ('car02_r138_a_one_ci', 'car02_r138_a_two_ci')),
    'bs': ('other_demo', ('car02_r138_b_one_ci',)),
}
CUSTOMERS = {'a1': ('as','car02_r138_a_one_ci'), 'a2': ('as','car02_r138_a_two_ci'), 'b1': ('bs','car02_r138_b_one_ci')}
CASE_CHAINS = {
    'OPEN': (), 'REPORTED': ('REPORT',), 'QUOTED': ('REPORT','QUOTE'),
    'APPROVED': ('REPORT','QUOTE','DECIDE'), 'DECLINED': ('REPORT','QUOTE','DECIDE'),
    'COMPLETED': ('REPORT','QUOTE','DECIDE','COMPLETE'),
}

class ReconciliationError(AssertionError):
    pass


def require(ok, reason):
    if not ok:
        raise ReconciliationError('R139_' + reason)


def rows(cid, db, role, table):
    require(table in TABLE_COLUMNS, 'UNKNOWN_TABLE')
    cols=TABLE_COLUMNS[table]
    query=(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) "
           f"FROM (SELECT {cols} FROM car02_r138_qa.{table}) t;")
    result=json.loads(psql(cid, db, role, query))
    require(isinstance(result, list), 'NOT_A_ROW_LIST')
    return result


def canonical(data):
    return json.dumps(data,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode('utf8')


def attest_shop(shop, owners, tables):
    """Independent relational reconciliation; never assumes a fixed number of cases."""
    require(set(tables)==set(TABLE_COLUMNS), 'TABLE_SET')
    for table, recs in tables.items():
        require(isinstance(recs,list), 'BAD_RECORDS_'+table)
        require(len({v['id'] for v in recs})==len(recs), 'DUPLICATE_IDS_'+table)
        for r in recs:
            require(r['shop_code']==shop and r['owner_login'] in owners, 'TENANT_OR_OWNER_'+table)
    bookings={b['id']:b for b in tables['bookings']}
    cases={c['id']:c for c in tables['service_cases']}
    audit_expected=Counter()
    booking_ops={bid:[] for bid in bookings}
    case_ops={cid:[] for cid in cases}
    seen_requests=set()
    slots=set()
    for b in bookings.values():
        require(re.fullmatch(r'[A-Za-z0-9_-]{12,64}',b['request_key']) is not None,'BOOKING_REQUEST')
        key=('BOOKING',b['request_key'])
        require(key not in seen_requests,'BOOKING_REUSE');seen_requests.add(key)
        require(b['state'] in ('ACTIVE','CANCELLED'),'BOOKING_STATE')
        date.fromisoformat(b['booking_day']);date.fromisoformat(b['original_booking_day'])
        require(str(b['begins_at'])[:5][3:5] in ('00','30'),'SLOT_GRID')
        if b['state']=='ACTIVE':
            slot=(b['booking_day'],b['begins_at'])
            require(slot not in slots,'SLOT_DUPLICATED');slots.add(slot)
        audit_expected[(b['owner_login'],b['id'],'BOOKED')]+=1
    for op in tables['booking_operations']:
        b=bookings.get(op['booking_id'])
        require(b is not None,'ORPHAN_BOOKING_OPERATION')
        require(op['owner_login']==b['owner_login'],'BOOKING_OP_OWNER')
        require(op['op'] in ('MOVE','CANCEL'),'BOOKING_OP_KIND')
        require(len(op['request_hash'])==32,'BOOKING_HASH')
        key=('BOOKING_OP',op['request_key']);require(key not in seen_requests,'BOOKING_OP_REUSE');seen_requests.add(key)
        booking_ops[b['id']].append(op)
        audit_expected[(b['owner_login'],b['id'],op['op'])]+=1
    for b in bookings.values():
        ops=booking_ops[b['id']]
        require(b['version']==len(ops)+1,'BOOKING_VERSION_DRIFT')
        cancels=sum(v['op']=='CANCEL' for v in ops)
        require(cancels == int(b['state']=='CANCELLED'),'CANCEL_JOURNAL_DRIFT')
        if not any(v['op']=='MOVE' for v in ops):
            require((b['booking_day'],b['begins_at'])==(b['original_booking_day'],b['original_begins_at']), 'ORIGINAL_PAYLOAD_CHANGED')
    booking_case_ids=set()
    for c in cases.values():
        b=bookings.get(c['booking_id'])
        require(b is not None,'CASE_MISSING_BOOKING')
        require(c['booking_id'] not in booking_case_ids,'TWO_CASES_PER_BOOKING');booking_case_ids.add(c['booking_id'])
        require(c['owner_login']==b['owner_login'],'CASE_BOOKING_OWNER')
        require(b['state']=='ACTIVE','CASE_LINKS_CANCELLED_BOOKING')
        require(c['state'] in CASE_CHAINS,'UNKNOWN_CASE_STATE')
        require(c['version']>=1,'BAD_CASE_VERSION')
        if c['state'] not in ('OPEN','REPORTED'):
            require(isinstance(c['part_yen'],int) and isinstance(c['labor_yen'],int) and isinstance(c['total_yen'],int),'NO_QUOTE_AMOUNT')
            pre=c['part_yen']+c['labor_yen']
            require(pre>0 and c['total_yen']==pre+(pre+5)//10,'TAX_OR_TOTAL_DRIFT')
        if c['state']=='OPEN':
            require(c['report'] is None and c['total_yen'] is None,'OPEN_WITH_RESULTS')
        if c['state']!='OPEN':
            require(isinstance(c['report'],str) and 8<=len(c['report'])<=512,'REPORT_INVALID')
        audit_expected[(c['owner_login'],c['id'],'CASE_OPENED')]+=1
    for op in tables['case_operations']:
        c=cases.get(op['case_id']);require(c is not None,'ORPHAN_CASE_OPERATION')
        require(c['owner_login']==op['owner_login'],'CASE_OP_OWNER')
        require(op['op'] in ('REPORT','QUOTE','DECIDE','COMPLETE'),'CASE_OP_KIND')
        require(len(op['request_hash'])==32,'CASE_OP_HASH')
        key=('CASE_OP',op['request_key']);require(key not in seen_requests,'CASE_OP_REUSE');seen_requests.add(key)
        case_ops[c['id']].append(op)
        audit_expected[(c['owner_login'],c['id'],op['op'])]+=1
    for c in cases.values():
        ops=sorted(case_ops[c['id']],key=lambda z:z['id'])
        require(tuple(x['op'] for x in ops)==CASE_CHAINS[c['state']],'CASE_TRANSITION_CHAIN')
        require(c['version']==len(ops)+1,'CASE_VERSION_DRIFT')
        for op in ops:
            staff=op['actor_login'].endswith('_staff_ci')
            require((op['op']=='DECIDE')!=staff,'CASE_ACTOR_PRIVILEGE')
            if not staff:
                require(op['actor_login']==c['owner_login'],'CASE_APPROVAL_OWNER')
    audit_actual=Counter((e['owner_login'],e['entity_id'],e['action']) for e in tables['audit_events'])
    require(audit_actual==audit_expected,'AUDIT_RECONCILIATION_MISMATCH')
    stats={k:len(v) for k,v in tables.items()}
    return {'shop':shop,'counts':stats,'digest':hashlib.sha256(canonical(tables)).hexdigest(),
            'eventsReconciled':sum(audit_expected.values()),'customers':len(owners)}


def attest_snapshot(source, restored):
    """Fail closed on any cross-DB mismatch or missing proof; no hardcoded entity counts."""
    for label, item in [('source',source),('restore',restored)]:
        require(isinstance(item,dict),label+'_SHAPE')
        require(item.get('release')=='NO_GO' and item.get('migration')=='HOLD',label+'_LOCK')
        require(item.get('syntheticOnly') is True and item.get('productionTouched') is False,label+'_ISOLATION')
        require(set(item.get('shops',{}))=={'street_house_demo','other_demo'},label+'_SHOP_SET')
        for shop,p in item['shops'].items():
            require(p['shop']==shop and re.fullmatch('[0-9a-f]{64}',p['digest']) is not None,label+'_SHOP_DIGEST')
            require(p['eventsReconciled']==p['counts']['audit_events'],label+'_EVENT_COUNT')
    require(source['shops']==restored['shops'],'RESTORE_PARITY')
    return True


def collect(cid, db):
    snapshot={}
    for role,(shop,owners) in SHOP_ROLES.items():
        staff_tables={table:rows(cid,db,role,table) for table in TABLE_COLUMNS}
        proof=attest_shop(shop,owners,staff_tables)
        for customer,(staff,login) in CUSTOMERS.items():
            if staff!=role:continue
            # RLS check by reading every table as the customer and comparing exact rows.
            for table in TABLE_COLUMNS:
                customer_rows=rows(cid,db,customer,table)
                expected=[v for v in staff_tables[table] if v['owner_login']==login]
                require(customer_rows==expected,'CUSTOMER_RLS_'+customer+'_'+table)
        snapshot[shop]=proof
    return {'release':'NO_GO','migration':'HOLD','syntheticOnly':True,'productionTouched':False,'shops':snapshot}


def run_main():
    ap=argparse.ArgumentParser()
    ap.add_argument('mode',choices=['source','restore'])
    ap.add_argument('--cid',required=True)
    ap.add_argument('--out',required=True)
    ap.add_argument('--source-proof')
    args=ap.parse_args()
    require(os.environ.get('CAR02_RELEASE_LOCK')=='true' and os.environ.get('R138_DISPOSABLE_QA')=='yes' and os.environ.get('R139_DISPOSABLE_QA')=='yes','REQUIRES_DISPOSABLE_LOCK')
    require(re.fullmatch(r'[a-f0-9]{12,64}',args.cid) is not None,'BAD_CONTAINER')
    proof=collect(args.cid,DBS[args.mode]);proof['mode']=args.mode
    if args.mode=='restore':
        require(bool(args.source_proof),'MISSING_SOURCE_PROOF')
        previous=json.loads(Path(args.source_proof).read_text(encoding='utf8'))
        attest_snapshot(previous,proof)
    Path(args.out).write_text(json.dumps(proof,sort_keys=True,indent=2)+'\n',encoding='utf8')
    print('R139_PG17_INDEPENDENT_AUDIT_RECONCILIATION_PASS')
    if args.mode=='restore':print('R139_PG17_CROSS_DATABASE_PARITY_PASS')
    print('R139_RELEASE_NO_GO_MIGRATION_HOLD')

if __name__=='__main__':
    run_main()

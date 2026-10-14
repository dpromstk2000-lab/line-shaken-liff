#!/usr/bin/env python3
"""R141 independent evidence reconciler of R140 in-memory synthetic snapshot.

No API, SQL, authentication, external attestation or production writes.
Does NOT import R140 state machine logic; audits data and event journals only.
"""
import hashlib
import json
import os
import re

class AuditFailure(AssertionError):
    pass

def check(ok, code):
    if not ok:raise AuditFailure('R141_'+code)

def canonical(value):
    try: return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('ascii')
    except (TypeError,ValueError):raise AuditFailure('NON_CANONICAL')

CHAINS={'OPEN':(), 'REPORTED':('REPORT',), 'QUOTED':('REPORT','QUOTE'),
        'APPROVED':('REPORT','QUOTE','DECIDE'),'DECLINED':('REPORT','QUOTE','DECIDE'),
        'COMPLETED':('REPORT','QUOTE','DECIDE','COMPLETE')}


def attest(snapshot):
    check(os.environ.get('CAR02_RELEASE_LOCK')=='true' and
          os.environ.get('R140_SYNTHETIC_QA')=='yes','LOCK_REQUIRED')
    check(type(snapshot) is dict,'STATE_SHAPE')
    summary={}
    for tenant,t in sorted(snapshot.items()):
        check(type(tenant) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9_-]{2,31}',tenant),'TENANT')
        check(type(t) is dict and set(t)=={'seqB','seqC','bookings','cases','replay','audit'},'TENANT_SHAPE')
        bookings=t['bookings'];cases=t['cases'];aud=t['audit'];replay=t['replay']
        check(all(type(x) is dict for x in (bookings,cases,replay)) and type(aud) is list,'COLLECTION_SHAPE')
        check(type(t['seqB']) is int and type(t['seqC']) is int and
              t['seqB']>=len(bookings) and t['seqC']>=len(cases),'COUNTERS')
        for mapping in (bookings,cases):
            check(all(type(k) is str and type(v) is dict for k,v in mapping.items()),'RECORD_SHAPE')
        check(len(aud)==len(replay),'AUDIT_REPLAY_CARDINALITY')
        seen=set();by_booking={bid:[] for bid in bookings};by_case={cid:[] for cid in cases}
        for i,e in enumerate(aud,1):
            check(type(e) is dict and set(e)=={'index','tenant','op','subject','role','requestKey','fingerprint','result'},'EVENT_SHAPE')
            check(type(e['index']) is int and e['index']==i and e['tenant']==tenant,'AUDIT_ORDER')
            check(e['requestKey'] not in seen and type(e['requestKey']) is str,'AUDIT_DUPLICATE');seen.add(e['requestKey'])
            check(type(e['fingerprint']) is str and re.fullmatch('[0-9a-f]{64}',e['fingerprint']),'FINGERPRINT')
            check(e['role'] in ('CUSTOMER','STAFF','OWNER') and type(e['subject']) is str,'ACTOR')
            check(type(e['result']) is dict,'RESULT')
            check(e['requestKey'] in replay,'MISSING_REPLAY')
            r=replay[e['requestKey']]
            check(type(r) is dict and set(r)=={'fingerprint','response'},'REPLAY_SHAPE')
            check(r['fingerprint']==e['fingerprint'],'REPLAY_FINGERPRINT')
            rr=r['response']
            check(type(rr) is dict and rr.get('release')=='NO_GO' and rr.get('migration')=='HOLD' and
                  rr.get('syntheticOnly') is True and rr.get('productionTouched') is False and
                  rr.get('replayed') is False,'REPLAY_RELEASE_GATE')
            check(all(rr.get(k)==v for k,v in e['result'].items()),'REPLAY_RESULT')
            op=e['op']
            check(op in ('BOOK','MOVE','CANCEL','OPEN_CASE','REPORT','QUOTE','DECIDE','COMPLETE'),'OP')
            if op=='BOOK':
                bid=e['result'].get('bookingId');check(bid in bookings,'BOOK_EVENT_ORPHAN')
                check(e['role'] in ('STAFF','OWNER'),'BOOK_ACTOR')
                by_booking[bid].append(e)
            elif op in ('MOVE','CANCEL'):
                bid=e['result'].get('bookingId');check(bid in bookings,'BOOK_OPERATION_ORPHAN')
                by_booking[bid].append(e)
            else:
                cid=e['result'].get('caseId');check(cid in cases,'CASE_EVENT_ORPHAN')
                by_case[cid].append(e)
        check(set(replay)==seen,'UNRECORDED_REPLAY')
        active_slots=set();case_bookings=set()
        for bid,b in bookings.items():
            check(set(b)=={'id','tenant','ownerId','state','version','day','time','original'},'BOOK_SHAPE')
            check(b['id']==bid and b['tenant']==tenant and type(b['ownerId']) is str,'BOOK_TENANT')
            check(b['state'] in ('ACTIVE','CANCELLED'),'BOOK_STATE')
            check(type(b['original']) is dict and set(b['original'])=={'ownerId','day','time'},'BOOK_ORIGINAL_SHAPE')
            check(b['original']['ownerId']==b['ownerId'],'BOOK_ORIGINAL_OWNER')
            check(type(b['day']) is str and type(b['time']) is str and type(b['version']) is int,'BOOK_FIELDS')
            events=by_booking[bid]
            check(len(events)>0 and events[0]['op']=='BOOK','BOOK_NO_CREATION')
            check(all(e['op'] in ('MOVE','CANCEL') for e in events[1:]),'BOOK_CHAIN')
            check(len([e for e in events if e['op']=='BOOK'])==1,'BOOK_MULTICREATE')
            check(b['version']==len(events),'BOOK_VERSION')
            check(sum(e['op']=='CANCEL' for e in events)==(1 if b['state']=='CANCELLED' else 0),'BOOK_CANCEL_JOURNAL')
            cancel_positions=[i for i,e in enumerate(events) if e['op']=='CANCEL']
            if cancel_positions:
                check(cancel_positions==[len(events)-1],'BOOK_EVENT_AFTER_CANCEL')
            check(events[-1]['result']['state']==b['state'] and events[-1]['result']['version']==b['version'],'BOOK_LAST_STATE')
            if len(events)==1:
                check(b['day']==b['original']['day'] and b['time']==b['original']['time'],'ORIGINAL_MODIFIED')
            if b['state']=='ACTIVE':
                slot=(b['day'],b['time']);check(slot not in active_slots,'DUPLICATE_ACTIVE_SLOT');active_slots.add(slot)
            for e in events[1:]:
                if e['role']=='CUSTOMER':check(e['subject']==b['ownerId'],'BOOK_CUSTOMER_OWNERSHIP')
        for cid,c in cases.items():
            check(set(c)=={'id','bookingId','tenant','ownerId','state','version','report','quote','choice'},'CASE_SHAPE')
            bid=c['bookingId'];check(c['id']==cid and c['tenant']==tenant and bid in bookings,'CASE_TENANT')
            b=bookings[bid]
            check(b['tenant']==tenant and b['ownerId']==c['ownerId'] and b['state']=='ACTIVE','CASE_OWNER_BOOKING')
            check(bid not in case_bookings,'MULTIPLE_CASES');case_bookings.add(bid)
            ev=by_case[cid];check(len(ev)>0 and ev[0]['op']=='OPEN_CASE','CASE_NO_CREATION')
            chain=tuple(e['op'] for e in ev[1:])
            check(c['state'] in CHAINS and chain==CHAINS[c['state']],'CASE_CHAIN')
            check(c['version']==len(ev),'CASE_VERSION')
            check(ev[-1]['result']['state']==c['state'] and ev[-1]['result']['version']==c['version'],'CASE_LAST_STATE')
            for e in ev:
                if e['op']=='DECIDE':check(e['role']=='CUSTOMER' and e['subject']==c['ownerId'],'CASE_DECIDER')
                else:check(e['role'] in ('STAFF','OWNER'),'CASE_STAFF')
            if c['state']=='OPEN':check(c['report'] is None and c['quote'] is None and c['choice'] is None,'OPEN_CASE_FIELDS')
            else:check(type(c['report']) is str and 8<=len(c['report'])<=512,'REPORT')
            if c['state'] in ('QUOTED','APPROVED','DECLINED','COMPLETED'):
                q=c['quote'];check(type(q) is dict and set(q)=={'partYen','laborYen','totalYen'},'QUOTE_SHAPE')
                part=q['partYen'];labor=q['laborYen'];total=q['totalYen']
                check(all(type(x) is int and 0<=x<=100000000 for x in (part,labor,total)) and
                      part+labor>0 and total==part+labor+(part+labor+5)//10,'QUOTE_SUM')
            else:check(c['quote'] is None,'PREMATURE_QUOTE')
            if c['state'] in ('APPROVED','COMPLETED'):check(c['choice']=='APPROVE','APPROVAL_STATE')
            elif c['state']=='DECLINED':check(c['choice']=='DECLINE','DECLINE_STATE')
            else:check(c['choice'] is None,'PREMATURE_DECISION')
        summary[tenant]={'counts':{'bookings':len(bookings),'cases':len(cases),'operations':len(aud),
                                   'replays':len(replay)},'sha256':hashlib.sha256(canonical(t)).hexdigest()}
    return {'version':'R141','release':'NO_GO','migration':'HOLD','syntheticOnly':True,
            'productionTouched':False,'tenants':summary}

def compare(source,copy_):
    check(type(source) is dict and type(copy_) is dict,'ATTEST_SHAPE')
    check(source.get('release')=='NO_GO' and source.get('migration')=='HOLD' and
          source.get('syntheticOnly') is True and source.get('productionTouched') is False,'SOURCE_GATE')
    check(copy_ == source,'INDEPENDENT_PARITY')
    return True

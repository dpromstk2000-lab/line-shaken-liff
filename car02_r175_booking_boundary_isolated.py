#!/usr/bin/env python3
"""R175 disposable PG17 booking boundary + five-table nonmutation witness.

Only synthesized data in freshly created car02_r138_qa_ci. Not a production
migration, real authentication test, or authority to release NO_GO / HOLD.
"""
from __future__ import annotations
import argparse
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
import hashlib,json,os,re
from pathlib import Path
from car02_r138_pg17_lifecycle_qa import ROLES,booking,integer,psql,lit
from car02_r159_concurrent_booking_isolated import DB,CID,COMMIT,change
from car02_r171_rejection_immutability_isolated import snapshot, TABLES

OUT='qa-evidence-r175/r175-booking-boundary-proof.json'
EXPECTED={
 'past_date':'R138_INVALID_BOOKING','sunday':'R138_INVALID_BOOKING',
 'over_60_days':'R138_INVALID_BOOKING','before_open':'R138_INVALID_BOOKING',
 'after_close':'R138_INVALID_BOOKING','quarter_hour':'R138_INVALID_BOOKING',
 'seconds':'R138_INVALID_BOOKING','invalid_key':'R138_INVALID_BOOKING',
 'foreign_tenant_owner':'R138_OWNER_SHOP_MISMATCH','customer_cannot_create':'R138_STAFF_REQUIRED',
 'changed_time_replay':'R138_BOOKING_REPLAY_CONFLICT',
 'changed_owner_replay':'R138_BOOKING_REPLAY_CONFLICT',
 'move_past':'R138_INVALID_MOVE_SLOT','move_sunday':'R138_INVALID_MOVE_SLOT',
 'move_over_60_days':'R138_INVALID_MOVE_SLOT','move_before_open':'R138_INVALID_MOVE_SLOT',
 'move_after_close':'R138_INVALID_MOVE_SLOT','move_quarter_hour':'R138_INVALID_MOVE_SLOT',
 'move_seconds':'R138_INVALID_MOVE_SLOT','move_noop':'R138_NOOP_MOVE',
 'cancel_extra_payload':'R138_CANCEL_PAYLOAD',
 'altered_move_replay':'R138_REPLAY_CONFLICT',
 'cancelled_move':'R138_CANCELLED_IMMUTABLE',
 'direct_update':'permission denied',
}
LOCK={
 'version':'R175','mode':'DISPOSABLE_PG17_JST_BOOKING_BOUNDARY_ONLY',
 'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
 'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
 'realAuthenticationVerified':False,'realRLSVerified':False,
 'externalWitnessVerified':False,'externalSignatureVerified':False,
 'independentProductionTest':False,'sourceR138BUnchanged':True,'sourceR171Unchanged':True,
 'syntheticDb':DB,'fixtureRoles':5,'fiveTableNoMutationVerified':True,
 'jstDateWindowsVerified':True,'thirtyMinuteRuleVerified':True,
 'replayOwnershipVerified':True,'auditExactlyOnceVerified':True,
}
class BoundaryError(AssertionError): pass

def require(condition,code):
    if not condition: raise BoundaryError('R175_'+code)

def seal(value):
    return hashlib.sha256(json.dumps({k:v for k,v in value.items() if k!='sha256'},
        sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('ascii')).hexdigest()

def dates(today=None):
    today=today or datetime.now(ZoneInfo('Asia/Tokyo')).date()
    require(type(today) is __import__('datetime').date,'DATE_TYPE')
    valid=next((today+timedelta(days=n) for n in range(14,30) if (today+timedelta(days=n)).isoweekday()!=7),None)
    sunday=next(today+timedelta(days=n) for n in range(1,9) if (today+timedelta(days=n)).isoweekday()==7)
    upper=next(today+timedelta(days=n) for n in (60,59,58) if (today+timedelta(days=n)).isoweekday()!=7)
    require(valid and valid<=today+timedelta(days=60) and upper>valid,'DATE_WINDOW')
    return {'valid':str(valid),'sunday':str(sunday),'past':str(today-timedelta(days=1)),
            'too_late':str(today+timedelta(days=61)),'upper':str(upper)}

def query_create(key,owner,day,clock):
    return 'SELECT car02_r138_qa.claim_booking('+','.join((lit(key),lit(owner),lit(day)+'::date',lit(clock)+'::time'))+');'

def query_move(key,bid,op,ver,day=None,clock=None):
    require(type(bid) is int and bid>0 and type(ver) is int and ver>0,'CHANGE_ARGS')
    return 'SELECT car02_r138_qa.change_booking('+','.join((lit(key),str(bid),lit(op),str(ver),
        'NULL' if day is None else lit(day)+'::date',
        'NULL' if clock is None else lit(clock)+'::time'))+');'

def strict_snapshot(value):
    require(type(value) is dict and set(value)==set(TABLES),'SNAP_KEYS')
    require(all(type(value[t]) is str and re.fullmatch('[0-9a-f]{32}',value[t]) for t in TABLES),'SNAP_HASH')
    return True

def verify_report(report):
    require(type(report) is dict and set(report)==set(LOCK)|{'githubCommit','rejected','snapshots','dates','audit','sha256'},'FIELDS')
    for k,v in LOCK.items(): require(type(report[k]) is type(v) and report[k]==v,'LOCK_'+k)
    require(type(report['githubCommit']) is str and COMMIT.fullmatch(report['githubCommit']),'COMMIT')
    require(type(report['rejected']) is dict and report['rejected']==EXPECTED,'REJECTION_SET')
    require(type(report['snapshots']) is dict and set(report['snapshots'])==set(EXPECTED),'WITNESS_SET')
    for k,pair in report['snapshots'].items():
        require(type(pair) is dict and set(pair)=={'before','after'},'WITNESS_PAIR')
        strict_snapshot(pair['before']);strict_snapshot(pair['after'])
        require(pair['before']==pair['after'],'WITNESS_MUTATED_'+k)
    require(type(report['dates']) is dict and set(report['dates'])=={'valid','sunday','past','too_late','upper'},'DATES')
    import datetime as dt
    try:
        day={k:dt.date.fromisoformat(v) for k,v in report['dates'].items() if type(v) is str}
        require(set(day)==set(report['dates']),'DATE_VALUES')
        require(day['sunday'].isoweekday()==7 and day['valid'].isoweekday()!=7 and day['upper'].isoweekday()!=7,'DAY_TYPES')
        require(day['past']<day['valid']<day['upper']<day['too_late'],'DAY_ORDER')
    except ValueError as exc: raise BoundaryError('R175_BAD_DATE') from exc
    require(type(report['audit']) is dict and report['audit']=={'BOOKED':2,'MOVE':1,'CANCEL':1,'bookingOperations':2},'AUDIT')
    require(type(report.get('sha256')) is str and re.fullmatch('[a-f0-9]{64}',report['sha256']) and report['sha256']==seal(report),'SEAL')
    return True

def save(report,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink() and not path.exists() and not path.is_symlink(),'OUTPUT_SCOPE')
    verify_report(report)
    with path.open('x',encoding='ascii') as f:f.write(json.dumps(report,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False)+'\n')
    require(verify_report(json.loads(path.read_text(encoding='ascii'))),'ROUNDTRIP')
    return path

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid),'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit),'COMMIT_ARG')
    require(out==OUT,'OUTPUT_ARG')
    require(os.getenv('GITHUB_SHA')==commit and os.getenv('CAR02_RELEASE_LOCK')=='true' and
            os.getenv('R175_DISPOSABLE_QA')=='yes','LOCK_ENV')
    output=Path(out)
    require(output.parent.is_dir() and not output.parent.is_symlink() and not output.exists(),'OUTPUT_EXISTS')
    day=dates();owner=ROLES['a1'];other=ROLES['a2'];b_owner=ROLES['b1']
    require(booking(cid,DB,'as','r175_edge_0900',owner,day['valid'],'09:00')=='CREATED','OPEN_EDGE')
    require(booking(cid,DB,'as','r175_edge_1730',other,day['upper'],'17:30')=='CREATED','CLOSE_EDGE')
    require(booking(cid,DB,'as','r175_edge_0900',owner,day['valid'],'09:00')=='IDEMPOTENT','REPLAY')
    bid=integer(cid,DB,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r175_edge_0900';")
    witness={};observed={}
    def refuse(name,actor,sql):
        require(name in EXPECTED and name not in witness,'DUPLICATE_TEST')
        before=snapshot(cid)
        require(psql(cid,DB,actor,sql,False,expected_error=EXPECTED[name])=='REJECTED','REJECTION_'+name)
        after=snapshot(cid)
        require(before==after,'MUTATION_'+name)
        observed[name]=EXPECTED[name];witness[name]={'before':before,'after':after}
    def bad_create(name,key,who,booking_day,clock,actor='as'):
        refuse(name,actor,query_create(key,who,booking_day,clock))
    bad_create('past_date','r175_past_day',owner,day['past'],'11:00')
    bad_create('sunday','r175_sunday_bad',owner,day['sunday'],'11:00')
    bad_create('over_60_days','r175_future_far',owner,day['too_late'],'11:00')
    for name,clock in [('before_open','08:30'),('after_close','18:00'),('quarter_hour','10:15'),('seconds','10:00:01')]:
        bad_create(name,'r175_'+name,owner,day['valid'],clock)
    bad_create('invalid_key','tiny',owner,day['valid'],'11:00')
    bad_create('foreign_tenant_owner','r175_wrong_shop',b_owner,day['valid'],'12:00')
    bad_create('customer_cannot_create','r175_no_staff',owner,day['valid'],'12:00','a1')
    bad_create('changed_time_replay','r175_edge_0900',owner,day['valid'],'09:30')
    bad_create('changed_owner_replay','r175_edge_0900',other,day['valid'],'09:00')
    def bad_move(name,booking_day,clock):
        refuse(name,'a1',query_move('r175_'+name,bid,'MOVE',1,booking_day,clock))
    for name,d,t in [('move_past',day['past'],'10:30'),('move_sunday',day['sunday'],'10:30'),
                     ('move_over_60_days',day['too_late'],'10:30'),('move_before_open',day['valid'],'08:30'),
                     ('move_after_close',day['valid'],'18:00'),('move_quarter_hour',day['valid'],'10:15'),
                     ('move_seconds',day['valid'],'10:00:01'),('move_noop',day['valid'],'09:00')]:
        bad_move(name,d,t)
    refuse('cancel_extra_payload','a1',query_move('r175_cancel_bad',bid,'CANCEL',1,day['valid'],'09:00'))
    require(change(cid,'a1','r175_move_valid',bid,'MOVE',1,day['valid'],'10:30')=='MOVED','VALID_MOVE')
    refuse('altered_move_replay','a1',query_move('r175_move_valid',bid,'MOVE',1,day['valid'],'11:00'))
    require(change(cid,'a1','r175_move_valid',bid,'MOVE',1,day['valid'],'10:30')=='IDEMPOTENT','MOVE_REPLAY')
    require(booking(cid,DB,'as','r175_edge_0900',owner,day['valid'],'09:00')=='IDEMPOTENT','ORIGINAL_REPLAY')
    require(change(cid,'a1','r175_cancel_valid',bid,'CANCEL',2)=='CANCELLED','VALID_CANCEL')
    require(change(cid,'a1','r175_cancel_valid',bid,'CANCEL',2)=='IDEMPOTENT','CANCEL_REPLAY')
    refuse('cancelled_move','a1',query_move('r175_cancelled_change',bid,'MOVE',3,day['valid'],'11:00'))
    refuse('direct_update','a1',"UPDATE car02_r138_qa.bookings SET state='ACTIVE';")
    a={x:integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE action='{x}';") for x in ('BOOKED','MOVE','CANCEL')}
    a['bookingOperations']=integer(cid,DB,'as','SELECT count(*) FROM car02_r138_qa.booking_operations;')
    require(a=={'BOOKED':2,'MOVE':1,'CANCEL':1,'bookingOperations':2},'AUDIT_PARITY')
    require(observed==EXPECTED,'CHECKS_COMPLETE')
    report=dict(LOCK,githubCommit=commit,rejected=observed,snapshots=witness,dates=day,audit=a)
    report['sha256']=seal(report)
    save(report,output)
    print('R175_DISPOSABLE_PG17_JST_BOUNDARY_AND_DENIAL_IMMUTABILITY_PASS_NO_GO_HOLD')
    return report

def main():
    p=argparse.ArgumentParser();p.add_argument('--cid',required=True);p.add_argument('--commit',required=True);p.add_argument('--out',default=OUT)
    args=p.parse_args();probe(args.cid,args.commit,args.out)
if __name__=='__main__':main()

#!/usr/bin/env python3
"""R159: real concurrent PostgreSQL 17 QA against ONLY the disposable R138B fixture.

Tests a shared schema's booking/cancel/move/case-race behavior with independent
psql sessions. Synthetic roles/passwords only. NEVER deploy to actual systems.
The result is NOT proof of production authentication, production RLS or release.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from zoneinfo import ZoneInfo
from car02_r138_pg17_lifecycle_qa import ROLES, DBS, lit, psql, booking, case, integer, digest

DB = 'car02_r138_qa_ci'
PREFIX = 'R159_'
RELEASE = 'NO_GO'
MIGRATION = 'HOLD'
ALLOWED = frozenset({'CREATED','IDEMPOTENT','SLOT_TAKEN','MOVED','CANCELLED','REJECTED','OPENED','CANCELLED_ALREADY'})
CID = re.compile(r'[a-f0-9]{12,64}\Z')
COMMIT = re.compile(r'[a-f0-9]{40}\Z')

class ProbeError(AssertionError): pass

def require(ok: bool, code: str):
    if not ok: raise ProbeError(PREFIX+code)

def day_for_test() -> str:
    value=dt.datetime.now(ZoneInfo('Asia/Tokyo')).date()+dt.timedelta(days=7)
    while value.isoweekday()==7: value+=dt.timedelta(days=1)
    return value.isoformat()

def in_parallel(functions: list, max_workers=8):
    require(type(functions) is list and 2 <= len(functions) <= 8,'BAD_WORKLOAD')
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures=[executor.submit(fn) for fn in functions]
        return [f.result(timeout=60) for f in futures]

def expect_results(results, expected: dict):
    require(type(results) is list and all(type(s) is str and s in ALLOWED for s in results),'RESULT_TYPES')
    observed={s:results.count(s) for s in set(results)}
    require(observed==expected,'CONCURRENCY_INVARIANT')
    return observed

def change(cid, who, key, bid, operation, version, new_day=None, new_time=None, success=True, error=None):
    require(type(bid) is int and bid>0 and operation in ('CANCEL','MOVE'),'CHANGE_ARGS')
    args=[lit(key),str(bid),lit(operation),str(version),lit(new_day),lit(new_time)]
    return psql(cid,DB,who,'SELECT car02_r138_qa.change_booking('+','.join(args)+');',success,expected_error=error)

def concurrent_sql(cid: str, who: str, query: str, rejected_reason: str, accepted_result: str):
    """Dynamic winner/loser reporting with a strict allowlisted SQL error."""
    require(type(cid) is str and CID.fullmatch(cid) is not None and who in ROLES,'SQL_CID_ROLE')
    require(type(query) is str and query.startswith('SELECT car02_r138_qa.') and query.endswith(');'), 'SQL_SCOPE')
    command=['docker','exec','-i',cid,'env','PGPASSWORD=r138-throwaway-only','psql','-h','127.0.0.1',
             '-X','-A','-t','-v','ON_ERROR_STOP=1','-U',ROLES[who],'-d',DB,'-c',query]
    result=subprocess.run(command,capture_output=True,text=True,timeout=40)
    if result.returncode==0:
        require(result.stdout.strip()==accepted_result,'WRONG_WINNER_OUTPUT')
        return accepted_result
    require(rejected_reason in result.stderr and result.returncode != 0,'WRONG_LOSER_REASON')
    return 'REJECTED'

def racing_change(cid, who, key, bid, operation, version, new_day, new_time, rejection):
    args=[lit(key),str(bid),lit(operation),str(version),lit(new_day),lit(new_time)]
    query='SELECT car02_r138_qa.change_booking('+','.join(args)+');'
    return concurrent_sql(cid,who,query,rejection,'MOVED' if operation=='MOVE' else 'CANCELLED')

def racing_case(cid, bid):
    return concurrent_sql(cid,'as',f"SELECT car02_r138_qa.open_case('r159_concurrent_case_001',{bid});",
                          'R138_BOOKING_NOT_FOUND','OPENED')

def row(cid, who, booking_id):
    raw=psql(cid,DB,who,('SELECT owner_login||\'|\'||state||\'|\'||version::text||\'|\'||booking_day::text||\'|\'||begins_at::text '
                           f'FROM car02_r138_qa.bookings WHERE id={booking_id};'))
    require(type(raw) is str and raw.count('|')==4,'ROW_SHAPE')
    owner,state,version,day,time=raw.split('|')
    return {'owner':owner,'state':state,'version':int(version),'day':day,'time':time}

def verify_release(report: dict):
    require(type(report) is dict and report.get('version')=='R159','VERSION')
    require(type(report.get('githubCommit')) is str and COMMIT.fullmatch(report['githubCommit']),'COMMIT')
    expected={'mode':'DISPOSABLE_PG17_REAL_CONCURRENCY_SYNTHETIC_ONLY','release':'NO_GO','migration':'HOLD',
              'realWorldGatesOpen':12,'syntheticOnly':True,'productionTouched':False,
              'productionAuthorized':False,'realAuthenticationVerified':False,'realRLSVerified':False,
              'externalWitnessVerified':False,'externalSignatureVerified':False,
              'independentProductionTest':False}
    for k,v in expected.items(): require(type(report.get(k)) is type(v) and report[k]==v,'RELEASE_'+k)
    required=('sameKey','sameSlot','crossTenant','competingMove','sameCancel','caseVsCancel','deniedWritesNoMutation')
    require(set(report.get('checks',{}))==set(required),'CHECK_SET')
    for k in required: require(report['checks'][k] is True,'CHECK_'+k)
    require(report.get('syntheticDb')=='car02_r138_qa_ci' and
            report.get('fixtureRoles')==5 and report.get('originalSqlUnchanged') is True,
            'FIXTURE_SCOPE')
    expect_results(report.get('sameKeyResults'), {'CREATED':1,'IDEMPOTENT':7})
    expect_results(report.get('sameSlotResults'), {'CREATED':1,'SLOT_TAKEN':1})
    expect_results(report.get('moveResults'), {'MOVED':1,'REJECTED':1})
    expect_results(report.get('cancelResults'), {'CANCELLED':1,'IDEMPOTENT':7})
    check_case_cancel_outcome(report.get('caseCancelResults'))
    core={k:v for k,v in report.items() if k!='sha256'}
    actual=hashlib.sha256(json.dumps(core,sort_keys=True,ensure_ascii=True,separators=(',',':')).encode('ascii')).hexdigest()
    require(report.get('sha256')==actual,'HASH')
    return True

def probe(cid: str, commit: str, out: str):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit),'COMMIT_ARG')
    require(os.environ.get('GITHUB_SHA')==commit and os.environ.get('CAR02_RELEASE_LOCK')=='true'
            and os.environ.get('R159_DISPOSABLE_QA')=='yes','ENV_HOLD')
    require(out=='qa-evidence-r159/r159-concurrency-proof.json','OUTPUT')
    target=Path(out)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'OUTPUT_EXISTS')
    day=day_for_test()
    a1=ROLES['a1']; a2=ROLES['a2']; b1=ROLES['b1']
    same=in_parallel([lambda:booking(cid,DB,'as','r159_same_key_001',a1,day,'10:00') for _ in range(8)])
    expect_results(same,{'CREATED':1,'IDEMPOTENT':7})
    ident=integer(cid,DB,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r159_same_key_001';")
    require(integer(cid,DB,'as',"SELECT count(*) FROM car02_r138_qa.bookings WHERE request_key='r159_same_key_001';")==1,'ONLY_ONE_BOOKING')
    require(integer(cid,DB,'a2',f'SELECT count(*) FROM car02_r138_qa.bookings WHERE id={ident};')==0,'A2_READ_DENIED')
    require(integer(cid,DB,'b1',f'SELECT count(*) FROM car02_r138_qa.bookings WHERE id={ident};')==0,'B1_READ_DENIED')
    same_slot=in_parallel([
        lambda:booking(cid,DB,'as','r159_same_slot_001',a1,day,'10:30'),
        lambda:booking(cid,DB,'as','r159_same_slot_002',a2,day,'10:30')])
    expect_results(same_slot,{'CREATED':1,'SLOT_TAKEN':1})
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.bookings WHERE shop_code='street_house_demo' AND booking_day='{day}' AND begins_at='10:30' AND state='ACTIVE';")==1,'ONLY_ONE_ACTIVE_SLOT')
    require(booking(cid,DB,'bs','r159_other_tenant',b1,day,'10:00')=='CREATED','B_SHOP_INDEPENDENT')
    require(booking(cid,DB,'as','r159_cross_tenant',b1,day,'15:00',success=False,
                    expected_error='R138_OWNER_SHOP_MISMATCH')=='REJECTED','CROSS_TENANT_DENIED')
    move_results=in_parallel([
        lambda:racing_change(cid,'a1','r159_move_win_001',ident,'MOVE',1,day,'12:00','R138_STALE_BOOKING'),
        lambda:racing_change(cid,'a1','r159_move_win_002',ident,'MOVE',1,day,'12:30','R138_STALE_BOOKING')])
    # Either request may win; the loser must be a verified STALE_BOOKING rejection.
    expect_results(move_results,{'MOVED':1,'REJECTED':1})
    moved_key=['r159_move_win_001','r159_move_win_002'][move_results.index('MOVED')]
    moved_time=['12:00','12:30'][move_results.index('MOVED')]
    require(row(cid,'a1',ident)['version']==2,'MOVE_VERSION')
    require(change(cid,'a1',moved_key,ident,'MOVE',1,day,moved_time)=='IDEMPOTENT','MOVE_REPLAY')
    require(change(cid,'a1',moved_key,ident,'MOVE',1,day,'13:00',success=False,
                   error='R138_REPLAY_CONFLICT')=='REJECTED','ALTERED_REPLAY_DENIED')
    require(change(cid,'a2','r159_foreign_cancel',ident,'CANCEL',2,success=False,
                   error='R138_OWNER_DENIED')=='REJECTED','FOREIGN_CANCEL_DENIED')
    require(change(cid,'b1','r159_other_tenant_cancel',ident,'CANCEL',2,success=False,
                   error='R138_BOOKING_NOT_FOUND')=='REJECTED','OTHER_TENANT_CANCEL_DENIED')
    cancels=in_parallel([lambda:change(cid,'a1','r159_cancel_same_001',ident,'CANCEL',2) for _ in range(8)])
    expect_results(cancels,{'CANCELLED':1,'IDEMPOTENT':7})
    require(row(cid,'a1',ident)['version']==3 and row(cid,'a1',ident)['state']=='CANCELLED','FINAL_CANCEL_STATE')
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.booking_operations WHERE booking_id={ident};")==2,'ONE_MOVE_ONE_CANCEL_OP')
    for action in ('BOOKED','MOVE','CANCEL'):
        require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={ident} AND action='{action}';")==1,
                'ONE_AUDIT_'+action)
    require(booking(cid,DB,'as','r159_same_key_001',a1,day,'10:00')=='CANCELLED_ALREADY','CANCELLED_REPLAY')
    require(booking(cid,DB,'as','r159_released_slot',a2,day,moved_time)=='CREATED','SLOT_RELEASED')
    # Competing case/open and cancel on separate booking: one and only one wins.
    require(booking(cid,DB,'as','r159_case_race_book',a2,day,'14:00')=='CREATED','CASE_RACE_SEED')
    case_bid=integer(cid,DB,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r159_case_race_book';")
    outcomes=in_parallel([
       lambda:racing_case(cid,case_bid),
       lambda:racing_change(cid,'a2','r159_concurrent_cancel',case_bid,'CANCEL',1,None,None,'R138_CASE_ALREADY_OPEN')])
    # See R160 regression tests: the conflict itself must never be treated as success.
    check_case_cancel_outcome(outcomes)
    details=row(cid,'as',case_bid)
    has_case=integer(cid,DB,'as',f'SELECT count(*) FROM car02_r138_qa.service_cases WHERE booking_id={case_bid};')
    require((details['state']=='ACTIVE' and has_case==1 and details['version']==1) or
            (details['state']=='CANCELLED' and has_case==0 and details['version']==2),'CASE_CANCEL_INVARIANT')
    before=digest(cid,DB)
    require(psql(cid,DB,'a2',"DELETE FROM car02_r138_qa.bookings;",False)=='REJECTED','DIRECT_DELETE_DENIED')
    require(psql(cid,DB,'as',"UPDATE car02_r138_qa.bookings SET state='ACTIVE';",False)=='REJECTED','DIRECT_UPDATE_DENIED')
    require(digest(cid,DB)==before,'DENIED_CHANGED_ROWS')
    report={'version':'R159','githubCommit':commit,
      'mode':'DISPOSABLE_PG17_REAL_CONCURRENCY_SYNTHETIC_ONLY','release':'NO_GO','migration':'HOLD',
      'realWorldGatesOpen':12,'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
      'realAuthenticationVerified':False,'realRLSVerified':False,'externalWitnessVerified':False,
      'externalSignatureVerified':False,'independentProductionTest':False,
      'checks':{k:True for k in ('sameKey','sameSlot','crossTenant','competingMove','sameCancel','caseVsCancel','deniedWritesNoMutation')},
      'sameKeyResults':sorted(same),'sameSlotResults':sorted(same_slot),'moveResults':sorted(move_results),
      'cancelResults':sorted(cancels),'caseCancelResults':sorted(outcomes),
      'fixtureRoles':len(ROLES),'originalSqlUnchanged':True,
      'syntheticDb':'car02_r138_qa_ci'}
    report['sha256']=hashlib.sha256(json.dumps(report,sort_keys=True,ensure_ascii=True,separators=(',',':')).encode()).hexdigest()
    verify_release(report)
    target.write_text(json.dumps(report,sort_keys=True,indent=2)+'\n',encoding='ascii')
    verify_release(json.loads(target.read_text(encoding='ascii')))
    print('R159_PG17_CONCURRENT_BOOKING_ATOMICITY_SYNTHETIC_PASS_NO_GO_HOLD')
    return report

def check_case_cancel_outcome(outcomes):
    require(type(outcomes) is list and len(outcomes)==2,'CASE_OUTCOME')
    require(sorted(outcomes) in (['OPENED','REJECTED'], ['CANCELLED','REJECTED']),'CASE_CANCEL_EXCLUSIVITY')
    return True

def main():
    a=argparse.ArgumentParser();a.add_argument('--cid',required=True);a.add_argument('--commit',required=True);
    a.add_argument('--out',default='qa-evidence-r159/r159-concurrency-proof.json')
    o=a.parse_args();probe(o.cid,o.commit,o.out)

if __name__=='__main__': main()

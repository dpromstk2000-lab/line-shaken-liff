#!/usr/bin/env python3
"""R191: PostgreSQL 17 transactional rollback and audit-atomicity regression.

Runs ONLY against the pinned R138B disposable CI fixture; never against retained DB.
RLS/auth in production, external signatures and release authority remain unverified.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
from car02_r138_pg17_lifecycle_qa import ROLES, psql, booking, case, step, integer, lit
from car02_r159_concurrent_booking_isolated import DB, CID, COMMIT, change
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import snapshot, TABLES

OUT='qa-evidence-r191/r191-rollback-atomicity-proof.json'
OPS=('booking','move','cancel','case','report','quote','approve','complete')
EXPECTED=('CREATED','MOVED','CANCELLED','OPENED','REPORT_SAVED','QUOTE_PRESENTED','APPROVED','COMPLETED')
LOCK={
 'version':'R191','mode':'SYNTHETIC_PG17_TRANSACTION_ROLLBACK_AUDIT_ATOMICITY_ONLY',
 'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
 'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
 'realAuthenticationVerified':False,'realRLSVerified':False,
 'externalWitnessVerified':False,'externalSignatureVerified':False,
 'independentProductionTest':False,'fixtureDb':DB,'fixtureRoles':5,
 'allFiveTablesCovered':True,'transactionRollbackVerified':True,
 'auditRollbackVerified':True,'originalR138BUnchanged':True,
 'liveAuthorizationEstablished':False,
}
class RollbackError(AssertionError):pass

def require(ok,code):
    if not ok:raise RollbackError('R191_'+code)

def seal(report):
    core={k:v for k,v in report.items() if k!='sha256'}
    return hashlib.sha256(json.dumps(core,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('ascii')).hexdigest()

def validate_digest(snap):
    require(type(snap) is dict and set(snap)==set(TABLES),'SNAP_FIELDS')
    for item in snap.values():
        require(type(item) is str and re.fullmatch(r'[0-9a-f]{32}',item) is not None,'SNAP_DIGEST')
    return True

def verify_report(proof):
    require(type(proof) is dict and set(proof)==set(LOCK)|{'githubCommit','operations','finalSnapshot','sha256'},'REPORT_FIELDS')
    for k,v in LOCK.items():require(type(proof[k]) is type(v) and proof[k]==v,'GATE_'+k)
    require(type(proof['githubCommit']) is str and COMMIT.fullmatch(proof['githubCommit']) is not None,'COMMIT')
    operations=proof['operations']
    require(type(operations) is dict and set(operations)==set(OPS),'OPERATIONS')
    for key,expect in zip(OPS,EXPECTED):
        data=operations[key]
        require(type(data) is dict and set(data)=={'before','after','rollbackResult'},'OP_FIELDS')
        validate_digest(data['before']);validate_digest(data['after'])
        require(data['before']==data['after'],'ROLLBACK_CHANGED_'+key)
        require(type(data['rollbackResult']) is str and data['rollbackResult']==expect,'ROLLBACK_RESULT_'+key)
    validate_digest(proof['finalSnapshot'])
    require(type(proof['sha256']) is str and re.fullmatch(r'[0-9a-f]{64}',proof['sha256']) is not None
            and proof['sha256']==seal(proof),'HASH')
    return True

def rollback_sql(cid,actor,sql,expected):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CONTAINER')
    require(actor in ROLES and type(sql) is str and sql.startswith('SELECT car02_r138_qa.')
            and sql.endswith(');') and ';' not in sql[:-1],'SQL_ALLOWLIST')
    require(expected in EXPECTED,'EXPECTED')
    result=psql(cid,DB,actor,'BEGIN; '+sql+' ROLLBACK;')
    # Exact sequence of transaction begin, business result, and rollback.
    require(result.splitlines()==['BEGIN',expected,'ROLLBACK'],'TX_RESULT')
    return expected

def sql_book(key,owner,day,clock):
    return 'SELECT car02_r138_qa.claim_booking('+','.join((lit(key),lit(owner),lit(day)+'::date',lit(clock)+'::time'))+');'

def sql_change(key,bid,op,version,day=None,clock=None):
    return 'SELECT car02_r138_qa.change_booking('+','.join((lit(key),str(bid),lit(op),str(version),
        'NULL' if day is None else lit(day)+'::date', 'NULL' if clock is None else lit(clock)+'::time'))+');'

def sql_case(key,bid):
    return 'SELECT car02_r138_qa.open_case('+lit(key)+','+str(bid)+');'

def sql_step(key,cid,op,version,note=None,part=None,labor=None,choice=None):
    return 'SELECT car02_r138_qa.case_step('+','.join(map(lit,(key,cid,op,version,note,part,labor,choice)))+');'

def rollback_check(cid,actor,sql,expect,proof,op):
    require(op in OPS and op not in proof,'DUPLICATE_OP')
    before=snapshot(cid)
    value=rollback_sql(cid,actor,sql,expect)
    after=snapshot(cid)
    require(before==after,'FIVE_TABLE_DRIFT_'+op)
    proof[op]={'before':before,'after':after,'rollbackResult':value}
    return True

def safe_write(proof,dest):
    require(isinstance(dest,Path) and dest.parent.is_dir() and not dest.parent.is_symlink()
            and not dest.exists() and not dest.is_symlink(),'OUTPUT_SCOPE')
    verify_report(proof)
    with dest.open('x',encoding='ascii') as f:
        f.write(json.dumps(proof,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False)+'\n')
    reread=json.loads(dest.read_text(encoding='ascii'))
    require(reread==proof and verify_report(reread),'ROUNDTRIP')
    return dest

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT_ARG')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit and
            os.environ.get('CAR02_RELEASE_LOCK')=='true' and
            os.environ.get('R191_DISPOSABLE_QA')=='yes','ENV_HOLD')
    destination=Path(out)
    require(destination.parent.is_dir() and not destination.parent.is_symlink()
            and not destination.exists(),'DESTINATION')
    first=snapshot(cid)
    require(first==dict.fromkeys(TABLES,hashlib.md5(b'[]').hexdigest()),'EMPTY_START')
    day=next_business_days(1)[0]
    owner=ROLES['a1']; operations={}
    rollback_check(cid,'as',sql_book('r191_rollback_booking',owner,day,'10:00'),'CREATED',operations,'booking')
    require(integer(cid,DB,'as','SELECT count(*) FROM car02_r138_qa.bookings;')==0,'BOOK_NOT_ROLLED_BACK')
    require(booking(cid,DB,'as','r191_committed_booking',owner,day,'10:00')=='CREATED','BOOK_SEED')
    bid=integer(cid,DB,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r191_committed_booking';")
    rollback_check(cid,'a1',sql_change('r191_rollback_move',bid,'MOVE',1,day,'10:30'),'MOVED',operations,'move')
    rollback_check(cid,'a1',sql_change('r191_rollback_cancel',bid,'CANCEL',1),'CANCELLED',operations,'cancel')
    rollback_check(cid,'as',sql_case('r191_rollback_case',bid),'OPENED',operations,'case')
    require(case(cid,DB,'as','r191_committed_case',bid)=='OPENED','CASE_SEED')
    caseid=integer(cid,DB,'as',f'SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={bid};')
    note='Synthetic brake inspection with no customer data'
    rollback_check(cid,'as',sql_step('r191_rollback_report',caseid,'REPORT',1,note=note),'REPORT_SAVED',operations,'report')
    require(step(cid,DB,'as','r191_committed_report',caseid,'REPORT',1,note=note)=='REPORT_SAVED','REPORT_SEED')
    rollback_check(cid,'as',sql_step('r191_rollback_quote',caseid,'QUOTE',2,part=1200,labor=1800),'QUOTE_PRESENTED',operations,'quote')
    require(step(cid,DB,'as','r191_committed_quote',caseid,'QUOTE',2,part=1200,labor=1800)=='QUOTE_PRESENTED','QUOTE_SEED')
    rollback_check(cid,'a1',sql_step('r191_rollback_approval',caseid,'DECIDE',3,choice='APPROVE'),'APPROVED',operations,'approve')
    require(step(cid,DB,'a1','r191_committed_approval',caseid,'DECIDE',3,choice='APPROVE')=='APPROVED','APPROVAL_SEED')
    rollback_check(cid,'as',sql_step('r191_rollback_complete',caseid,'COMPLETE',4),'COMPLETED',operations,'complete')
    require(integer(cid,DB,'as',f'SELECT version FROM car02_r138_qa.service_cases WHERE id={caseid};')==4,'COMPLETION_NOT_COMMITTED')
    require(integer(cid,DB,'as',f'SELECT count(*) FROM car02_r138_qa.case_operations WHERE case_id={caseid};')==3,'OPS_ONCE')
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={caseid} AND action='COMPLETE';")==0,'NO_ROLLBACK_AUDIT')
    report=dict(LOCK,githubCommit=commit,operations=operations,finalSnapshot=snapshot(cid))
    report['sha256']=seal(report)
    safe_write(report,destination)
    print('R191_DISPOSABLE_PG17_EIGHT_OPERATION_ROLLBACK_ATOMICITY_PASS_NO_GO_HOLD')
    return report

def main():
    args=argparse.ArgumentParser()
    args.add_argument('--cid',required=True)
    args.add_argument('--commit',required=True)
    args.add_argument('--out',default=OUT)
    a=args.parse_args()
    probe(a.cid,a.commit,a.out)
if __name__=='__main__':main()

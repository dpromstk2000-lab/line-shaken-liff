#!/usr/bin/env python3
"""R197: disposable PG17 SAVEPOINT recovery after an actual SQL error.

Execute an expected-failing R138B business call, ROLLBACK TO SAVEPOINT,
then a valid call and COMMIT on ONE psql connection. Check final rows,
operation journal and audit parity. Synthetic identities only; NO_GO/HOLD.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from car02_r138_pg17_lifecycle_qa import ROLES, booking, integer, psql
from car02_r159_concurrent_booking_isolated import CID, COMMIT, DB
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import snapshot, TABLES
from car02_r191_transaction_rollback_isolated import sql_book, sql_change, sql_case, sql_step

OUT='qa-evidence-r197/r197-error-recovery-proof.json'
OPS=('booking','move','cancel','case','report','quote','approve','complete')
EXPECTED={
 'booking':('22023','R138_INVALID_BOOKING','CREATED'),
 'move':('22023','R138_INVALID_MOVE_SLOT','MOVED'),
 'cancel':('22023','R138_CANCEL_PAYLOAD','CANCELLED'),
 'case':('42501','R138_BOOKING_NOT_FOUND','OPENED'),
 'report':('22023','R138_REPORT_RULE','REPORT_SAVED'),
 'quote':('22023','R138_QUOTE_RULE','QUOTE_PRESENTED'),
 'approve':('22023','R138_DECISION_RULE','APPROVED'),
 'complete':('40001','R138_STALE_VERSION','COMPLETED'),
}
LOCK={
 'version':'R197','mode':'DISPOSABLE_PG17_ERROR_SAVEPOINT_RECOVERY_ONLY',
 'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
 'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
 'realAuthenticationVerified':False,'realRLSVerified':False,
 'externalWitnessVerified':False,'externalSignatureVerified':False,
 'independentProductionTest':False,'fixtureDb':DB,'fixtureRoles':5,
 'allFiveTablesCovered':True,'originalR138BUnchanged':True,
 'priorR194Unchanged':True,'exactlyOneSuccessfulAuditPerOperation':True,
 'failedCommandsLeaveNoJournal':True,'transactionConnectionRecovered':True,
 'productionReady':False,
}

class RecoveryError(AssertionError): pass

def require(ok, code):
    if not ok: raise RecoveryError('R197_'+code)

def seal(report):
    return hashlib.sha256(json.dumps({k:v for k,v in report.items() if k!='sha256'},
        sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('ascii')).hexdigest()

def validate_snapshot(obj):
    require(type(obj) is dict and set(obj)==set(TABLES),'SNAPSHOT_KEYS')
    require(all(type(h) is str and re.fullmatch('[a-f0-9]{32}',h) for h in obj.values()),'SNAPSHOT_HASH')
    return True

def verify_report(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','operations','finalSnapshot','sha256'},'REPORT_KEYS')
    for k,v in LOCK.items(): require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']) is not None,'COMMIT')
    ops=doc['operations']
    require(type(ops) is dict and set(ops)==set(OPS),'OPERATION_KEYS')
    for k,(state,reason,success) in EXPECTED.items():
        item=ops[k]
        require(type(item) is dict and set(item)=={'rejectedSqlstate','rejectedReason','committedResult',
                'before','after','failedKeyCount','successfulKeyCount','auditCount'},'OP_FIELDS_'+k)
        require(type(item['rejectedSqlstate']) is str and item['rejectedSqlstate']==state,'SQLSTATE_'+k)
        require(type(item['rejectedReason']) is str and item['rejectedReason']==reason,'REASON_'+k)
        require(type(item['committedResult']) is str and item['committedResult']==success,'COMMIT_RESULT_'+k)
        validate_snapshot(item['before']);validate_snapshot(item['after'])
        require(item['before']!=item['after'],'NO_COMMITTED_CHANGE_'+k)
        for f,v in [('failedKeyCount',0),('successfulKeyCount',1),('auditCount',1)]:
            require(type(item[f]) is int and item[f]==v,'COUNT_'+k+'_'+f)
    validate_snapshot(doc['finalSnapshot'])
    require(doc['finalSnapshot']==ops['complete']['after'],'FINAL_SNAPSHOT')
    require(type(doc['sha256']) is str and re.fullmatch('[a-f0-9]{64}',doc['sha256']) is not None
            and doc['sha256']==seal(doc),'DIGEST')
    return True

def allowed_call(sql):
    require(type(sql) is str and sql.startswith('SELECT car02_r138_qa.') and sql.endswith(');')
            and sql.count(';')==1 and re.fullmatch(
               r'SELECT car02_r138_qa\.(claim_booking|change_booking|open_case|case_step)\(.+\);',sql,re.S) is not None,
            'SQL_FUNCTION_ALLOWLIST')
    return sql

def execute_recovery(cid,actor,bad_sql,good_sql,error_code,error_reason,good_result):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(actor in ROLES and type(error_code) is str and re.fullmatch('[0-9A-Z]{5}',error_code)
            and error_reason in {x[1] for x in EXPECTED.values()} and
            good_result in {x[2] for x in EXPECTED.values()},'ARGUMENTS')
    allowed_call(bad_sql);allowed_call(good_sql)
    script='\n'.join(('BEGIN;','SAVEPOINT r197_guard;',bad_sql,
        'ROLLBACK TO SAVEPOINT r197_guard;',good_sql,
        'RELEASE SAVEPOINT r197_guard;','COMMIT;',''))
    cmd=['docker','exec','-i',cid,'env','PGPASSWORD=r138-throwaway-only',
         'psql','-h','127.0.0.1','-X','-A','-t','-v','ON_ERROR_STOP=off',
         '-v','VERBOSITY=verbose','-U',ROLES[actor],'-d',DB,'-f','-']
    run=subprocess.run(cmd,input=script,capture_output=True,text=True,timeout=40)
    require(run.returncode==0,'PSQL_RETURN')
    lines=[line.strip() for line in run.stdout.splitlines() if line.strip()]
    require(lines==['BEGIN','SAVEPOINT','ROLLBACK',good_result,'RELEASE','COMMIT'],'TX_SEQUENCE')
    errors=re.findall(r'ERROR:\s*([0-9A-Z]{5}):\s*([^\r\n]+)',run.stderr)
    require(len(errors)==1,'ERROR_COUNT')
    require(errors[0][0]==error_code and re.match(re.escape(error_reason)+r'\b',errors[0][1])
            is not None,'ERROR_IDENTITY')
    return good_result

def save_report(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
            and not path.exists() and not path.is_symlink(),'OUTPUT_SCOPE')
    verify_report(doc)
    with path.open('x',encoding='ascii') as fh:
        fh.write(json.dumps(doc,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False)+'\n')
    decoded=json.loads(path.read_text(encoding='ascii'))
    require(decoded==doc and verify_report(decoded),'WRITE_ROUNDTRIP')
    return path

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT_ARG')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit and
            os.environ.get('CAR02_RELEASE_LOCK')=='true' and
            os.environ.get('R197_DISPOSABLE_QA')=='yes','ENV_LOCK')
    dest=Path(out)
    require(dest.parent.is_dir() and not dest.parent.is_symlink()
            and not dest.exists(),'DESTINATION')
    start=snapshot(cid)
    require(start==dict.fromkeys(TABLES,hashlib.md5(b'[]').hexdigest()),'FIXTURE_NOT_EMPTY')
    day=next_business_days(1)[0]
    owner=ROLES['a1']
    operations={}
    def check(op,actor,bad,good,bad_key,good_key,table,action,entity):
        reason=EXPECTED[op]
        before=snapshot(cid)
        result=execute_recovery(cid,actor,bad,good,*reason)
        after=snapshot(cid)
        require(before!=after,'SUCCESS_NOT_COMMITTED_'+op)
        bad_count=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.{table} WHERE request_key='{bad_key}';")
        ok_count=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.{table} WHERE request_key='{good_key}';")
        audits=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE action='{action}' AND entity_id={entity};")
        require(bad_count==0 and ok_count==1 and audits==1,'HISTORY_'+op)
        operations[op]=dict(rejectedSqlstate=reason[0],rejectedReason=reason[1],
             committedResult=result,before=before,after=after,failedKeyCount=bad_count,
             successfulKeyCount=ok_count,auditCount=audits)
    # Booking id is allocated after the valid write; check the audit in this first step separately.
    before=snapshot(cid)
    result=execute_recovery(cid,'as',sql_book('r197_bad_book',owner,day,'10:15'),
        sql_book('r197_good_book',owner,day,'10:00'),*EXPECTED['booking'])
    after=snapshot(cid)
    bid=integer(cid,DB,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r197_good_book';")
    failed=integer(cid,DB,'as',"SELECT count(*) FROM car02_r138_qa.bookings WHERE request_key='r197_bad_book';")
    successful=integer(cid,DB,'as',"SELECT count(*) FROM car02_r138_qa.bookings WHERE request_key='r197_good_book';")
    audits=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE action='BOOKED' AND entity_id={bid};")
    require(before!=after and failed==0 and successful==1 and audits==1,'BOOK_HISTORY')
    operations['booking']=dict(rejectedSqlstate='22023',rejectedReason='R138_INVALID_BOOKING',
             committedResult=result,before=before,after=after,failedKeyCount=failed,
             successfulKeyCount=successful,auditCount=audits)
    check('move','a1',sql_change('r197_bad_move',bid,'MOVE',1,day,'10:15'),
          sql_change('r197_good_move',bid,'MOVE',1,day,'10:30'),
          'r197_bad_move','r197_good_move','booking_operations','MOVE',bid)
    check('cancel','a1',sql_change('r197_bad_cancel',bid,'CANCEL',2,day,'10:30'),
          sql_change('r197_good_cancel',bid,'CANCEL',2),
          'r197_bad_cancel','r197_good_cancel','booking_operations','CANCEL',bid)
    require(booking(cid,DB,'as','r197_case_booking',owner,day,'11:00')=='CREATED','CASE_SEED')
    case_booking=integer(cid,DB,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r197_case_booking';")
    before=snapshot(cid)
    result=execute_recovery(cid,'as',sql_case('r197_bad_case',999999999),
       sql_case('r197_good_case',case_booking),*EXPECTED['case'])
    after=snapshot(cid)
    case_id=integer(cid,DB,'as',f'SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={case_booking};')
    bad=integer(cid,DB,'as',"SELECT count(*) FROM car02_r138_qa.service_cases WHERE request_key='r197_bad_case';")
    good=integer(cid,DB,'as',"SELECT count(*) FROM car02_r138_qa.service_cases WHERE request_key='r197_good_case';")
    audits=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE action='CASE_OPENED' AND entity_id={case_id};")
    require(before!=after and bad==0 and good==1 and audits==1,'CASE_HISTORY')
    operations['case']=dict(rejectedSqlstate='42501',rejectedReason='R138_BOOKING_NOT_FOUND',
        committedResult=result,before=before,after=after,failedKeyCount=bad,
        successfulKeyCount=good,auditCount=audits)
    note='Synthetic inspection report without customer details'
    check('report','as',sql_step('r197_bad_report',case_id,'REPORT',1,note='x'),
          sql_step('r197_good_report',case_id,'REPORT',1,note=note),
          'r197_bad_report','r197_good_report','case_operations','REPORT',case_id)
    check('quote','as',sql_step('r197_bad_quote',case_id,'QUOTE',2,part=0,labor=0),
          sql_step('r197_good_quote',case_id,'QUOTE',2,part=1200,labor=800),
          'r197_bad_quote','r197_good_quote','case_operations','QUOTE',case_id)
    check('approve','a1',sql_step('r197_bad_approve',case_id,'DECIDE',3,choice='UNKNOWN'),
          sql_step('r197_good_approve',case_id,'DECIDE',3,choice='APPROVE'),
          'r197_bad_approve','r197_good_approve','case_operations','DECIDE',case_id)
    check('complete','as',sql_step('r197_bad_complete',case_id,'COMPLETE',3),
          sql_step('r197_good_complete',case_id,'COMPLETE',4),
          'r197_bad_complete','r197_good_complete','case_operations','COMPLETE',case_id)
    require(psql(cid,DB,'as',f'SELECT state FROM car02_r138_qa.service_cases WHERE id={case_id};')=='COMPLETED','FINAL_STATE')
    require(psql(cid,DB,'as',f'SELECT state FROM car02_r138_qa.bookings WHERE id={bid};')=='CANCELLED','CANCELLED_STATE')
    doc=dict(LOCK,githubCommit=commit,operations=operations,finalSnapshot=snapshot(cid))
    doc['sha256']=seal(doc)
    save_report(doc,dest)
    print('R197_DISPOSABLE_PG17_EIGHT_ERROR_SAVEPOINT_RECOVERIES_PASS_NO_GO_HOLD')
    return doc

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--cid',required=True)
    p.add_argument('--commit',required=True)
    p.add_argument('--out',default=OUT)
    a=p.parse_args();probe(a.cid,a.commit,a.out)

if __name__=='__main__': main()

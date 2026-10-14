#!/usr/bin/env python3
"""R194: disposable PG17 SAVEPOINT atomicity; synthetic-only, never deploy.

Each of eight R138B operations is run inside a SAVEPOINT, rolled back to the
SAVEPOINT, then COMMITted. Two additional *partial* rollbacks preserve the
preceding valid operation while discarding the later operation and its audit.
No retained database, real identity, or production readiness is tested.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
from car02_r138_pg17_lifecycle_qa import ROLES, psql, booking, case, step, integer
from car02_r159_concurrent_booking_isolated import DB, CID, COMMIT
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import snapshot, TABLES
from car02_r191_transaction_rollback_isolated import OPS, EXPECTED, sql_book, sql_change, sql_case, sql_step

OUT='qa-evidence-r194/r194-savepoint-atomicity.json'
STEPS=('moveThenCancel','reportThenQuote')
LOCK={
 'version':'R194','mode':'DISPOSABLE_PG17_SAVEPOINT_PARTIAL_ROLLBACK_ONLY',
 'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
 'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
 'realAuthenticationVerified':False,'realRLSVerified':False,
 'externalWitnessVerified':False,'externalSignatureVerified':False,
 'independentProductionTest':False,'fixtureDb':DB,'fixtureRoles':5,
 'allFiveTablesCovered':True,'priorR191SourceUnchanged':True,
 'originalR138BUnchanged':True,'savepointEightOperationsVerified':True,
 'partialCommittedPredecessorVerified':True,'partialRolledBackAuditAbsent':True,
 'productionReady':False,
}
class SavepointError(AssertionError):pass

def require(ok,code):
    if not ok:raise SavepointError('R194_'+code)

def seal(report):
    core={k:v for k,v in report.items() if k!='sha256'}
    return hashlib.sha256(json.dumps(core,sort_keys=True,separators=(',',':'),
        ensure_ascii=True,allow_nan=False).encode('ascii')).hexdigest()

def digest_ok(snap):
    require(type(snap) is dict and set(snap)==set(TABLES),'TABLES')
    require(all(type(x) is str and re.fullmatch('[0-9a-f]{32}',x) for x in snap.values()),'DIGESTS')
    return True

def verify_report(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','savepointOperations',
        'partialRollbacks','finalSnapshot','sha256'},'FIELDS')
    for key,value in LOCK.items():
        require(type(doc[key]) is type(value) and doc[key]==value,'LOCK_'+key)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']) is not None,'COMMIT')
    ops=doc['savepointOperations']
    require(type(ops) is dict and set(ops)==set(OPS),'OPS')
    for operation,result in zip(OPS,EXPECTED):
        x=ops[operation]
        require(type(x) is dict and set(x)=={'before','after','result'},'OP_FIELDS')
        digest_ok(x['before']);digest_ok(x['after'])
        require(x['before']==x['after'],'SAVEPOINT_MUTATION_'+operation)
        require(type(x['result']) is str and x['result']==result,'RESULT_'+operation)
    partial=doc['partialRollbacks']
    require(type(partial) is dict and set(partial)==set(STEPS),'PARTIAL_FIELDS')
    for name,expected in [('moveThenCancel',('MOVED','CANCELLED')),
                          ('reportThenQuote',('REPORT_SAVED','QUOTE_PRESENTED'))]:
        x=partial[name]
        require(type(x) is dict and set(x)=={'committed','undone','unchangedAuditCount',
                'preservedVersion','preservedState'},'PARTIAL_SHAPE')
        require(type(x['committed']) is str and x['committed']==expected[0] and
                type(x['undone']) is str and x['undone']==expected[1],'PARTIAL_RESULTS')
        require(type(x['unchangedAuditCount']) is int and x['unchangedAuditCount']==0,'PARTIAL_AUDIT')
        require(type(x['preservedVersion']) is int and x['preservedVersion']==2,'PARTIAL_VERSION')
        require(type(x['preservedState']) is str and x['preservedState']==
                ('ACTIVE' if name=='moveThenCancel' else 'REPORTED'),'PARTIAL_STATE')
    digest_ok(doc['finalSnapshot'])
    require(type(doc['sha256']) is str and re.fullmatch('[0-9a-f]{64}',doc['sha256']) is not None
            and doc['sha256']==seal(doc),'SHA')
    return True

def guard_sql(sql):
    require(type(sql) is str and sql.startswith('SELECT car02_r138_qa.') and
            sql.endswith(');') and sql.count(';')==1 and
            re.match(r'^SELECT car02_r138_qa\.(claim_booking|change_booking|open_case|case_step)\(',sql),
            'SQL_SCOPE')
    return sql

def transaction_sql(cid,actor,sql,expected):
    guard_sql(sql)
    require(expected in EXPECTED,'EXPECTED')
    require(type(cid) is str and CID.fullmatch(cid) is not None and actor in ROLES,'ACTOR')
    cmd='BEGIN; SAVEPOINT r194_guard; '+sql+' ROLLBACK TO SAVEPOINT r194_guard; COMMIT;'
    reply=psql(cid,DB,actor,cmd)
    require(reply.splitlines()==['BEGIN','SAVEPOINT',expected,'ROLLBACK','COMMIT'],'SAVEPOINT_SEQUENCE')
    return expected

def check_one(cid,actor,sql,expected,operation,results):
    require(operation in OPS and operation not in results,'OP_NAME')
    before=snapshot(cid)
    reply=transaction_sql(cid,actor,sql,expected)
    after=snapshot(cid)
    require(before==after,'DRIFT_'+operation)
    results[operation]={'before':before,'after':after,'result':reply}

def partial_transaction(cid,actor,first,first_result,second,second_result):
    guard_sql(first);guard_sql(second)
    require(first_result in EXPECTED and second_result in EXPECTED,'RESULTS')
    require(type(cid) is str and CID.fullmatch(cid) is not None and actor in ROLES,'ACTOR')
    cmd='BEGIN; '+first+' SAVEPOINT r194_guard; '+second+' ROLLBACK TO SAVEPOINT r194_guard; COMMIT;'
    reply=psql(cid,DB,actor,cmd)
    require(reply.splitlines()==['BEGIN',first_result,'SAVEPOINT',second_result,'ROLLBACK','COMMIT'],
            'PARTIAL_SEQUENCE')
    return True

def safe_write(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
            and not path.exists() and not path.is_symlink(),'OUTPUT_PATH')
    verify_report(doc)
    with path.open('x',encoding='ascii') as f:
        f.write(json.dumps(doc,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False)+'\n')
    reread=json.loads(path.read_text(encoding='ascii'))
    require(reread==doc and verify_report(reread),'ROUNDTRIP')
    return path

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT_ARG')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit and
            os.environ.get('CAR02_RELEASE_LOCK')=='true' and
            os.environ.get('R194_DISPOSABLE_QA')=='yes','ENV_LOCK')
    target=Path(out)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'DEST')
    initial=snapshot(cid)
    require(initial==dict.fromkeys(TABLES,hashlib.md5(b'[]').hexdigest()),'EMPTY_DB')
    day=next_business_days(1)[0]
    owner=ROLES['a1']; ops={};partial={}
    check_one(cid,'as',sql_book('r194_savepoint_booking',owner,day,'10:00'),'CREATED','booking',ops)
    require(booking(cid,DB,'as','r194_committed_booking',owner,day,'10:00')=='CREATED','BOOK_SEED')
    bid=integer(cid,DB,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r194_committed_booking';")
    check_one(cid,'a1',sql_change('r194_savepoint_move',bid,'MOVE',1,day,'10:30'),'MOVED','move',ops)
    check_one(cid,'a1',sql_change('r194_savepoint_cancel',bid,'CANCEL',1),'CANCELLED','cancel',ops)
    partial_transaction(cid,'a1',sql_change('r194_commit_move',bid,'MOVE',1,day,'10:30'),'MOVED',
             sql_change('r194_undo_cancel',bid,'CANCEL',2),'CANCELLED')
    require(integer(cid,DB,'as',f'SELECT version FROM car02_r138_qa.bookings WHERE id={bid};')==2,'MOVE_VERSION')
    require(psql(cid,DB,'a1',f'SELECT state FROM car02_r138_qa.bookings WHERE id={bid};')=='ACTIVE','MOVE_ACTIVE')
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.booking_operations WHERE booking_id={bid} AND op='CANCEL';")==0,'CANCEL_JOURNAL_ROLLBACK')
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={bid} AND action='CANCEL';")==0,'CANCEL_AUDIT_ROLLBACK')
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.booking_operations WHERE booking_id={bid} AND op='MOVE';")==1,'MOVE_JOURNAL_ONCE')
    partial['moveThenCancel']={'committed':'MOVED','undone':'CANCELLED','unchangedAuditCount':0,
                              'preservedVersion':2,'preservedState':'ACTIVE'}
    check_one(cid,'as',sql_case('r194_savepoint_case',bid),'OPENED','case',ops)
    require(case(cid,DB,'as','r194_committed_case',bid)=='OPENED','CASE_SEED')
    caseid=integer(cid,DB,'as',f'SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={bid};')
    note='Synthetic service report without real customer data'
    check_one(cid,'as',sql_step('r194_savepoint_report',caseid,'REPORT',1,note=note),'REPORT_SAVED','report',ops)
    partial_transaction(cid,'as',sql_step('r194_commit_report',caseid,'REPORT',1,note=note),'REPORT_SAVED',
             sql_step('r194_undo_quote',caseid,'QUOTE',2,part=1100,labor=1200),'QUOTE_PRESENTED')
    require(integer(cid,DB,'as',f'SELECT version FROM car02_r138_qa.service_cases WHERE id={caseid};')==2,'REPORT_VERSION')
    require(psql(cid,DB,'as',f'SELECT state FROM car02_r138_qa.service_cases WHERE id={caseid};')=='REPORTED','REPORT_STATE')
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.case_operations WHERE case_id={caseid} AND op='REPORT';")==1,'REPORT_JOURNAL_ONCE')
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.case_operations WHERE case_id={caseid} AND op='QUOTE';")==0,'QUOTE_JOURNAL_ROLLBACK')
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={caseid} AND action='QUOTE';")==0,'QUOTE_AUDIT_ROLLBACK')
    partial['reportThenQuote']={'committed':'REPORT_SAVED','undone':'QUOTE_PRESENTED',
            'unchangedAuditCount':0,'preservedVersion':2,'preservedState':'REPORTED'}
    check_one(cid,'as',sql_step('r194_savepoint_quote',caseid,'QUOTE',2,part=1000,labor=1700),'QUOTE_PRESENTED','quote',ops)
    require(step(cid,DB,'as','r194_committed_quote',caseid,'QUOTE',2,part=1000,labor=1700)=='QUOTE_PRESENTED','QUOTE_SEED')
    check_one(cid,'a1',sql_step('r194_savepoint_decide',caseid,'DECIDE',3,choice='APPROVE'),'APPROVED','approve',ops)
    require(step(cid,DB,'a1','r194_committed_decide',caseid,'DECIDE',3,choice='APPROVE')=='APPROVED','DECISION_SEED')
    check_one(cid,'as',sql_step('r194_savepoint_complete',caseid,'COMPLETE',4),'COMPLETED','complete',ops)
    require(integer(cid,DB,'as',f'SELECT version FROM car02_r138_qa.service_cases WHERE id={caseid};')==4,'COMPLETE_ROLLBACK')
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={caseid} AND action='COMPLETE';")==0,'COMPLETE_AUDIT_ROLLBACK')
    doc=dict(LOCK,githubCommit=commit,savepointOperations=ops,partialRollbacks=partial,finalSnapshot=snapshot(cid))
    doc['sha256']=seal(doc)
    safe_write(doc,target)
    print('R194_DISPOSABLE_PG17_SAVEPOINT_EIGHT_AND_PARTIAL_ATOMICITY_PASS_NO_GO_HOLD')
    return doc

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--cid',required=True);parser.add_argument('--commit',required=True)
    parser.add_argument('--out',default=OUT)
    args=parser.parse_args();probe(args.cid,args.commit,args.out)
if __name__=='__main__':main()

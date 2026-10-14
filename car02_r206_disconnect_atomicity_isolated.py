#!/usr/bin/env python3
"""R206: disposable PG17 client disconnect before COMMIT -> rollback -> exact retry.

Only R138B's throwaway CI PostgreSQL 17 and synthetic roles. The backend is
terminated while pg_sleep is running AFTER a successful business function in an
open transaction. No retained DB, secrets, deployment, or real customer data.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

from car02_r138_pg17_lifecycle_qa import ROLES, booking, case, step, integer, psql
from car02_r159_concurrent_booking_isolated import DB, CID, COMMIT, change
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import TABLES, snapshot
from car02_r191_transaction_rollback_isolated import sql_book, sql_change, sql_step

OUT='qa-evidence-r206/r206-disconnect-atomicity-proof.json'
SCENARIOS=('booking','move','quote','decide')
ANSWERS={'booking':'CREATED','move':'MOVED','quote':'QUOTE_PRESENTED','decide':'APPROVED'}
ACTIONS={'booking':'BOOKED','move':'MOVE','quote':'QUOTE','decide':'DECIDE'}
SQLSTATE='57P01'
LOCK={
 'version':'R206', 'mode':'DISPOSABLE_PG17_BACKEND_TERMINATION_ATOMIC_RETRY_ONLY',
 'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
 'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
 'realAuthenticationVerified':False,'realRLSVerified':False,
 'externalWitnessVerified':False,'externalSignatureVerified':False,
 'independentProductionTest':False,'productionReady':False,
 'fixtureDb':DB,'fixtureRoles':5,'allFiveTablesCovered':True,
 'disconnectSQLSTATE':'57P01','noUncommittedBusinessRows':True,
 'retryExactlyOnce':True,'sourceR138BUnchanged':True,'priorR203Unchanged':True,
}

class DisconnectQAError(AssertionError): pass

def require(ok,code):
    if not ok:raise DisconnectQAError('R206_'+code)

def seal(doc):
    core={k:v for k,v in doc.items() if k!='sha256'}
    return hashlib.sha256(json.dumps(core,sort_keys=True,separators=(',',':'),
                ensure_ascii=True,allow_nan=False).encode('ascii')).hexdigest()

def validate_snap(data):
    require(type(data) is dict and set(data)==set(TABLES),'SNAP_FIELDS')
    require(all(type(x) is str and re.fullmatch('[0-9a-f]{32}',x) is not None
                for x in data.values()),'SNAP_VALUES')
    return True

def verify_report(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','scenarios','finalSnapshot','sha256'},'FIELDS')
    for k,v in LOCK.items():require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']) is not None,'COMMIT')
    records=doc['scenarios']
    require(type(records) is dict and set(records)==set(SCENARIOS),'SCENARIO_FIELDS')
    previous=None
    for name in SCENARIOS:
        entry=records[name]
        require(type(entry) is dict and set(entry)=={'before','afterTermination','afterRetry',
            'disconnectSqlstate','retryResult','operationRows','auditRows'},'CASE_FIELDS_'+name)
        for phase in ('before','afterTermination','afterRetry'):validate_snap(entry[phase])
        if previous is not None:require(entry['before']==previous,'SNAPSHOT_CHAIN_'+name)
        previous=entry['afterRetry']
        require(entry['before']==entry['afterTermination'],'UNCOMMITTED_ROWS_'+name)
        require(entry['afterTermination']!=entry['afterRetry'],'RETRY_NO_COMMIT_'+name)
        require(type(entry['disconnectSqlstate']) is str and entry['disconnectSqlstate']==SQLSTATE,'STATE_'+name)
        require(type(entry['retryResult']) is str and entry['retryResult']==ANSWERS[name],'RESULT_'+name)
        require(type(entry['operationRows']) is int and entry['operationRows']==(0 if name=='booking' else 1),'OP_COUNT_'+name)
        require(type(entry['auditRows']) is int and entry['auditRows']==1,'AUDIT_COUNT_'+name)
    validate_snap(doc['finalSnapshot'])
    require(doc['finalSnapshot']==records['decide']['afterRetry'],'FINAL_SNAPSHOT')
    require(type(doc['sha256']) is str and re.fullmatch('[0-9a-f]{64}',doc['sha256']) is not None
            and doc['sha256']==seal(doc),'HASH')
    return True

def admin(cid,query):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(query) is str and query.startswith('SELECT ') and ';' not in query,'ADMIN_SQL')
    result=subprocess.run(['docker','exec','-i',cid,'psql','-X','-A','-t','-v','ON_ERROR_STOP=1',
        '-U','postgres','-d',DB,'-c',query],capture_output=True,text=True,timeout=10)
    require(result.returncode==0,'ADMIN_ERROR')
    return result.stdout.strip()

def client(cid,actor,name,query):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CLIENT_CID')
    require(actor in ROLES and name in SCENARIOS,'CLIENT_IDENTITY')
    require(type(query) is str and query.startswith('SELECT car02_r138_qa.')
            and re.fullmatch(r'SELECT car02_r138_qa\.(claim_booking|change_booking|case_step)\(.+\);',query,re.S)
            and query.count(';')==1,'CLIENT_QUERY')
    # pg_sleep is reached only after the business operation succeeded.
    program=(f"SET application_name='r206_kill_{name}'; BEGIN; "
             f"{query} SELECT pg_sleep(30); COMMIT;")
    return subprocess.Popen(['docker','exec','-i',cid,'env','PGPASSWORD=r138-throwaway-only',
         'psql','-h','127.0.0.1','-X','-A','-t','-v','ON_ERROR_STOP=1',
         '-v','VERBOSITY=sqlstate','-U',ROLES[actor],'-d',DB,'-c',program],
         stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)

def await_sleep(cid,name,proc,timeout=10):
    require(name in SCENARIOS and timeout>0 and timeout<=15,'WAIT_ARGS')
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        require(proc.poll() is None,'CLIENT_FINISHED_EARLY')
        pid=admin(cid,"SELECT pid FROM pg_stat_activity WHERE datname=current_database() "
          f"AND application_name='r206_kill_{name}' AND state='active' "
          "AND wait_event_type='Timeout' AND wait_event='PgSleep'")
        if pid.isdecimal():return int(pid)
        time.sleep(0.15)
    raise DisconnectQAError('R206_NO_SLEEP_BARRIER_'+name)

def terminate(cid,name,actor,query):
    proc=client(cid,actor,name,query)
    try:
        pid=await_sleep(cid,name,proc)
        require(admin(cid,f'SELECT pg_terminate_backend({pid})')=='t','TERMINATION_COMMAND')
        stdout,stderr=proc.communicate(timeout=10)
        require(proc.returncode!=0,'UNEXPECTED_COMMIT')
        require(re.search(r'(?:FATAL|ERROR):\s*57P01\b',stderr) is not None,'WRONG_DISCONNECT_SQLSTATE')
        require('COMMIT' not in stdout.splitlines(),'COMMIT_AFTER_DISCONNECT')
        return SQLSTATE
    finally:
        if proc.poll() is None:
            proc.kill();proc.communicate(timeout=5)

def safe_write(doc,target):
    require(isinstance(target,Path) and target.parent.is_dir() and not target.parent.is_symlink()
            and not target.exists() and not target.is_symlink(),'OUTPUT_PATH')
    verify_report(doc)
    with target.open('x',encoding='ascii') as f:
        f.write(json.dumps(doc,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False)+'\n')
    reread=json.loads(target.read_text(encoding='ascii'))
    require(reread==doc and verify_report(reread),'ROUNDTRIP')
    return target

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit
        and os.environ.get('CAR02_RELEASE_LOCK')=='true'
        and os.environ.get('R206_DISPOSABLE_QA')=='yes','ENV_LOCK')
    target=Path(out)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'OUT_EXISTS')
    initial=snapshot(cid)
    require(initial==dict.fromkeys(TABLES,hashlib.md5(b'[]').hexdigest()),'NOT_EMPTY')
    day=next_business_days(1)[0]
    owner=ROLES['a1']
    require(booking(cid,DB,'as','r206_move_seed',owner,day,'10:00')=='CREATED','SEED_MOVE')
    require(booking(cid,DB,'as','r206_quote_seed',owner,day,'11:00')=='CREATED','SEED_QUOTE')
    require(booking(cid,DB,'as','r206_decide_seed',owner,day,'12:00')=='CREATED','SEED_DECIDE')
    bids={name:integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r206_{name}_seed';")
          for name in ('move','quote','decide')}
    for name in ('quote','decide'):
        require(case(cid,DB,'as',f'r206_case_{name}',bids[name])=='OPENED','SEED_CASE_'+name)
    caseids={name:integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={bids[name]};")
             for name in ('quote','decide')}
    note='Synthetic disconnect atomicity test only'
    for name in ('quote','decide'):
        require(step(cid,DB,'as',f'r206_report_{name}',caseids[name],'REPORT',1,note=note)=='REPORT_SAVED','SEED_REPORT_'+name)
    require(step(cid,DB,'as','r206_quote_for_decide',caseids['decide'],'QUOTE',2,part=1700,labor=600)=='QUOTE_PRESENTED','SEED_DECISION_QUOTE')
    keys={name:f'r206_terminate_{name}' for name in SCENARIOS}
    ids={'move':bids['move'],'quote':caseids['quote'],'decide':caseids['decide']}
    specs={
        'booking':('as',sql_book(keys['booking'],owner,day,'13:00'),
                   lambda:booking(cid,DB,'as',keys['booking'],owner,day,'13:00'),None,None),
        'move':('a1',sql_change(keys['move'],ids['move'],'MOVE',1,day,'10:30'),
                   lambda:change(cid,'a1',keys['move'],ids['move'],'MOVE',1,day,'10:30'),'booking_operations',ids['move']),
        'quote':('as',sql_step(keys['quote'],ids['quote'],'QUOTE',2,part=950,labor=650),
                   lambda:step(cid,DB,'as',keys['quote'],ids['quote'],'QUOTE',2,part=950,labor=650),'case_operations',ids['quote']),
        'decide':('a1',sql_step(keys['decide'],ids['decide'],'DECIDE',3,choice='APPROVE'),
                   lambda:step(cid,DB,'a1',keys['decide'],ids['decide'],'DECIDE',3,choice='APPROVE'),'case_operations',ids['decide']),
    }
    records={}
    for name in SCENARIOS:
        actor,sql,retry,op_table,entity=specs[name]
        before=snapshot(cid)
        state=terminate(cid,name,actor,sql)
        after=snapshot(cid)
        require(before==after,'UNCOMMITTED_CHANGED_'+name)
        answer=retry()
        require(answer==ANSWERS[name],'RETRY_FAILED_'+name)
        if name=='booking':
            entity=integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='{keys[name]}';")
            op_rows=0
        else:
            op_rows=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.{op_table} WHERE request_key='{keys[name]}';")
        audit_rows=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={entity} AND action='{ACTIONS[name]}';")
        require(op_rows==(0 if name=='booking' else 1) and audit_rows==1,'EXACTLY_ONCE_'+name)
        after_retry=snapshot(cid)
        require(after_retry!=after,'RETRY_NO_WRITE_'+name)
        records[name]=dict(before=before,afterTermination=after,afterRetry=after_retry,
                          disconnectSqlstate=state,retryResult=answer,operationRows=op_rows,auditRows=audit_rows)
    require(psql(cid,DB,'as',f"SELECT state FROM car02_r138_qa.service_cases WHERE id={ids['decide']};")=='APPROVED','APPROVED_STATE')
    doc=dict(LOCK,githubCommit=commit,scenarios=records,finalSnapshot=snapshot(cid))
    doc['sha256']=seal(doc)
    safe_write(doc,target)
    print('R206_DISPOSABLE_PG17_FOUR_BACKEND_TERMINATIONS_ATOMIC_RETRIES_PASS_NO_GO_HOLD')
    return doc

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--cid',required=True);parser.add_argument('--commit',required=True)
    parser.add_argument('--out',default=OUT)
    args=parser.parse_args();probe(args.cid,args.commit,args.out)
if __name__=='__main__':main()

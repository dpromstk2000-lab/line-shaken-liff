#!/usr/bin/env python3
"""R200: PostgreSQL 17 row lock timeout -> rollback -> exact single retry.

Exclusively for disposable R138B CI DB and five synthetic roles. This is not
production permission or readiness evidence. NO_GO / HOLD must remain set.
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
from car02_r191_transaction_rollback_isolated import sql_change, sql_step

OUT = 'qa-evidence-r200/r200-lock-timeout-proof.json'
SCENARIOS = ('move','cancel','quote','decide')
ANSWERS = {'move':'MOVED','cancel':'CANCELLED','quote':'QUOTE_PRESENTED','decide':'APPROVED'}
LOCK = {
 'version':'R200', 'mode':'DISPOSABLE_PG17_LOCK_TIMEOUT_RETRY_ONLY',
 'release':'NO_GO', 'migration':'HOLD', 'realWorldGatesOpen':12,
 'syntheticOnly':True, 'productionTouched':False, 'productionAuthorized':False,
 'realAuthenticationVerified':False, 'realRLSVerified':False,
 'externalWitnessVerified':False, 'externalSignatureVerified':False,
 'independentProductionTest':False, 'fixtureDb':DB, 'fixtureRoles':5,
 'fiveTablesCovered':True, 'timeoutSQLSTATE':'55P03',
 'timeoutLeavesNoBusinessWrites':True, 'retryAuditExactlyOnce':True,
 'sourceR138BUnchanged':True, 'priorR197Unchanged':True, 'productionReady':False,
}
class LockTimeoutError(AssertionError): pass

def require(ok, key):
    if not ok: raise LockTimeoutError('R200_'+key)

def seal(doc):
    core={k:v for k,v in doc.items() if k!='sha256'}
    return hashlib.sha256(json.dumps(core,sort_keys=True,ensure_ascii=True,
               separators=(',',':'),allow_nan=False).encode('ascii')).hexdigest()

def validate_snapshot(s):
    require(type(s) is dict and set(s)==set(TABLES),'SNAPSHOT_SHAPE')
    require(all(type(v) is str and re.fullmatch('[a-f0-9]{32}',v) is not None
                for v in s.values()),'SNAPSHOT_FORMAT')
    return True

def verify_report(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','scenarios','finalSnapshot','sha256'},'FIELDS')
    for k,v in LOCK.items(): require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']) is not None,'COMMIT')
    scenarios=doc['scenarios']
    require(type(scenarios) is dict and set(scenarios)==set(SCENARIOS),'SCENARIOS')
    for name in SCENARIOS:
        s=scenarios[name]
        require(type(s) is dict and set(s)=={'before','afterTimeout','afterRetry','timeoutSqlstate',
                    'retryResult','operationRows','auditRows'},'CASE_FIELDS_'+name)
        for stage in ('before','afterTimeout','afterRetry'): validate_snapshot(s[stage])
        require(s['before']==s['afterTimeout'],'TIMEOUT_MUTATION_'+name)
        require(s['afterTimeout']!=s['afterRetry'],'RETRY_NO_WRITE_'+name)
        require(type(s['timeoutSqlstate']) is str and s['timeoutSqlstate']=='55P03','SQLSTATE_'+name)
        require(type(s['retryResult']) is str and s['retryResult']==ANSWERS[name],'RESULT_'+name)
        require(type(s['operationRows']) is int and s['operationRows']==1,'OP_ROWS_'+name)
        require(type(s['auditRows']) is int and s['auditRows']==1,'AUDIT_ROWS_'+name)
    validate_snapshot(doc['finalSnapshot'])
    require(doc['finalSnapshot']==scenarios['decide']['afterRetry'],'FINAL_SNAPSHOT')
    require(type(doc['sha256']) is str and re.fullmatch('[a-f0-9]{64}',doc['sha256']) is not None
            and doc['sha256']==seal(doc),'HASH')
    return True

def admin_sql(cid,sql):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    # Only internal, hard-coded SQL from this module calls this function.
    cmd=['docker','exec','-i',cid,'psql','-X','-A','-t','-v','ON_ERROR_STOP=1',
         '-U','postgres','-d',DB,'-c',sql]
    proc=subprocess.run(cmd,capture_output=True,text=True,timeout=12)
    require(proc.returncode==0,'ADMIN_SQL_'+proc.stderr[-160:])
    return proc.stdout.strip()

def lock_holder(cid,table,entity,marker):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(table in ('bookings','service_cases') and type(entity) is int and entity>0,'LOCK_TARGET')
    require(type(marker) is int and 200000 <= marker < 200100,'LOCK_MARKER')
    # Superuser only locks a row; it never writes business data.
    sql=(f'BEGIN; SELECT id FROM car02_r138_qa.{table} WHERE id={entity} FOR UPDATE; '
         f'SELECT pg_advisory_xact_lock({marker}); SELECT pg_sleep(20); ROLLBACK;')
    cmd=['docker','exec','-i',cid,'psql','-X','-A','-t','-v','ON_ERROR_STOP=1',
         '-U','postgres','-d',DB,'-c',sql]
    return subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)

def await_lock(cid,marker,holder,seconds=8):
    require(type(marker) is int and 200000 <= marker < 200100,'MARKER')
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        require(holder.poll() is None,'HOLDER_EXITED')
        pid=admin_sql(cid,("SELECT pid FROM pg_locks WHERE locktype='advisory' "
            f"AND classid=0 AND objid={marker} AND granted AND mode='ExclusiveLock';"))
        if pid.isdigit(): return int(pid)
        time.sleep(0.15)
    raise LockTimeoutError('R200_HOLDER_NOT_READY')

def release_lock(cid,pid,holder):
    require(type(pid) is int and pid>0,'BAD_BACKEND_PID')
    try:
        ok=admin_sql(cid,f'SELECT pg_cancel_backend({pid});')
        require(ok=='t','CANCEL_FAILED')
        out,err=holder.communicate(timeout=8)
        require(holder.returncode != 0 and ('canceling statement' in err or '57014' in err),
                'HOLDER_NOT_CANCELLED')
    finally:
        if holder.poll() is None:
            holder.kill();holder.communicate(timeout=4)

def timed_out(cid,actor,statement):
    require(type(cid) is str and CID.fullmatch(cid) is not None and actor in ROLES,'TARGET_ROLE')
    require(type(statement) is str and statement.startswith('SELECT car02_r138_qa.')
            and statement.endswith(');') and statement.count(';')==1
            and re.fullmatch(r'SELECT car02_r138_qa\.(change_booking|case_step)\(.+\);',statement,re.S),
            'SQL_ALLOWLIST')
    sql="SET lock_timeout='300ms'; "+statement
    cmd=['docker','exec','-i',cid,'env','PGPASSWORD=r138-throwaway-only',
         'psql','-h','127.0.0.1','-X','-A','-t','-v','ON_ERROR_STOP=1',
         '-v','VERBOSITY=sqlstate','-U',ROLES[actor],'-d',DB,'-c',sql]
    result=subprocess.run(cmd,capture_output=True,text=True,timeout=8)
    require(result.returncode != 0,'UNEXPECTED_SUCCESS')
    require(re.search(r'ERROR:\s*55P03\b',result.stderr) is not None,'WRONG_SQLSTATE')
    return '55P03'

def safe_write(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
            and not path.exists() and not path.is_symlink(),'OUTPUT_PATH')
    verify_report(doc)
    with path.open('x',encoding='ascii') as f:
        f.write(json.dumps(doc,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False)+'\n')
    restored=json.loads(path.read_text(encoding='ascii'))
    require(restored==doc and verify_report(restored),'ROUNDTRIP')
    return path

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT_ARG')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit
            and os.environ.get('CAR02_RELEASE_LOCK')=='true'
            and os.environ.get('R200_DISPOSABLE_QA')=='yes','ENV_LOCK')
    target=Path(out)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'OUT_EXISTS')
    initial=snapshot(cid)
    require(initial==dict.fromkeys(TABLES,hashlib.md5(b'[]').hexdigest()),'NOT_EMPTY')
    day=next_business_days(1)[0]
    owner=ROLES['a1'];other=ROLES['a2']
    require(booking(cid,DB,'as','r200_seed_move',owner,day,'10:00')=='CREATED','MOVE_SEED')
    require(booking(cid,DB,'as','r200_seed_cancel',other,day,'11:00')=='CREATED','CANCEL_SEED')
    require(booking(cid,DB,'as','r200_seed_decide',owner,day,'12:00')=='CREATED','DECIDE_BOOK')
    require(booking(cid,DB,'as','r200_seed_quote',other,day,'13:00')=='CREATED','QUOTE_BOOK')
    booking_ids={name:integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r200_seed_{name}';")
                 for name in ('move','cancel','decide','quote')}
    require(case(cid,DB,'as','r200_case_decide',booking_ids['decide'])=='OPENED','CASE_DECIDE')
    require(case(cid,DB,'as','r200_case_quote',booking_ids['quote'])=='OPENED','CASE_QUOTE')
    case_ids={name:integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={booking_ids[name]};")
              for name in ('decide','quote')}
    note='Synthetic lock handling with no customer records'
    for name in ('quote','decide'):
        require(step(cid,DB,'as','r200_report_'+name,case_ids[name],'REPORT',1,note=note)=='REPORT_SAVED','REPORT_SEED')
    require(step(cid,DB,'as','r200_seed_quotation',case_ids['decide'],'QUOTE',2,part=1400,labor=900)=='QUOTE_PRESENTED','DECIDE_SEED_QUOTE')
    ids={'move':booking_ids['move'],'cancel':booking_ids['cancel'],
         'quote':case_ids['quote'],'decide':case_ids['decide']}
    specs={
      'move':('bookings','a1',sql_change('r200_move_retry',ids['move'],'MOVE',1,day,'10:30'),
              lambda:change(cid,'a1','r200_move_retry',ids['move'],'MOVE',1,day,'10:30'),'booking_operations','MOVE'),
      'cancel':('bookings','a2',sql_change('r200_cancel_retry',ids['cancel'],'CANCEL',1),
              lambda:change(cid,'a2','r200_cancel_retry',ids['cancel'],'CANCEL',1),'booking_operations','CANCEL'),
      'quote':('service_cases','as',sql_step('r200_quote_retry',ids['quote'],'QUOTE',2,part=900,labor=800),
              lambda:step(cid,DB,'as','r200_quote_retry',ids['quote'],'QUOTE',2,part=900,labor=800),'case_operations','QUOTE'),
      'decide':('service_cases','a1',sql_step('r200_decide_retry',ids['decide'],'DECIDE',3,choice='APPROVE'),
              lambda:step(cid,DB,'a1','r200_decide_retry',ids['decide'],'DECIDE',3,choice='APPROVE'),'case_operations','DECIDE'),
    }
    results={}
    for index,name in enumerate(SCENARIOS):
        table,actor,sql,retry,operations_table,action=specs[name]
        entity=ids[name];marker=200001+index
        before=snapshot(cid)
        holder=lock_holder(cid,table,entity,marker)
        try:
            pid=await_lock(cid,marker,holder)
            state=timed_out(cid,actor,sql)
            after_timeout=snapshot(cid)
            require(after_timeout==before,'TIMEOUT_MUTATED_'+name)
            release_lock(cid,pid,holder)
        finally:
            if holder.poll() is None:holder.kill();holder.communicate(timeout=5)
        result=retry()
        require(result==ANSWERS[name],'RETRY_'+name)
        after=snapshot(cid)
        require(after!=after_timeout,'NO_COMMIT_'+name)
        opcount=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.{operations_table} WHERE request_key='r200_{name}_retry';")
        auditcount=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={entity} AND action='{action}';")
        require(opcount==1 and auditcount==1,'SINGLE_AUDIT_'+name)
        results[name]=dict(before=before,afterTimeout=after_timeout,afterRetry=after,
                 timeoutSqlstate=state,retryResult=result,operationRows=opcount,auditRows=auditcount)
    require(psql(cid,DB,'as',f"SELECT state FROM car02_r138_qa.bookings WHERE id={ids['cancel']};")=='CANCELLED','CANCEL_STATE')
    require(psql(cid,DB,'as',f"SELECT state FROM car02_r138_qa.service_cases WHERE id={ids['decide']};")=='APPROVED','DECIDE_STATE')
    doc=dict(LOCK,githubCommit=commit,scenarios=results,finalSnapshot=snapshot(cid))
    doc['sha256']=seal(doc)
    safe_write(doc,target)
    print('R200_DISPOSABLE_PG17_FOUR_LOCK_TIMEOUT_RETRY_AUDIT_PASS_NO_GO_HOLD')
    return doc

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--cid',required=True);ap.add_argument('--commit',required=True)
    ap.add_argument('--out',default=OUT);args=ap.parse_args()
    probe(args.cid,args.commit,args.out)
if __name__=='__main__':main()

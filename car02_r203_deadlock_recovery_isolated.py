#!/usr/bin/env python3
"""R203 disposable PG17: deterministic business-transaction deadlock and safe retry.

Never connect to retained/production databases; never change immutable R138B.
The test makes a genuine two-session deadlock on R138B change_booking rows.
An advisory-lock rendezvous ensures both first writes are pending in separate
transactions before the second operations cross-lock the two bookings.
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
from car02_r138_pg17_lifecycle_qa import ROLES, booking, integer, lit, psql
from car02_r159_concurrent_booking_isolated import CID, COMMIT, DB, change
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import snapshot, TABLES
from car02_r191_transaction_rollback_isolated import sql_change

OUT='qa-evidence-r203/r203-deadlock-recovery.json'
MARKER=203001
NAMES=('a','b')
STATES={'winner':'COMMITTED','loser':'40P01'}
LOCK={
 'version':'R203','mode':'DISPOSABLE_PG17_REAL_TWO_SESSION_DEADLOCK_RETRY_ONLY',
 'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
 'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
 'realAuthenticationVerified':False,'realRLSVerified':False,
 'externalWitnessVerified':False,'externalSignatureVerified':False,
 'independentProductionTest':False,'productionReady':False,
 'fixtureDb':DB,'fixtureRoles':5,'fiveTablesCovered':True,
 'deadlockSqlstate':'40P01','deadlockVictimRolledBack':True,
 'winnerAuditExactlyOnce':True,'staleRetryRejected':True,
 'freshVersionRetryExactlyOnce':True,'originalR138BUnchanged':True,
 'priorR200Unchanged':True,
}
class DeadlockQAError(AssertionError):pass

def require(ok,what):
    if not ok:raise DeadlockQAError('R203_'+what)

def seal(doc):
    core={k:v for k,v in doc.items() if k!='sha256'}
    return hashlib.sha256(json.dumps(core,sort_keys=True,separators=(',',':'),allow_nan=False,ensure_ascii=True).encode('ascii')).hexdigest()

def digest_shape(data):
    require(type(data) is dict and set(data)==set(TABLES),'SNAP_FIELDS')
    require(all(type(v) is str and re.fullmatch('[0-9a-f]{32}',v) for v in data.values()),'SNAP_VALUES')
    return True

def evaluate_sessions(results):
    require(type(results) is dict and set(results)==set(NAMES),'RESULT_KEYS')
    for name in NAMES:
        entry=results[name]
        require(type(entry) is dict and set(entry)=={'exitCode','stdout','stderr'},'RESULT_FORMAT')
        require(type(entry['exitCode']) is int and type(entry['stdout']) is str and type(entry['stderr']) is str,'RESULT_TYPES')
        require(len(entry['stdout'])<12000 and len(entry['stderr'])<12000,'LOG_SIZE')
    winners=[k for k,x in results.items() if x['exitCode']==0]
    losers=[k for k,x in results.items() if x['exitCode']!=0]
    require(len(winners)==len(losers)==1,'SINGLE_WINNER')
    win,loss=winners[0],losers[0]
    lines=results[win]['stdout'].splitlines()
    require(lines.count('MOVED')==2 and 'COMMIT' in lines,'WINNER_COMMIT')
    require(re.search(r'ERROR:\s*40P01\b',results[loss]['stderr']) is not None,'DEADLOCK_SQLSTATE')
    require('COMMIT' not in results[loss]['stdout'].splitlines(),'LOSER_COMMITTED')
    return win,loss

def validate_report(doc):
    fixed=set(LOCK)
    expected=fixed|{'githubCommit','winner','loser','initial','afterDeadlock','afterStale','finalSnapshot',
                    'winnerOperationRows','loserOperationRows','winnerAuditRows','loserAuditRows',
                    'staleErrors','freshRetryResults','finalVersions','sha256'}
    require(type(doc) is dict and set(doc)==expected,'REPORT_FIELDS')
    for k,v in LOCK.items():require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']) is not None,'COMMIT')
    require(doc['winner'] in NAMES and doc['loser'] in NAMES and doc['winner']!=doc['loser'],'WINNER_LOSER')
    for field in ('initial','afterDeadlock','afterStale','finalSnapshot'):digest_shape(doc[field])
    require(doc['initial']!=doc['afterDeadlock'],'DEADLOCK_NO_COMMIT')
    require(doc['afterDeadlock']==doc['afterStale'],'STALE_CHANGED_DB')
    require(doc['afterStale']!=doc['finalSnapshot'],'FRESH_RETRY_MISSING')
    for field,value in {'winnerOperationRows':2,'loserOperationRows':0,'winnerAuditRows':2,
                        'loserAuditRows':0}.items():
        require(type(doc[field]) is int and doc[field]==value,field)
    require(type(doc['staleErrors']) is list and doc['staleErrors']==['R138_STALE_BOOKING']*2,'STALE_ERRORS')
    require(type(doc['freshRetryResults']) is list and doc['freshRetryResults']==['MOVED','MOVED'],'RETRY_RESULT')
    require(type(doc['finalVersions']) is list and doc['finalVersions']==[3,3],'FINAL_VERSIONS')
    require(type(doc['sha256']) is str and re.fullmatch('[0-9a-f]{64}',doc['sha256']) and doc['sha256']==seal(doc),'HASH')
    return True

def admin(cid,sql):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'ADMIN_CID')
    require(type(sql) is str and sql.startswith('SELECT ') and ';' not in sql,'ADMIN_QUERY')
    r=subprocess.run(['docker','exec','-i',cid,'psql','-X','-A','-t','-v','ON_ERROR_STOP=1',
                      '-U','postgres','-d',DB,'-c',sql],capture_output=True,text=True,timeout=8)
    require(r.returncode==0,'ADMIN_ERROR')
    return r.stdout.strip()

def admin_lock_holder(cid):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'HOLDER_CID')
    statement=f'BEGIN; SELECT pg_advisory_xact_lock({MARKER}); SELECT pg_sleep(30); ROLLBACK;'
    return subprocess.Popen(['docker','exec','-i',cid,'psql','-X','-A','-t','-v','ON_ERROR_STOP=1',
          '-U','postgres','-d',DB,'-c',statement],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)

def wait_for(cid,count,holder,clients=(),timeout=9):
    require(type(count) is int and count in (0,2),'COUNT')
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        require(holder.poll() is None,'HOLDER_DIED')
        for proc in clients:require(proc.poll() is None,'CLIENT_EXITED_EARLY')
        raw=admin(cid,f"SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid={MARKER} AND granted=false")
        require(raw.isdigit(),'LOCK_QUERY')
        if int(raw)==count:
            if count==0:
                pid=admin(cid,f"SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid={MARKER} AND granted AND mode='ExclusiveLock'")
                if pid.isdigit():return int(pid)
            else:return True
        time.sleep(0.12)
    raise DeadlockQAError('R203_BARRIER_TIMEOUT')

def cancel_holder(cid,pid,proc):
    require(type(pid) is int and pid>0,'HOLDER_PID')
    try:
        require(admin(cid,f'SELECT pg_cancel_backend({pid})')=='t','HOLDER_CANCEL')
        proc.communicate(timeout=8)
        require(proc.returncode!=0,'HOLDER_NOT_CANCELLED')
    finally:
        if proc.poll() is None:
            proc.kill();proc.communicate(timeout=5)

def client(cid,first,second):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CLIENT_CID')
    for s in (first,second):
        require(type(s) is str and s.startswith('SELECT car02_r138_qa.change_booking(')
                and s.endswith(');') and s.count(';')==1,'CLIENT_SQL')
    script=f'BEGIN; {first} SELECT pg_advisory_xact_lock({MARKER}); {second} COMMIT;'
    return subprocess.Popen(['docker','exec','-i',cid,'env','PGPASSWORD=r138-throwaway-only',
              'psql','-h','127.0.0.1','-X','-A','-t','-v','ON_ERROR_STOP=1',
              '-v','VERBOSITY=sqlstate','-U',ROLES['a1'],'-d',DB,'-c',script],
              stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)

def concurrent_deadlock(cid,queries):
    require(type(queries) is dict and set(queries)==set(NAMES),'QUERIES')
    holder=admin_lock_holder(cid)
    clients={}
    try:
        pid=wait_for(cid,0,holder)
        for tag,(first,second) in queries.items():
            clients[tag]=client(cid,first,second)
        wait_for(cid,2,holder,tuple(clients.values()))
        cancel_holder(cid,pid,holder)
        result={}
        for name,p in clients.items():
            stdout,stderr=p.communicate(timeout=18)
            result[name]={'exitCode':p.returncode,'stdout':stdout,'stderr':stderr}
        winner,loser=evaluate_sessions(result)
        return winner,loser
    finally:
        if holder.poll() is None:holder.kill();holder.communicate(timeout=4)
        for p in clients.values():
            if p.poll() is None:p.kill();p.communicate(timeout=4)

def save(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
            and not path.exists() and not path.is_symlink(),'OUTPUT_PATH')
    validate_report(doc)
    with path.open('x',encoding='ascii') as f:
        f.write(json.dumps(doc,indent=2,sort_keys=True,ensure_ascii=True,allow_nan=False)+'\n')
    verify=json.loads(path.read_text(encoding='ascii'))
    require(verify==doc and validate_report(verify),'ROUNDTRIP')
    return path

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT_ARG')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit
            and os.environ.get('CAR02_RELEASE_LOCK')=='true'
            and os.environ.get('R203_DISPOSABLE_QA')=='yes','ENV_HOLD')
    target=Path(out)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'OUT_EXISTS')
    day=next_business_days(1)[0]
    owner=ROLES['a1']
    require(booking(cid,DB,'as','r203_booking_one',owner,day,'10:00')=='CREATED','BOOK1')
    require(booking(cid,DB,'as','r203_booking_two',owner,day,'11:00')=='CREATED','BOOK2')
    ids=[integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r203_booking_{nm}';") for nm in ('one','two')]
    initial=snapshot(cid)
    keys={'a':['r203_a_first','r203_a_second'],'b':['r203_b_first','r203_b_second']}
    queries={
        'a':(sql_change(keys['a'][0],ids[0],'MOVE',1,day,'13:00'),sql_change(keys['a'][1],ids[1],'MOVE',1,day,'13:30')),
        'b':(sql_change(keys['b'][0],ids[1],'MOVE',1,day,'13:30'),sql_change(keys['b'][1],ids[0],'MOVE',1,day,'13:00')),
    }
    winner,loser=concurrent_deadlock(cid,queries)
    after=snapshot(cid)
    require(initial!=after,'NO_COMMITTED_WINNER')
    require([integer(cid,DB,'as',f'SELECT version FROM car02_r138_qa.bookings WHERE id={x};') for x in ids]==[2,2],'WINNER_VERSIONS')
    opcounts={k:sum(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.booking_operations WHERE request_key='{item}';") for item in group)
              for k,group in keys.items()}
    require(opcounts[winner]==2 and opcounts[loser]==0,'OP_ATOMICITY')
    require(integer(cid,DB,'as',"SELECT count(*) FROM car02_r138_qa.audit_events WHERE action='MOVE';")==2,'AUDIT_WINNER_ONCE')
    for key in keys[winner]:
        i=keys[winner].index(key)
        ix=(i if winner=='a' else 1-i)
        clock='13:00' if ix==0 else '13:30'
        require(change(cid,'a1',key,ids[ix],'MOVE',1,day,clock)=='IDEMPOTENT','WINNER_REPLAY')
    before_stale=snapshot(cid)
    stale=[]
    for key in keys[loser]:
        ix=(keys[loser].index(key) if loser=='a' else 1-keys[loser].index(key))
        clock='13:00' if ix==0 else '13:30'
        require(change(cid,'a1',key,ids[ix],'MOVE',1,day,clock,success=False,error='R138_STALE_BOOKING')=='REJECTED','STALE_DENIAL')
        stale.append('R138_STALE_BOOKING')
    after_stale=snapshot(cid)
    require(after_stale==before_stale,'STALE_MUTATION')
    retry=[]
    for i,bid in enumerate(ids):
        clock='15:00' if i==0 else '15:30'
        require(change(cid,'a1',f'r203_safe_retry_{i}',bid,'MOVE',2,day,clock)=='MOVED','FRESH_RETRY')
        retry.append('MOVED')
    for i,bid in enumerate(ids):
        require(integer(cid,DB,'as',f'SELECT version FROM car02_r138_qa.bookings WHERE id={bid};')==3,'FINAL_VERSION')
        require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={bid} AND action='MOVE';")==2,'PER_BOOK_AUDITS')
    require(integer(cid,DB,'as',"SELECT count(*) FROM car02_r138_qa.booking_operations WHERE op='MOVE';")==4,'OP_FINAL_FOUR')
    doc=dict(LOCK,githubCommit=commit,winner=winner,loser=loser,initial=initial,
             afterDeadlock=after,afterStale=after_stale,finalSnapshot=snapshot(cid),
             winnerOperationRows=opcounts[winner],loserOperationRows=opcounts[loser],
             winnerAuditRows=2,loserAuditRows=0,staleErrors=stale,
             freshRetryResults=retry,finalVersions=[3,3])
    doc['sha256']=seal(doc)
    save(doc,target)
    print('R203_DISPOSABLE_PG17_DEADLOCK_40P01_SINGLE_WINNER_FRESH_RETRY_PASS_NO_GO_HOLD')
    return doc

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--cid',required=True)
    parser.add_argument('--commit',required=True);parser.add_argument('--out',default=OUT)
    x=parser.parse_args();probe(x.cid,x.commit,x.out)
if __name__=='__main__':main()

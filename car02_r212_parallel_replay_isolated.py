#!/usr/bin/env python3
"""R212: parallel post-COMMIT identical and conflicting replay, disposable R138B PG17 only.

The first DB write is committed and response hidden (R209 model). Then independent
client sessions concurrently replay the same request key. This does not claim
actual network/TLS fault tolerance or real-world authentication assurance.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
from threading import Barrier
from car02_r138_pg17_lifecycle_qa import ROLES, booking, case, step, integer
from car02_r159_concurrent_booking_isolated import DB, CID, COMMIT
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import TABLES, snapshot
from car02_r191_transaction_rollback_isolated import sql_book, sql_change, sql_step
from car02_r209_commit_ack_loss_isolated import (
    execute_discarded_response, deny_changed_replay, DENIALS,
)
from car02_r138_pg17_lifecycle_qa import psql

OUT='qa-evidence-r212/r212-parallel-replay-proof.json'
CASES=('booking','move','quote','decide')
ACTIONS={'booking':'BOOKED','move':'MOVE','quote':'QUOTE','decide':'DECIDE'}
N=8
LOCK={
 'version':'R212','mode':'DISPOSABLE_PG17_COMMITTED_PARALLEL_REPLAY_AND_CONFLICT_ONLY',
 'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
 'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
 'realAuthenticationVerified':False,'realRLSVerified':False,'realNetworkOutageVerified':False,
 'externalSignatureVerified':False,'externalWitnessVerified':False,'productionReady':False,
 'fixtureDb':DB,'fixtureRoles':5,'fiveTablesCovered':True,
 'clientResponseDiscarded':True,'firstCommitBeforeParallelReplay':True,
 'parallelIdenticalClients':8,'parallelMixedClients':8,
 'exactlyOnceWritesChecked':True,'conflictAlwaysRejected':True,
 'r138bAndR209Immutable':True,
}
class ParallelReplayError(AssertionError):pass

def require(ok,code):
    if not ok:raise ParallelReplayError('R212_'+code)

def seal(doc):
    body={k:v for k,v in doc.items() if k!='sha256'}
    return hashlib.sha256(json.dumps(body,sort_keys=True,separators=(',',':'),
                   ensure_ascii=True,allow_nan=False).encode('ascii')).hexdigest()

def validate_snapshot(s):
    require(type(s) is dict and set(s)==set(TABLES),'SNAP_SHAPE')
    require(all(type(v) is str and re.fullmatch('[a-f0-9]{32}',v) is not None
                for v in s.values()),'SNAP_HASH')
    return True

def validate_proof(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','cases','finalSnapshot','sha256'},'FIELDS')
    for k,v in LOCK.items():require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']),'GIT_COMMIT')
    require(type(doc['cases']) is dict and set(doc['cases'])==set(CASES),'CASES')
    last=None
    for n in CASES:
        r=doc['cases'][n]
        require(type(r) is dict and set(r)=={
            'before','afterCommit','afterParallelIdentical','afterParallelMixed',
            'identicalResults','mixedResults','operationRows','auditRows',
            'firstServerCommitted','responseObserved'},'CASE_KEYS_'+n)
        for phase in ('before','afterCommit','afterParallelIdentical','afterParallelMixed'):
            validate_snapshot(r[phase])
        if last is not None:require(r['before']==last,'CHAIN_'+n)
        last=r['afterParallelMixed']
        require(r['before']!=r['afterCommit'],'NO_COMMIT_'+n)
        require(r['afterCommit']==r['afterParallelIdentical']==r['afterParallelMixed'],'MUTATION_'+n)
        require(type(r['identicalResults']) is list and len(r['identicalResults'])==N
                and all(type(x) is str and x=='IDEMPOTENT' for x in r['identicalResults']),
                'IDENTICAL_RESULTS_'+n)
        require(type(r['mixedResults']) is list and len(r['mixedResults'])==N
                and sum(type(x) is str and x=='IDEMPOTENT' for x in r['mixedResults'])==4
                and sum(type(x) is str and x=='22023:'+DENIALS[n] for x in r['mixedResults'])==4,
                'MIXED_RESULTS_'+n)
        require(type(r['operationRows']) is int and r['operationRows']==(0 if n=='booking' else 1),'OPS_'+n)
        require(type(r['auditRows']) is int and r['auditRows']==1,'AUDIT_'+n)
        require(type(r['firstServerCommitted']) is bool and r['firstServerCommitted'] is True,'FIRST_COMMIT_'+n)
        require(type(r['responseObserved']) is bool and r['responseObserved'] is False,'RESPONSE_'+n)
    validate_snapshot(doc['finalSnapshot'])
    require(doc['finalSnapshot']==doc['cases']['decide']['afterParallelMixed'],'FINAL_SNAP')
    require(type(doc['sha256']) is str and re.fullmatch('[a-f0-9]{64}',doc['sha256']) is not None
            and doc['sha256']==seal(doc),'SEAL')
    return True

def parallel_calls(cid,actor,correct,incorrect=None):
    """Eight independent sessions, synchronized at the application call barrier."""
    require(type(cid) is str and CID.fullmatch(cid) is not None and actor in ROLES,'CLIENT_ID')
    require(callable(correct),'CORRECT')
    require(incorrect is None or callable(incorrect),'INCORRECT')
    gate=Barrier(N)
    def one(idx):
        gate.wait(timeout=12)
        if incorrect is not None and idx%2:
            return incorrect()
        return correct()
    with ThreadPoolExecutor(max_workers=N) as pool:
        futures=[pool.submit(one,i) for i in range(N)]
        return [f.result(timeout=60) for f in futures]

def write_proof(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
            and not path.exists() and not path.is_symlink(),'OUTPUT_SCOPE')
    validate_proof(doc)
    with path.open('x',encoding='ascii') as f:
        json.dump(doc,f,sort_keys=True,ensure_ascii=True,indent=2,allow_nan=False)
        f.write('\n')
    reread=json.loads(path.read_text(encoding='ascii'))
    require(reread==doc and validate_proof(reread),'ROUNDTRIP')
    return path

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit
            and os.environ.get('CAR02_RELEASE_LOCK')=='true'
            and os.environ.get('R212_DISPOSABLE_QA')=='yes','ENV_LOCK')
    target=Path(out)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'TARGET')
    empty=hashlib.md5(b'[]').hexdigest()
    require(snapshot(cid)==dict.fromkeys(TABLES,empty),'NOT_EMPTY')
    day=next_business_days(1)[0]
    owner=ROLES['a1']
    for n,time in [('move','10:00'),('quote','11:00'),('decide','12:00')]:
        require(booking(cid,DB,'as','r212_seed_'+n,owner,day,time)=='CREATED','SEED_BOOK_'+n)
    ids={n:integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r212_seed_{n}';")
         for n in ('move','quote','decide')}
    for n in ('quote','decide'):
        require(case(cid,DB,'as','r212_case_'+n,ids[n])=='OPENED','SEED_CASE_'+n)
    service={n:integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={ids[n]};")
             for n in ('quote','decide')}
    for n in ('quote','decide'):
        require(step(cid,DB,'as','r212_report_'+n,service[n],'REPORT',1,
                     note='Synthetic parallel replay regression only')=='REPORT_SAVED','SEED_REPORT_'+n)
    require(step(cid,DB,'as','r212_decide_quoted',service['decide'],'QUOTE',2,
                 part=800,labor=1100)=='QUOTE_PRESENTED','SEED_DECIDE_QUOTE')
    from car02_r159_concurrent_booking_isolated import change
    keys={n:'r212_parallel_'+n for n in CASES}
    specs={
      'booking':('as',sql_book(keys['booking'],owner,day,'13:00'),
         lambda:booking(cid,DB,'as',keys['booking'],owner,day,'13:00'),
         sql_book(keys['booking'],owner,day,'13:30'),None,None),
      'move':('a1',sql_change(keys['move'],ids['move'],'MOVE',1,day,'10:30'),
         lambda:change(cid,'a1',keys['move'],ids['move'],'MOVE',1,day,'10:30'),
         sql_change(keys['move'],ids['move'],'MOVE',1,day,'14:00'),'booking_operations',ids['move']),
      'quote':('as',sql_step(keys['quote'],service['quote'],'QUOTE',2,part=1500,labor=900),
         lambda:step(cid,DB,'as',keys['quote'],service['quote'],'QUOTE',2,part=1500,labor=900),
         sql_step(keys['quote'],service['quote'],'QUOTE',2,part=1501,labor=900),'case_operations',service['quote']),
      'decide':('a1',sql_step(keys['decide'],service['decide'],'DECIDE',3,choice='APPROVE'),
         lambda:step(cid,DB,'a1',keys['decide'],service['decide'],'DECIDE',3,choice='APPROVE'),
         sql_step(keys['decide'],service['decide'],'DECIDE',3,choice='DECLINE'),'case_operations',service['decide']),
    }
    records={}
    for n in CASES:
        actor,original,replay,conflict,table,entity=specs[n]
        before=snapshot(cid)
        execute_discarded_response(cid,actor,original)
        committed=snapshot(cid)
        require(before!=committed,'FIRST_WRITE_'+n)
        identical=parallel_calls(cid,actor,replay)
        after_identical=snapshot(cid)
        require(identical==['IDEMPOTENT']*N and committed==after_identical,'IDENTICAL_DRIFT_'+n)
        mixed=parallel_calls(cid,actor,replay,
            lambda:'22023:'+DENIALS[n] if deny_changed_replay(cid,actor,conflict,DENIALS[n])=='22023' else 'DENIAL_FAILED')
        after_mixed=snapshot(cid)
        require(after_mixed==committed,'MIXED_DRIFT_'+n)
        if n=='booking':
            entity=integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='{keys[n]}';")
            rows=0
        else:
            rows=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.{table} WHERE request_key='{keys[n]}';")
        audit=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={entity} AND action='{ACTIONS[n]}';")
        require(rows==(0 if n=='booking' else 1) and audit==1,'ONCE_'+n)
        records[n]=dict(before=before,afterCommit=committed,afterParallelIdentical=after_identical,
           afterParallelMixed=after_mixed,identicalResults=identical,mixedResults=mixed,
           operationRows=rows,auditRows=audit,firstServerCommitted=True,responseObserved=False)
    require(psql(cid,DB,'as',f"SELECT state FROM car02_r138_qa.service_cases WHERE id={service['decide']};")=='APPROVED','DECIDE_STATE')
    doc=dict(LOCK,githubCommit=commit,cases=records,finalSnapshot=snapshot(cid))
    doc['sha256']=seal(doc)
    write_proof(doc,target)
    print('R212_DISPOSABLE_PG17_FOUR_PARALLEL_REPLAYS_AND_CONFLICTS_EXACTLY_ONCE_PASS_NO_GO_HOLD')
    return doc

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--cid',required=True)
    ap.add_argument('--commit',required=True)
    ap.add_argument('--out',default=OUT)
    a=ap.parse_args();probe(a.cid,a.commit,a.out)
if __name__=='__main__':main()

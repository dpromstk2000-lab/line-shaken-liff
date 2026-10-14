#!/usr/bin/env python3
"""R215: eight concurrent FIRST submissions per request-key in disposable PG17.

Four use payload A, four payload B. This proves one winning payload and one
business mutation in the synthetic R138B fixture; it is NOT real authentication,
production readiness, or an actual transport failure test. NO_GO / HOLD.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from threading import Barrier

from car02_r138_pg17_lifecycle_qa import ROLES, booking, case, step, integer, psql
from car02_r159_concurrent_booking_isolated import DB, CID, COMMIT
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import TABLES, snapshot
from car02_r191_transaction_rollback_isolated import sql_book, sql_change, sql_step

OUT='qa-evidence-r215/r215-first-write-race-proof.json'
SCENARIOS=('booking','move','quote','decide')
SUCCESSES={'booking':'CREATED','move':'MOVED','quote':'QUOTE_PRESENTED','decide':('APPROVED','DECLINED')}
REJECTIONS={'booking':'R138_BOOKING_REPLAY_CONFLICT','move':'R138_REPLAY_CONFLICT',
            'quote':'R138_REPLAY_MISMATCH','decide':'R138_REPLAY_MISMATCH'}
ACTIONS={'booking':'BOOKED','move':'MOVE','quote':'QUOTE','decide':'DECIDE'}
CLIENTS=8
LOCK={
 'version':'R215','mode':'DISPOSABLE_PG17_CONCURRENT_FIRST_WRITE_SPLIT_PAYLOAD_ONLY',
 'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
 'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
 'realAuthenticationVerified':False,'realRLSVerified':False,
 'realNetworkOutageVerified':False,'externalSignatureVerified':False,
 'externalWitnessVerified':False,'productionReady':False,
 'fixtureDb':DB,'fixtureRoles':5,'fiveTablesCovered':True,
 'simultaneousClients':8,'variantsPerGroup':4,
 'oneWinningPayload':True,'auditExactlyOnce':True,'sourceR138BUnchanged':True,
 'priorR212Unchanged':True,
}

class FirstWriteRaceError(AssertionError): pass

def require(ok,code):
    if not ok:raise FirstWriteRaceError('R215_'+code)

def seal(doc):
    return hashlib.sha256(json.dumps({k:v for k,v in doc.items() if k!='sha256'},
        sort_keys=True,ensure_ascii=True,allow_nan=False,separators=(',',':')).encode('ascii')).hexdigest()

def valid_snapshot(s):
    require(type(s) is dict and set(s)==set(TABLES),'SNAP_FIELDS')
    require(all(type(x) is str and re.fullmatch('[0-9a-f]{32}',x) is not None for x in s.values()),'SNAP_HASH')

def valid_result(case,variant,status,winner):
    if variant==winner:
        return status in (SUCCESSES[case], 'IDEMPOTENT') if case!='decide' else (status == ('APPROVED' if winner=='A' else 'DECLINED') or status=='IDEMPOTENT')
    return status=='22023:'+REJECTIONS[case]

def verify_report(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','scenarios','finalSnapshot','sha256'},'FIELDS')
    for key,value in LOCK.items():require(type(doc[key]) is type(value) and doc[key]==value,'LOCK_'+key)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']) is not None,'COMMIT')
    require(type(doc['scenarios']) is dict and set(doc['scenarios'])==set(SCENARIOS),'SCENARIOS')
    last=None
    for case in SCENARIOS:
        record=doc['scenarios'][case]
        require(type(record) is dict and set(record)=={'before','after','winnerVariant','results','operationRows','auditRows','storedValue'},'CASE_FIELDS_'+case)
        valid_snapshot(record['before']);valid_snapshot(record['after'])
        if last is not None:require(record['before']==last,'CHAIN_'+case)
        last=record['after']
        require(record['before']!=record['after'],'NO_MUTATION_'+case)
        winner=record['winnerVariant']
        require(type(winner) is str and winner in ('A','B'),'WINNER_'+case)
        results=record['results']
        require(type(results) is list and len(results)==CLIENTS,'RESULTS_'+case)
        wins=0;idem=0;denied=0
        for i,row in enumerate(results):
            require(type(row) is dict and set(row)=={'variant','result'},'RESULT_FIELDS_'+case)
            variant='A' if i%2==0 else 'B'
            require(type(row['variant']) is str and row['variant']==variant,'VARIANT_'+case)
            status=row['result']
            require(type(status) is str and valid_result(case,variant,status,winner),'OUTCOME_'+case)
            if status in ('CREATED','MOVED','QUOTE_PRESENTED','APPROVED','DECLINED'): wins+=1
            elif status=='IDEMPOTENT': idem+=1
            else: denied+=1
        require((wins,idem,denied)==(1,3,4),'DISTRIBUTION_'+case)
        require(type(record['operationRows']) is int and record['operationRows']==(0 if case=='booking' else 1),'OP_ROWS_'+case)
        require(type(record['auditRows']) is int and record['auditRows']==1,'AUDIT_ROWS_'+case)
        allowed={
          'booking':{'A':'13:00','B':'13:30'},
          'move':{'A':'10:30','B':'14:00'},
          'quote':{'A':'1500','B':'1600'},
          'decide':{'A':'APPROVED','B':'DECLINED'},
        }
        require(type(record['storedValue']) is str and record['storedValue']==allowed[case][winner],'STORED_VALUE_'+case)
    valid_snapshot(doc['finalSnapshot'])
    require(doc['finalSnapshot']==doc['scenarios']['decide']['after'],'FINAL')
    require(type(doc['sha256']) is str and re.fullmatch('[0-9a-f]{64}',doc['sha256']) is not None and doc['sha256']==seal(doc),'HASH')
    return True

def call(cid,actor,sql,case):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(actor in ROLES and case in SCENARIOS,'ACTOR')
    require(type(sql) is str and sql.count(';')==1 and re.fullmatch(
        r'SELECT car02_r138_qa\.(claim_booking|change_booking|case_step)\(.+\);',sql,re.S),'SQL_SCOPE')
    proc=subprocess.run(['docker','exec','-i',cid,'env','PGPASSWORD=r138-throwaway-only',
        'psql','-h','127.0.0.1','-X','-A','-t','-v','ON_ERROR_STOP=1',
        '-v','VERBOSITY=verbose','-U',ROLES[actor],'-d',DB,'-c',sql],
        capture_output=True,text=True,timeout=35)
    if proc.returncode==0:
        result=proc.stdout.strip()
        require(result in ('CREATED','MOVED','QUOTE_PRESENTED','APPROVED','DECLINED','IDEMPOTENT'),
                'UNEXPECTED_SUCCESS_'+case)
        return result
    expected=REJECTIONS[case]
    require(re.search(r'ERROR:\s*22023:\s*'+re.escape(expected)+r'\b',proc.stderr) is not None,
            'UNEXPECTED_SQL_ERROR_'+case)
    return '22023:'+expected

def parallel_first_writes(cid,actor,sql_a,sql_b,case):
    require(type(cid) is str and CID.fullmatch(cid) is not None and actor in ROLES and case in SCENARIOS,'PARALLEL_SCOPE')
    gate=Barrier(CLIENTS)
    def one(i):
        gate.wait(timeout=15)
        return {'variant':'A' if i%2==0 else 'B',
                'result':call(cid,actor,sql_a if i%2==0 else sql_b,case)}
    with ThreadPoolExecutor(max_workers=CLIENTS) as pool:
        futures=[pool.submit(one,i) for i in range(CLIENTS)]
        return [f.result(timeout=65) for f in futures]

def safe_write(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink() and
            not path.exists() and not path.is_symlink(),'OUTPUT_SCOPE')
    verify_report(doc)
    with path.open('x',encoding='ascii') as f:
        json.dump(doc,f,ensure_ascii=True,sort_keys=True,indent=2,allow_nan=False);f.write('\n')
    reread=json.loads(path.read_text(encoding='ascii'))
    require(reread==doc and verify_report(reread),'ROUNDTRIP')
    return path

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit and
        os.environ.get('CAR02_RELEASE_LOCK')=='true' and os.environ.get('R215_DISPOSABLE_QA')=='yes','ENV_LOCK')
    path=Path(out)
    require(path.parent.is_dir() and not path.exists() and not path.parent.is_symlink(),'OUTPUT')
    empty=hashlib.md5(b'[]').hexdigest()
    require(snapshot(cid)==dict.fromkeys(TABLES,empty),'FIXTURE_NOT_EMPTY')
    day=next_business_days(1)[0];owner=ROLES['a1']
    for name,time in [('move','10:00'),('quote','11:00'),('decide','12:00')]:
        require(booking(cid,DB,'as','r215_seed_'+name,owner,day,time)=='CREATED','BOOK_SEED_'+name)
    booking_ids={n:integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r215_seed_{n}';") for n in ('move','quote','decide')}
    for name in ('quote','decide'):
        require(case(cid,DB,'as','r215_case_'+name,booking_ids[name])=='OPENED','CASE_SEED_'+name)
    case_ids={n:integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={booking_ids[n]};") for n in ('quote','decide')}
    for name in ('quote','decide'):
        require(step(cid,DB,'as','r215_report_'+name,case_ids[name],'REPORT',1,note='Synthetic simultaneous first request QA')=='REPORT_SAVED','REPORT_SEED_'+name)
    require(step(cid,DB,'as','r215_seed_quote_for_decide',case_ids['decide'],'QUOTE',2,part=1200,labor=800)=='QUOTE_PRESENTED','DECIDE_SEED')
    keys={name:'r215_initial_race_'+name for name in SCENARIOS}
    variants={
       'booking':('as',sql_book(keys['booking'],owner,day,'13:00'),sql_book(keys['booking'],owner,day,'13:30')),
       'move':('a1',sql_change(keys['move'],booking_ids['move'],'MOVE',1,day,'10:30'),sql_change(keys['move'],booking_ids['move'],'MOVE',1,day,'14:00')),
       'quote':('as',sql_step(keys['quote'],case_ids['quote'],'QUOTE',2,part=1500,labor=900),sql_step(keys['quote'],case_ids['quote'],'QUOTE',2,part=1600,labor=900)),
       'decide':('a1',sql_step(keys['decide'],case_ids['decide'],'DECIDE',3,choice='APPROVE'),sql_step(keys['decide'],case_ids['decide'],'DECIDE',3,choice='DECLINE')),
    }
    proofs={}
    for name in SCENARIOS:
        actor,a,b=variants[name]
        before=snapshot(cid)
        answers=parallel_first_writes(cid,actor,a,b,name)
        after=snapshot(cid)
        winner_index=next((i for i,x in enumerate(answers) if x['result'] in ('CREATED','MOVED','QUOTE_PRESENTED','APPROVED','DECLINED')),None)
        require(winner_index is not None,'NO_WINNER_'+name)
        winner='A' if winner_index%2==0 else 'B'
        if name=='booking':
            entity=integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='{keys[name]}';")
            stored=psql(cid,DB,'as',f"SELECT to_char(begins_at,'HH24:MI') FROM car02_r138_qa.bookings WHERE id={entity};")
            n_ops=0
        elif name=='move':
            entity=booking_ids['move']
            stored=psql(cid,DB,'as',f"SELECT to_char(begins_at,'HH24:MI') FROM car02_r138_qa.bookings WHERE id={entity};")
            n_ops=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.booking_operations WHERE request_key='{keys[name]}';")
        else:
            entity=case_ids[name]
            column='part_yen' if name=='quote' else 'state'
            stored=psql(cid,DB,'as',f"SELECT {column} FROM car02_r138_qa.service_cases WHERE id={entity};")
            n_ops=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.case_operations WHERE request_key='{keys[name]}';")
        n_audit=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={entity} AND action='{ACTIONS[name]}';")
        proofs[name]=dict(before=before,after=after,winnerVariant=winner,results=answers,
             operationRows=n_ops,auditRows=n_audit,storedValue=stored)
    doc=dict(LOCK,githubCommit=commit,scenarios=proofs,finalSnapshot=snapshot(cid))
    doc['sha256']=seal(doc)
    safe_write(doc,path)
    print('R215_DISPOSABLE_PG17_FOUR_EIGHT_CLIENT_FIRST_WRITE_RACES_EXACTLY_ONCE_PASS_NO_GO_HOLD')
    return doc

def main():
    p=argparse.ArgumentParser();p.add_argument('--cid',required=True);p.add_argument('--commit',required=True)
    p.add_argument('--out',default=OUT);a=p.parse_args();probe(a.cid,a.commit,a.out)
if __name__=='__main__':main()

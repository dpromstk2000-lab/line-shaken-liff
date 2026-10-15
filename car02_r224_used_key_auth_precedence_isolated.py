#!/usr/bin/env python3
"""R224: occupied request-key replay must check actor/tenant BEFORE idempotency.

Runs only against immutable R138B synthetic PostgreSQL17 disposable fixture.
A legitimate operation commits, then eight forged callers replay its real key
and exact SQL payload.  No actual user credentials or production contact.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
from car02_r138_pg17_lifecycle_qa import ROLES, booking, case, step, integer, psql
from car02_r159_concurrent_booking_isolated import CID, COMMIT, DB, change
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import TABLES, snapshot
from car02_r191_transaction_rollback_isolated import sql_change, sql_step
from car02_r221_forged_owner_ops_isolated import ATTACKERS, REASONS, ACTIONS, parallel_denials

STAGES=('move','cancel','decision','report')
N=8
OUT='qa-evidence-r224/r224-used-key-authorization-proof.json'
RESULTS={'move':'MOVED','cancel':'CANCELLED','decision':'APPROVED','report':'REPORT_SAVED'}
STATES={'move':'ACTIVE','cancel':'CANCELLED','decision':'APPROVED','report':'REPORTED'}
LOCK={'version':'R224','mode':'DISPOSABLE_PG17_USED_REQUEST_KEY_AUTH_PRECEDES_IDEMPOTENCY_ONLY',
      'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
      'fixtureDb':DB,'fixtureRoles':5,'syntheticOnly':True,'productionTouched':False,
      'productionAuthorized':False,'productionReady':False,'realAuthenticationVerified':False,
      'realRLSVerified':False,'externalWitnessVerified':False,'externalSignatureVerified':False,
      'originalSourceImmutable':True,'existingRequestKeyAttacks':True,
      'parallelAttackerSessions':8,'authorizedReplayIdempotent':True,
      'fiveTableNoMutationOnDenial':True}
class KeyPrecedenceError(AssertionError):pass
def require(ok, code):
    if not ok: raise KeyPrecedenceError('R224_'+code)
def seal(doc):
    body={k:v for k,v in doc.items() if k!='sha256'}
    return hashlib.sha256(json.dumps(body,sort_keys=True,separators=(',',':'),
          ensure_ascii=True,allow_nan=False).encode('ascii')).hexdigest()
def valid_snap(x):
    require(type(x) is dict and set(x)==set(TABLES),'SNAP_TABLES')
    require(all(type(v) is str and re.fullmatch('[a-f0-9]{32}',v) is not None
                for v in x.values()),'SNAP_HASH')
def validate(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','stages','finalSnapshot','sha256'},'FIELDS')
    for k,v in LOCK.items():require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']) is not None,'COMMIT')
    require(type(doc['stages']) is dict and set(doc['stages'])==set(STAGES),'STAGES')
    previous=None
    for stage in STAGES:
        row=doc['stages'][stage]
        require(type(row) is dict and set(row)=={'before','afterAuthorized','afterForgedReplays',
            'afterOwnerReplay','attacks','authorizedResult','ownerReplayResult','operationRows',
            'auditRows','finalState','key'},'STAGE_KEYS_'+stage)
        for name in ('before','afterAuthorized','afterForgedReplays','afterOwnerReplay'):valid_snap(row[name])
        if previous is not None:require(row['before']==previous,'CHAIN_'+stage)
        previous=row['afterOwnerReplay']
        require(row['before']!=row['afterAuthorized'],'AUTHORIZED_DID_NOT_WRITE_'+stage)
        require(row['afterAuthorized']==row['afterForgedReplays']==row['afterOwnerReplay'],
                'REPLAY_MUTATION_'+stage)
        require(type(row['key']) is str and row['key']=='r224_used_key_'+stage,'KEY_'+stage)
        require(type(row['authorizedResult']) is str and row['authorizedResult']==RESULTS[stage],
                'AUTHORIZED_'+stage)
        require(type(row['ownerReplayResult']) is str and row['ownerReplayResult']=='IDEMPOTENT',
                'OWNER_REPLAY_'+stage)
        require(type(row['finalState']) is str and row['finalState']==STATES[stage],'STATE_'+stage)
        require(type(row['operationRows']) is int and row['operationRows']==1,'OPERATIONS_'+stage)
        require(type(row['auditRows']) is int and row['auditRows']==1,'AUDIT_'+stage)
        require(type(row['attacks']) is list and len(row['attacks'])==N,'ATTACKS_'+stage)
        for i,attack in enumerate(row['attacks']):
            require(type(attack) is dict and attack=={'actor':ATTACKERS[stage][i%2],
               'sqlstate':'42501','reason':REASONS[stage][i%2]},'DENIAL_'+stage+'_'+str(i))
    valid_snap(doc['finalSnapshot'])
    require(doc['finalSnapshot']==doc['stages']['report']['afterOwnerReplay'],'FINAL_SNAPSHOT')
    require(type(doc['sha256']) is str and re.fullmatch('[a-f0-9]{64}',doc['sha256']) is not None
            and doc['sha256']==seal(doc),'DIGEST')
    return True

def save(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
            and not path.exists() and not path.is_symlink(),'OUTPUT_SCOPE')
    validate(doc)
    with path.open('x',encoding='ascii') as out:
        json.dump(doc,out,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False);out.write('\n')
    restored=json.loads(path.read_text(encoding='ascii'))
    require(restored==doc and validate(restored),'ROUNDTRIP')
    return path

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT_ARG')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit and
            os.environ.get('CAR02_RELEASE_LOCK')=='true' and
            os.environ.get('R224_DISPOSABLE_QA')=='yes','ENV_LOCK')
    path=Path(out)
    require(path.parent.is_dir() and not path.parent.is_symlink() and not path.exists(),'OUTPUT')
    require(snapshot(cid)==dict.fromkeys(TABLES,hashlib.md5(b'[]').hexdigest()),'FIXTURE_NOT_EMPTY')
    day=next_business_days(1)[0]
    owner=ROLES['a1']
    times={'move':'10:00','cancel':'11:00','decision':'12:00','report':'13:00'}
    bookings={}
    for stage in STAGES:
        key='r224_seed_booking_'+stage
        require(booking(cid,DB,'as',key,owner,day,times[stage])=='CREATED','SEED_'+stage)
        bookings[stage]=integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='{key}';")
    cases={}
    for stage in ('decision','report'):
        require(case(cid,DB,'as','r224_seed_case_'+stage,bookings[stage])=='OPENED','CASE_'+stage)
        cases[stage]=integer(cid,DB,'as',f'SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={bookings[stage]};')
    require(step(cid,DB,'as','r224_seed_decide_report',cases['decision'],'REPORT',1,
                note='Synthetic authorization precedence report')=='REPORT_SAVED','DECIDE_REPORT')
    require(step(cid,DB,'as','r224_seed_decide_quote',cases['decision'],'QUOTE',2,
                 part=1100,labor=900)=='QUOTE_PRESENTED','DECIDE_QUOTE')
    specs={
      'move':('a1',sql_change('r224_used_key_move',bookings['move'],'MOVE',1,day,'10:30'),
         lambda:change(cid,'a1','r224_used_key_move',bookings['move'],'MOVE',1,day,'10:30'),
         'booking_operations',bookings['move'],'bookings'),
      'cancel':('a1',sql_change('r224_used_key_cancel',bookings['cancel'],'CANCEL',1),
         lambda:change(cid,'a1','r224_used_key_cancel',bookings['cancel'],'CANCEL',1),
         'booking_operations',bookings['cancel'],'bookings'),
      'decision':('a1',sql_step('r224_used_key_decision',cases['decision'],'DECIDE',3,choice='APPROVE'),
         lambda:step(cid,DB,'a1','r224_used_key_decision',cases['decision'],'DECIDE',3,choice='APPROVE'),
         'case_operations',cases['decision'],'service_cases'),
      'report':('as',sql_step('r224_used_key_report',cases['report'],'REPORT',1,
                    note='Synthetic authorized operation replay'),
         lambda:step(cid,DB,'as','r224_used_key_report',cases['report'],'REPORT',1,
                    note='Synthetic authorized operation replay'),
         'case_operations',cases['report'],'service_cases'),
    }
    evidence={}
    for stage in STAGES:
        actor,sql,legitimate,ops,entity,table=specs[stage]
        before=snapshot(cid)
        first=legitimate()
        require(first==RESULTS[stage],'FIRST_RESULT_'+stage)
        committed=snapshot(cid)
        require(before!=committed,'FIRST_MUTATION_'+stage)
        attacks=parallel_denials(cid,stage,lambda:sql)
        after_attack=snapshot(cid)
        require(after_attack==committed,'FOREIGN_REPLAY_MUTATED_'+stage)
        owner_replay=legitimate()
        after_owner=snapshot(cid)
        require(owner_replay=='IDEMPOTENT' and after_owner==committed,'OWNER_REPLAY_'+stage)
        foreign_key='r224_used_key_'+stage
        column='booking_id' if ops=='booking_operations' else 'case_id'
        count=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.{ops} WHERE {column}={entity} AND request_key='{foreign_key}';")
        audit=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={entity} AND action='{ACTIONS[stage]}';")
        state=psql(cid,DB,'as',f'SELECT state FROM car02_r138_qa.{table} WHERE id={entity};')
        require(count==1 and audit==1 and state==STATES[stage],'STATE_ONCE_'+stage)
        evidence[stage]=dict(before=before,afterAuthorized=committed,
            afterForgedReplays=after_attack,afterOwnerReplay=after_owner,attacks=attacks,
            authorizedResult=first,ownerReplayResult=owner_replay,operationRows=count,
            auditRows=audit,finalState=state,key=foreign_key)
    doc=dict(LOCK,githubCommit=commit,stages=evidence,finalSnapshot=snapshot(cid))
    doc['sha256']=seal(doc)
    save(doc,path)
    print('R224_DISPOSABLE_PG17_USED_KEY_AUTH_PRECEDENCE_FOUR_STAGES_32_FORGED_DENIALS_NO_GO_HOLD_PASS')
    return doc

def main():
    a=argparse.ArgumentParser();a.add_argument('--cid',required=True);a.add_argument('--commit',required=True);a.add_argument('--out',default=OUT)
    opts=a.parse_args();probe(opts.cid,opts.commit,opts.out)
if __name__=='__main__':main()

#!/usr/bin/env python3
"""R209: confirmed server COMMIT, client-visible acknowledgement deliberately discarded.

Only disposable R138B PostgreSQL17 with synthetic identities. This tests an
ambiguous client outcome, NOT an actual network/TLS failure. No production IO.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, subprocess
from pathlib import Path
from car02_r138_pg17_lifecycle_qa import ROLES, booking, case, step, integer
from car02_r159_concurrent_booking_isolated import DB, CID, COMMIT, change
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import snapshot, TABLES
from car02_r191_transaction_rollback_isolated import sql_book, sql_change, sql_step

OUT='qa-evidence-r209/r209-commit-ack-loss-proof.json'
SCENARIOS=('booking','move','quote','decide')
RESULTS={'booking':'CREATED','move':'MOVED','quote':'QUOTE_PRESENTED','decide':'APPROVED'}
ACTIONS={'booking':'BOOKED','move':'MOVE','quote':'QUOTE','decide':'DECIDE'}
DENIALS={'booking':'R138_BOOKING_REPLAY_CONFLICT','move':'R138_REPLAY_CONFLICT',
         'quote':'R138_REPLAY_MISMATCH','decide':'R138_REPLAY_MISMATCH'}
LOCK={'version':'R209','mode':'DISPOSABLE_PG17_COMMITTED_RESPONSE_DISCARDED_IDEMPOTENCY_ONLY',
      'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
      'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
      'realAuthenticationVerified':False,'realRLSVerified':False,'networkFailureVerified':False,
      'externalWitnessVerified':False,'externalSignatureVerified':False,
      'fixtureDb':DB,'fixtureRoles':5,'fiveTablesCovered':True,
      'clientResponseDiscarded':True,'commitBeforeRetryVerified':True,
      'identicalReplayNoAdditionalWrites':True,'mismatchedReplayDenied':True,
      'previousR206Unchanged':True,'productionReady':False}
class AckLossError(AssertionError):pass
def require(ok,reason):
    if not ok:raise AckLossError('R209_'+reason)
def seal(doc):
    core={k:v for k,v in doc.items() if k!='sha256'}
    return hashlib.sha256(json.dumps(core,sort_keys=True,ensure_ascii=True,
             separators=(',',':'),allow_nan=False).encode('ascii')).hexdigest()
def valid_snapshot(s):
    require(type(s) is dict and set(s)==set(TABLES),'SNAP_FIELDS')
    require(all(type(v) is str and re.fullmatch('[a-f0-9]{32}',v) for v in s.values()),'SNAP_FORMAT')
def verify_report(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','scenarios','finalSnapshot','sha256'},'FIELDS')
    for k,v in LOCK.items():require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']),'COMMIT')
    records=doc['scenarios']
    require(type(records) is dict and set(records)==set(SCENARIOS),'SCENARIOS')
    previous=None
    for name in SCENARIOS:
        data=records[name]
        require(type(data) is dict and set(data)=={'before','afterCommit','afterIdenticalReplay','afterConflict',
           'firstServerCommitted','firstClientResponseObserved','identicalReplayResult',
           'conflictSqlstate','conflictReason','operationRows','auditRows'},'SCENARIO_FIELDS_'+name)
        for k in ('before','afterCommit','afterIdenticalReplay','afterConflict'):valid_snapshot(data[k])
        if previous is not None:require(data['before']==previous,'CHAIN_'+name)
        previous=data['afterConflict']
        require(data['before']!=data['afterCommit'],'NO_COMMIT_'+name)
        require(data['afterCommit']==data['afterIdenticalReplay']==data['afterConflict'],'DUPLICATE_MUTATION_'+name)
        require(type(data['firstServerCommitted']) is bool and data['firstServerCommitted'],'SERVER_COMMIT_'+name)
        require(type(data['firstClientResponseObserved']) is bool and not data['firstClientResponseObserved'],'RESPONSE_VISIBLE_'+name)
        require(type(data['identicalReplayResult']) is str and data['identicalReplayResult']=='IDEMPOTENT','REPLAY_RESULT_'+name)
        require(type(data['conflictSqlstate']) is str and data['conflictSqlstate']=='22023','SQLSTATE_'+name)
        require(type(data['conflictReason']) is str and data['conflictReason']==DENIALS[name],'CONFLICT_REASON_'+name)
        require(type(data['operationRows']) is int and data['operationRows']==(0 if name=='booking' else 1),'OP_ROWS_'+name)
        require(type(data['auditRows']) is int and data['auditRows']==1,'AUDIT_ROWS_'+name)
    valid_snapshot(doc['finalSnapshot'])
    require(doc['finalSnapshot']==records['decide']['afterConflict'],'FINAL_SNAPSHOT')
    require(type(doc['sha256']) is str and re.fullmatch('[a-f0-9]{64}',doc['sha256']) and doc['sha256']==seal(doc),'HASH')
    return True

# Only SQL composed using hardcoded R138B helpers from fixed synthetic inputs.
ALLOWED_FUNCS=('claim_booking','change_booking','case_step')
def scoped_sql(sql):
    return type(sql) is str and sql.count(';')==1 and bool(re.fullmatch(
           r'SELECT car02_r138_qa\.(?:claim_booking|change_booking|case_step)\(.+\);',sql,re.S))
def execute_discarded_response(cid,actor,sql):
    require(type(cid) is str and CID.fullmatch(cid) and actor in ROLES and scoped_sql(sql),'CALL_SCOPE')
    # psql returns only after implicit autocommit; business output is discarded.
    # This models the client's unknown outcome, not a physical network disconnect.
    args=['docker','exec','-i',cid,'env','PGPASSWORD=r138-throwaway-only','psql',
          '-h','127.0.0.1','-X','-A','-t','-v','ON_ERROR_STOP=1',
          '-U',ROLES[actor],'-d',DB,'-c',sql]
    r=subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,timeout=25)
    require(r.returncode==0,'FIRST_COMMIT_FAILED')
    return True

def deny_changed_replay(cid,actor,sql,expected):
    require(type(cid) is str and CID.fullmatch(cid) and actor in ROLES and scoped_sql(sql)
            and expected in DENIALS.values(),'DENY_SCOPE')
    args=['docker','exec','-i',cid,'env','PGPASSWORD=r138-throwaway-only','psql',
          '-h','127.0.0.1','-X','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',
          '-U',ROLES[actor],'-d',DB,'-c',sql]
    r=subprocess.run(args,capture_output=True,text=True,timeout=25)
    require(r.returncode!=0 and re.search(r'ERROR:\s*22023:\s*'+re.escape(expected)+r'\b',r.stderr),'CONFLICT_SQLSTATE_REASON')
    # Verbose mode exposes both SQLSTATE and the exact fixed R138B reason.
    return '22023'

def save(doc,dest):
    require(isinstance(dest,Path) and dest.parent.is_dir() and not dest.parent.is_symlink()
            and not dest.exists() and not dest.is_symlink(),'OUTPUT_PATH')
    verify_report(doc)
    with dest.open('x',encoding='ascii') as f:
        json.dump(doc,f,indent=2,sort_keys=True,ensure_ascii=True,allow_nan=False);f.write('\n')
    restored=json.loads(dest.read_text(encoding='ascii'))
    require(restored==doc and verify_report(restored),'ROUNDTRIP')
    return dest

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid),'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit),'COMMIT_ARG')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit
        and os.environ.get('CAR02_RELEASE_LOCK')=='true'
        and os.environ.get('R209_DISPOSABLE_QA')=='yes','ENV_LOCK')
    target=Path(out)
    require(target.parent.is_dir() and not target.exists() and not target.parent.is_symlink(),'DESTINATION')
    day=next_business_days(1)[0];owner=ROLES['a1']
    # Seed only R138B synthetic test data into exact ephemeral CI database.
    require(booking(cid,DB,'as','r209_seed_move',owner,day,'10:00')=='CREATED','SEED_MOVE')
    require(booking(cid,DB,'as','r209_seed_quote',owner,day,'11:00')=='CREATED','SEED_QUOTE')
    require(booking(cid,DB,'as','r209_seed_decide',owner,day,'12:00')=='CREATED','SEED_DECIDE')
    bids={n:integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r209_seed_{n}';")
          for n in ('move','quote','decide')}
    for n in ('quote','decide'):
        require(case(cid,DB,'as','r209_case_'+n,bids[n])=='OPENED','SEED_CASE_'+n)
    cids={n:integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={bids[n]};")
          for n in ('quote','decide')}
    for n in ('quote','decide'):
        require(step(cid,DB,'as','r209_report_'+n,cids[n],'REPORT',1,
               note='Synthetic committed acknowledgement loss inspection')=='REPORT_SAVED','SEED_REPORT_'+n)
    require(step(cid,DB,'as','r209_quote_for_decide',cids['decide'],'QUOTE',2,part=1300,labor=800)=='QUOTE_PRESENTED','SEED_DECIDE_QUOTE')
    keys={n:'r209_ack_missing_'+n for n in SCENARIOS}
    specs={
       'booking':('as',sql_book(keys['booking'],owner,day,'13:00'),
            lambda:booking(cid,DB,'as',keys['booking'],owner,day,'13:00'),
            sql_book(keys['booking'],owner,day,'13:30'),None,None),
       'move':('a1',sql_change(keys['move'],bids['move'],'MOVE',1,day,'10:30'),
            lambda:change(cid,'a1',keys['move'],bids['move'],'MOVE',1,day,'10:30'),
            sql_change(keys['move'],bids['move'],'MOVE',1,day,'14:00'),'booking_operations',bids['move']),
       'quote':('as',sql_step(keys['quote'],cids['quote'],'QUOTE',2,part=1000,labor=900),
            lambda:step(cid,DB,'as',keys['quote'],cids['quote'],'QUOTE',2,part=1000,labor=900),
            sql_step(keys['quote'],cids['quote'],'QUOTE',2,part=1001,labor=900),'case_operations',cids['quote']),
       'decide':('a1',sql_step(keys['decide'],cids['decide'],'DECIDE',3,choice='APPROVE'),
            lambda:step(cid,DB,'a1',keys['decide'],cids['decide'],'DECIDE',3,choice='APPROVE'),
            sql_step(keys['decide'],cids['decide'],'DECIDE',3,choice='DECLINE'),'case_operations',cids['decide']),
    }
    scenarios={}
    for name in SCENARIOS:
        actor,sql,retry,wrong,op_table,entity=specs[name]
        before=snapshot(cid)
        execute_discarded_response(cid,actor,sql)
        after_commit=snapshot(cid)
        require(after_commit!=before,'FIRST_NOT_COMMITTED_'+name)
        require(retry()=='IDEMPOTENT','RETRY_NOT_IDEMPOTENT_'+name)
        after_identical=snapshot(cid)
        require(after_identical==after_commit,'REPLAY_MUTATED_'+name)
        state=deny_changed_replay(cid,actor,wrong,DENIALS[name])
        after_conflict=snapshot(cid)
        require(after_conflict==after_commit,'CONFLICT_MUTATED_'+name)
        if name=='booking':
            entity=integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='{keys[name]}';")
            count=0
        else:
            count=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.{op_table} WHERE request_key='{keys[name]}';")
        audit=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={entity} AND action='{ACTIONS[name]}';")
        require(count==(0 if name=='booking' else 1) and audit==1,'ONCE_'+name)
        scenarios[name]=dict(before=before,afterCommit=after_commit,afterIdenticalReplay=after_identical,
              afterConflict=after_conflict,firstServerCommitted=True,firstClientResponseObserved=False,
              identicalReplayResult='IDEMPOTENT',conflictSqlstate=state,conflictReason=DENIALS[name],
              operationRows=count,auditRows=audit)
    doc=dict(LOCK,githubCommit=commit,scenarios=scenarios,finalSnapshot=snapshot(cid))
    doc['sha256']=seal(doc)
    save(doc,target)
    print('R209_DISPOSABLE_PG17_COMMITTED_RESPONSE_DISCARDED_FOUR_IDEMPOTENT_RETRIES_NO_GO_HOLD_PASS')
    return doc

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--cid',required=True);ap.add_argument('--commit',required=True);ap.add_argument('--out',default=OUT)
    a=ap.parse_args();probe(a.cid,a.commit,a.out)
if __name__=='__main__':main()

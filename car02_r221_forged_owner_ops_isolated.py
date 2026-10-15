#!/usr/bin/env python3
"""R221: foreign customer / foreign tenant forged IDs under parallel denials.

ONLY the disposable R138B PostgreSQL17 synthetic fixture. No live data or deployment.
Two forged roles × four independent sessions; five-table immutability followed
by legitimate successful command and precisely one matching audit event.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from car02_r138_pg17_lifecycle_qa import ROLES, booking, case, step, integer, psql
from car02_r159_concurrent_booking_isolated import CID, COMMIT, DB, change
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import TABLES, snapshot
from car02_r191_transaction_rollback_isolated import sql_change, sql_step

OUT='qa-evidence-r221/r221-forged-owner-operations-proof.json'
STAGES=('move','cancel','decision','report')
ATTACKERS={'move':('a2','b1'),'cancel':('a2','b1'),
           'decision':('a2','b1'),'report':('a2','bs')}
REASONS={'move':('R138_OWNER_DENIED','R138_BOOKING_NOT_FOUND'),
         'cancel':('R138_OWNER_DENIED','R138_BOOKING_NOT_FOUND'),
         'decision':('R138_OWNER_DENIED','R138_CASE_NOT_FOUND'),
         'report':('R138_ROLE_DENIED','R138_CASE_NOT_FOUND')}
AUTHORIZED={'move':'MOVED','cancel':'CANCELLED','decision':'APPROVED','report':'REPORT_SAVED'}
ACTIONS={'move':'MOVE','cancel':'CANCEL','decision':'DECIDE','report':'REPORT'}
N=8
LOCK={'version':'R221','mode':'DISPOSABLE_PG17_PARALLEL_FORGED_IDS_DENIED_AUTHORIZED_SURVIVES_ONLY',
      'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
      'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
      'productionReady':False,'realAuthenticationVerified':False,'realRLSVerified':False,
      'externalWitnessVerified':False,'externalSignatureVerified':False,
      'fixtureDb':DB,'fixtureRoles':5,'fiveTablesCovered':True,
      'parallelAttackerSessions':8,'sameShopAndOtherShopDenied':True,
      'deniedFiveTableImmutability':True,'legitimateOperationExactlyOnce':True,
      'R138BAndR218Immutable':True}
class ForgeryError(AssertionError):pass
def require(ok,code):
    if not ok:raise ForgeryError('R221_'+code)
def seal(doc):
    return hashlib.sha256(json.dumps({k:v for k,v in doc.items() if k!='sha256'},
          sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('ascii')).hexdigest()
def snap_valid(x):
    require(type(x) is dict and set(x)==set(TABLES),'SNAP_TABLES')
    require(all(type(v) is str and re.fullmatch('[0-9a-f]{32}',v) is not None for v in x.values()),'SNAP_DIGEST')

def verify_report(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','stages','finalSnapshot','sha256'},'FIELDS')
    for k,v in LOCK.items():require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']) is not None,'COMMIT')
    require(type(doc['stages']) is dict and set(doc['stages'])==set(STAGES),'STAGE_SHAPE')
    last=None
    for stage in STAGES:
        row=doc['stages'][stage]
        require(type(row) is dict and set(row)=={'before','afterDenied','afterAuthorized','attacks',
                                                 'authorizedResult','operationRows','auditRows','finalState'},'ROW_KEYS_'+stage)
        for phase in ('before','afterDenied','afterAuthorized'):snap_valid(row[phase])
        if last is not None:require(row['before']==last,'SNAP_CHAIN_'+stage)
        last=row['afterAuthorized']
        require(row['before']==row['afterDenied'],'DENIED_MUTATED_'+stage)
        require(row['afterDenied']!=row['afterAuthorized'],'AUTH_DID_NOT_WRITE_'+stage)
        attacks=row['attacks']
        require(type(attacks) is list and len(attacks)==N,'ATTACK_COUNT_'+stage)
        for i,attack in enumerate(attacks):
            require(type(attack) is dict and set(attack)=={'actor','sqlstate','reason'},'ATTACK_KEYS_'+stage)
            require(attack=={'actor':ATTACKERS[stage][i%2], 'sqlstate':'42501',
                    'reason':REASONS[stage][i%2]},'DENIAL_MISMATCH_'+stage)
        require(type(row['authorizedResult']) is str and row['authorizedResult']==AUTHORIZED[stage],'AUTH_RESULT_'+stage)
        require(type(row['operationRows']) is int and row['operationRows']==1,'OP_COUNT_'+stage)
        require(type(row['auditRows']) is int and row['auditRows']==1,'AUDIT_COUNT_'+stage)
        require(type(row['finalState']) is str and row['finalState']==
                {'move':'ACTIVE','cancel':'CANCELLED','decision':'APPROVED','report':'REPORTED'}[stage],
                'STATE_'+stage)
    snap_valid(doc['finalSnapshot'])
    require(doc['finalSnapshot']==doc['stages']['report']['afterAuthorized'],'FINAL_SNAPSHOT')
    require(type(doc['sha256']) is str and re.fullmatch('[0-9a-f]{64}',doc['sha256']) is not None
            and doc['sha256']==seal(doc),'SHA256')
    return True

def denied(cid,actor,sql,reason):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(actor in ROLES and reason in set(sum((list(x) for x in REASONS.values()),[])),'DENY_ROLE_REASON')
    require(type(sql) is str and sql.count(';')==1 and re.fullmatch(
       r'SELECT car02_r138_qa\.(?:change_booking|case_step)\(.+\);',sql,re.S) is not None,'SQL_SCOPE')
    proc=subprocess.run(['docker','exec','-i',cid,'env','PGPASSWORD=r138-throwaway-only','psql',
       '-h','127.0.0.1','-X','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',
       '-U',ROLES[actor],'-d',DB,'-c',sql],capture_output=True,text=True,timeout=35)
    require(proc.returncode!=0 and re.search(r'ERROR:\s*42501:\s*'+re.escape(reason)+r'\b',proc.stderr) is not None,
            'SQLSTATE_REASON_'+actor)
    return {'actor':actor,'sqlstate':'42501','reason':reason}

def parallel_denials(cid,stage,sql):
    require(stage in STAGES and callable(sql),'PARALLEL_ARGS')
    gate=Barrier(N)
    def worker(i):
        gate.wait(timeout=15)
        return denied(cid,ATTACKERS[stage][i%2],sql(),REASONS[stage][i%2])
    with ThreadPoolExecutor(max_workers=N) as ex:
        futures=[ex.submit(worker,i) for i in range(N)]
        return [f.result(timeout=60) for f in futures]

def save(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
            and not path.exists() and not path.is_symlink(),'OUTPUT_PATH')
    verify_report(doc)
    with path.open('x',encoding='ascii') as f:
        json.dump(doc,f,sort_keys=True,ensure_ascii=True,indent=2,allow_nan=False);f.write('\n')
    restored=json.loads(path.read_text(encoding='ascii'))
    require(restored==doc and verify_report(restored),'ROUNDTRIP')
    return path

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit and os.environ.get('CAR02_RELEASE_LOCK')=='true'
            and os.environ.get('R221_DISPOSABLE_QA')=='yes','ENV_LOCK')
    path=Path(out)
    require(path.parent.is_dir() and not path.parent.is_symlink() and not path.exists(),'DESTINATION')
    require(snapshot(cid)==dict.fromkeys(TABLES,hashlib.md5(b'[]').hexdigest()),'DB_NOT_EMPTY')
    day=next_business_days(1)[0]
    owner=ROLES['a1']
    times={'move':'10:00','cancel':'11:00','decision':'12:00','report':'13:00'}
    # Seed all four targets before stage evidence so stage hashes form a full chain.
    bids={}
    for name in STAGES:
        key='r221_seed_booking_'+name
        require(booking(cid,DB,'as',key,owner,day,times[name])=='CREATED','SEED_'+name)
        bids[name]=integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='{key}';")
    cases={}
    for name in ('decision','report'):
        require(case(cid,DB,'as','r221_seed_case_'+name,bids[name])=='OPENED','CASE_SEED_'+name)
        cases[name]=integer(cid,DB,'as',f'SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={bids[name]};')
    require(step(cid,DB,'as','r221_seed_report_decision',cases['decision'],'REPORT',1,
            note='Synthetic owner authorization isolation')=='REPORT_SAVED','DECISION_REPORT_SEED')
    require(step(cid,DB,'as','r221_seed_quote_decision',cases['decision'],'QUOTE',2,
            part=1400,labor=900)=='QUOTE_PRESENTED','DECISION_QUOTE_SEED')
    specs={
      'move':(sql_change('r221_attack_move',bids['move'],'MOVE',1,day,'10:30'),
              lambda:change(cid,'a1','r221_allow_move',bids['move'],'MOVE',1,day,'10:30'),
              'booking_operations',bids['move'],'bookings'),
      'cancel':(sql_change('r221_attack_cancel',bids['cancel'],'CANCEL',1),
              lambda:change(cid,'a1','r221_allow_cancel',bids['cancel'],'CANCEL',1),
              'booking_operations',bids['cancel'],'bookings'),
      'decision':(sql_step('r221_attack_decide',cases['decision'],'DECIDE',3,choice='APPROVE'),
              lambda:step(cid,DB,'a1','r221_allow_decide',cases['decision'],'DECIDE',3,choice='APPROVE'),
              'case_operations',cases['decision'],'service_cases'),
      'report':(sql_step('r221_attack_report',cases['report'],'REPORT',1,note='Synthetic forbidden foreign report'),
              lambda:step(cid,DB,'as','r221_allow_report',cases['report'],'REPORT',1,
                           note='Synthetic legitimate staff report'),
              'case_operations',cases['report'],'service_cases'),
    }
    rows={}
    for name in STAGES:
        attack,allow,ops,entity,table=specs[name]
        before=snapshot(cid)
        rejected=parallel_denials(cid,name,lambda:attack)
        after_denied=snapshot(cid)
        require(before==after_denied,'DENIED_DRIFT_'+name)
        authorized=allow()
        require(authorized==AUTHORIZED[name],'LEGITIMATE_REJECTED_'+name)
        after_authorized=snapshot(cid)
        require(after_denied!=after_authorized,'NO_WRITE_'+name)
        action=ACTIONS[name]
        count=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.{ops} WHERE {('booking_id' if ops=='booking_operations' else 'case_id')}={entity} AND request_key='r221_allow_{'decide' if name=='decision' else name}';")
        audit=integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={entity} AND action='{action}';")
        state=psql(cid,DB,'as',f'SELECT state FROM car02_r138_qa.{table} WHERE id={entity};')
        require(count==audit==1,'DUPLICATE_'+name)
        rows[name]={'before':before,'afterDenied':after_denied,'afterAuthorized':after_authorized,
                    'attacks':rejected,'authorizedResult':authorized,'operationRows':count,'auditRows':audit,'finalState':state}
    doc=dict(LOCK,githubCommit=commit,stages=rows,finalSnapshot=snapshot(cid))
    doc['sha256']=seal(doc)
    save(doc,path)
    print('R221_DISPOSABLE_PG17_PARALLEL_FORGED_OWNER_IDS_DENIED_FIVE_TABLE_IMMUTABLE_AUTHORIZED_ONCE_NO_GO_HOLD')
    return doc

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--cid',required=True);ap.add_argument('--commit',required=True);ap.add_argument('--out',default=OUT)
    a=ap.parse_args();probe(a.cid,a.commit,a.out)
if __name__=='__main__': main()

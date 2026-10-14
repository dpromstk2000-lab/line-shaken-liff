#!/usr/bin/env python3
"""R171 independent denied-command immutability regression for disposable R138B PG17.

Only throwaway PostgreSQL 17 service, synthetic customer roles, one non-retained
fixture DB. All five full tables are hashed before and after rejected commands.
This does NOT establish real authentication, production RLS, or release readiness.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from car02_r138_pg17_lifecycle_qa import ROLES, booking, case, step, integer, psql, lit
from car02_r159_concurrent_booking_isolated import DB, CID, COMMIT
from car02_r162_booking_stress_isolated import next_business_days

OUT='qa-evidence-r171/r171-rejected-command-immutability.json'
# The immutable R138B lit() guard intentionally rejects commas in SQL strings.
REPORT_NOTE='Synthetic brake pads checked with no user data'
TABLES=('bookings','service_cases','case_operations','booking_operations','audit_events')
REASONS=('R138_ROLE_DENIED','R138_REPORT_RULE','R138_REPLAY_MISMATCH',
         'R138_STALE_VERSION','R138_QUOTE_RULE','R138_OWNER_DENIED',
         'R138_CASE_NOT_FOUND','R138_DECISION_RULE','R138_APPROVAL_REQUIRED')
REQUIRED_CHECKS=('reportRole','reportEmpty','reportAlteredReplay','reportStale',
 'quoteNegative','quoteAlteredReplay','quoteStale','keyCrossCase',
 'otherCustomerDecision','otherShopDecision','staffDecision','invalidChoice',
 'decisionAlteredReplay','ownerComplete','staleComplete','doubleComplete',
 'declinedComplete','afterCompleteReport','afterCompleteDecision','directWrite')
CHECK_REASON={
 'reportRole':'R138_ROLE_DENIED','reportEmpty':'R138_REPORT_RULE',
 'reportAlteredReplay':'R138_REPLAY_MISMATCH','reportStale':'R138_STALE_VERSION',
 'quoteNegative':'R138_QUOTE_RULE','quoteAlteredReplay':'R138_REPLAY_MISMATCH',
 'quoteStale':'R138_STALE_VERSION','keyCrossCase':'R138_REPLAY_MISMATCH',
 'otherCustomerDecision':'R138_OWNER_DENIED','otherShopDecision':'R138_CASE_NOT_FOUND',
 'staffDecision':'R138_ROLE_DENIED','invalidChoice':'R138_DECISION_RULE',
 'decisionAlteredReplay':'R138_REPLAY_MISMATCH','ownerComplete':'R138_ROLE_DENIED',
 'staleComplete':'R138_STALE_VERSION','doubleComplete':'R138_APPROVAL_REQUIRED',
 'declinedComplete':'R138_APPROVAL_REQUIRED','afterCompleteReport':'R138_REPORT_RULE',
 'afterCompleteDecision':'R138_DECISION_RULE','directWrite':'DIRECT_DML_DENIED',
}
LOCK={
 'version':'R171', 'mode':'DISPOSABLE_PG17_FIVE_TABLE_REJECTION_IMMUTABILITY_ONLY',
 'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
 'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
 'realAuthenticationVerified':False,'realRLSVerified':False,
 'externalWitnessVerified':False,'externalSignatureVerified':False,
 'independentProductionTest':False,'externalEvidenceWitness':False,
 'syntheticDb':DB,'fixtureRoles':5,'fiveTablesCovered':True,
 'rejectedCommandsDoNotMutate':True,'validAuditExactlyOnce':True,
 'sameShopDifferentCustomerDenied':True,'crossShopDenied':True,
 'immutableR138BFixture':True,'priorR168Unchanged':True,
}
class RegressionError(AssertionError):pass

def require(condition, code):
    if not condition:raise RegressionError('R171_'+code)

def seal(report):
    core={k:v for k,v in report.items() if k!='sha256'}
    return hashlib.sha256(json.dumps(core,sort_keys=True,ensure_ascii=True,
                 separators=(',',':'),allow_nan=False).encode('ascii')).hexdigest()

def validate_snapshot(value):
    require(type(value) is dict and set(value)==set(TABLES),'SNAPSHOT_FIELDS')
    for table in TABLES:
        require(type(value[table]) is str and re.fullmatch('[a-f0-9]{32}',value[table]) is not None,'SNAPSHOT_DIGEST')
    return True

def verify_report(report):
    require(type(report) is dict and set(report)==set(LOCK)|{'githubCommit','denied','denialSnapshots','snapshots','audits','sha256'},'FIELDS')
    for name,value in LOCK.items():
        require(type(report[name]) is type(value) and report[name]==value,'LOCK_'+name)
    require(type(report['githubCommit']) is str and COMMIT.fullmatch(report['githubCommit']) is not None,'COMMIT')
    require(type(report['denied']) is dict and set(report['denied'])==set(REQUIRED_CHECKS),'CHECK_FIELDS')
    for name in REQUIRED_CHECKS:
        require(type(report['denied'][name]) is str and report['denied'][name]==CHECK_REASON[name],'CHECK_'+name)
    require(report['denied']['directWrite']=='DIRECT_DML_DENIED','DIRECT_DML')
    require(type(report['denialSnapshots']) is dict and set(report['denialSnapshots'])==set(REQUIRED_CHECKS),'REJECTION_SNAPSHOTS')
    for name in REQUIRED_CHECKS:
        pair=report['denialSnapshots'][name]
        require(type(pair) is dict and set(pair)=={'before','after'},'PAIR_FIELDS')
        validate_snapshot(pair['before']);validate_snapshot(pair['after'])
        require(pair['before']==pair['after'],'DENIED_MUTATION_'+name)
    require(type(report['snapshots']) is dict and set(report['snapshots'])=={'initial','final'},'SNAPSHOTS')
    for entry in report['snapshots'].values():validate_snapshot(entry)
    require(type(report['audits']) is dict and set(report['audits'])=={'a1','a2','b1'},'AUDITS')
    for owner,counts in report['audits'].items():
        require(type(counts) is dict and set(counts)=={'REPORT','QUOTE','DECIDE','COMPLETE'},'AUDIT_SHAPE')
        expected={'REPORT':1,'QUOTE':1,'DECIDE':1,'COMPLETE':0 if owner=='a2' else 1}
        require(all(type(counts[k]) is int and counts[k]==v for k,v in expected.items()),'AUDIT_ONCE')
    require(type(report['sha256']) is str and re.fullmatch('[a-f0-9]{64}',report['sha256']) is not None
            and report['sha256']==seal(report),'SHA256')
    return True

def snapshot(cid):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    parts=[f"(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]')) FROM car02_r138_qa.{table} t)"
           for table in TABLES]
    sql='SELECT concat_ws(\'|\','+','.join(parts)+');'
    result=subprocess.run(['docker','exec','-i',cid,'psql','-X','-A','-t','-v','ON_ERROR_STOP=1',
                           '-U','postgres','-d',DB,'-c',sql],capture_output=True,text=True,timeout=30)
    require(result.returncode==0,'SNAPSHOT_SQL')
    values=result.stdout.strip().split('|')
    require(len(values)==len(TABLES),'SNAPSHOT_LENGTH')
    report=dict(zip(TABLES,values))
    validate_snapshot(report)
    return report

def sql_step(key,case_id,op,version,note=None,part=None,labor=None,choice=None):
    require(type(case_id) is int and case_id>0 and type(version) is int and version>0,'ARGS')
    # Only this disposable negative-amount QA probe may emit the signed integer -1.
    # All other values still pass the unchanged R138B literal allowlist.
    def amount(value):
        return '-1' if type(value) is int and value == -1 else lit(value)
    args=[lit(key),str(case_id),lit(op),str(version),lit(note),amount(part),amount(labor),lit(choice)]
    return 'SELECT car02_r138_qa.case_step('+','.join(args)+');'

def no_mutation(cid,role,query,reason,capture=None,label=None):
    require(type(reason) is str and reason in REASONS+('DIRECT_DML_DENIED',),'REASON')
    before=snapshot(cid)
    response=psql(cid,DB,role,query,False,expected_error='permission denied' if reason=='DIRECT_DML_DENIED' else reason)
    require(response=='REJECTED','NOT_REJECTED')
    after=snapshot(cid)
    require(after==before,'DENIED_CHANGED_FIVE_TABLES')
    if capture is not None:
        require(type(capture) is dict and type(label) is str and label in REQUIRED_CHECKS and label not in capture,'CAPTURE')
        capture[label]={'before':before,'after':after}
    return reason

def save(report,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
            and not path.exists() and not path.is_symlink(),'OUTPUT_PATH')
    verify_report(report)
    raw=json.dumps(report,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False)+'\n'
    with path.open('x',encoding='ascii') as file:file.write(raw)
    decoded=json.loads(path.read_text(encoding='ascii'))
    require(decoded==report and verify_report(decoded),'OUTPUT_ROUNDTRIP')
    return path

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT_ARG')
    require(out==OUT,'OUTPUT_NAME')
    require(os.environ.get('GITHUB_SHA')==commit and os.environ.get('CAR02_RELEASE_LOCK')=='true'
            and os.environ.get('R171_DISPOSABLE_QA')=='yes','ENV_LOCK')
    target=Path(out)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'OUTPUT_EXISTS')
    initial=snapshot(cid)
    require(initial==dict.fromkeys(TABLES,hashlib.md5(b'[]').hexdigest()),'EMPTY_FIXTURE')
    day=next_business_days(1)[0]
    ids={}
    for owner,staff,hour in [('a1','as','10:00'),('a2','as','11:00'),('b1','bs','10:00')]:
        require(booking(cid,DB,staff,f'r171_seed_book_{owner}',ROLES[owner],day,hour)=='CREATED','BOOK')
        bid=integer(cid,DB,staff,f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r171_seed_book_{owner}';")
        require(case(cid,DB,staff,f'r171_seed_case_{owner}',bid)=='OPENED','CASE')
        ids[owner]=integer(cid,DB,staff,f'SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={bid};')
    c=ids['a1'];a2=ids['a2'];b1=ids['b1'];denied={};evidence={}
    def deny(label,actor,cmd,reason):denied[label]=no_mutation(cid,actor,cmd,reason,evidence,label)
    deny('reportRole','a1',sql_step('r171_owner_report',c,'REPORT',1,note='A valid but forbidden owner report'),'R138_ROLE_DENIED')
    deny('reportEmpty','as',sql_step('r171_empty_note',c,'REPORT',1,note='x'),'R138_REPORT_RULE')
    note=REPORT_NOTE
    require(step(cid,DB,'as','r171_valid_report',c,'REPORT',1,note=note)=='REPORT_SAVED','REPORT')
    deny('reportAlteredReplay','as',sql_step('r171_valid_report',c,'REPORT',1,note=note+' changed'),'R138_REPLAY_MISMATCH')
    deny('reportStale','as',sql_step('r171_stale_report',c,'REPORT',1,note=note),'R138_STALE_VERSION')
    deny('quoteNegative','as',sql_step('r171_negative_quote',c,'QUOTE',2,part=-1,labor=100),'R138_QUOTE_RULE')
    require(step(cid,DB,'as','r171_valid_quote',c,'QUOTE',2,part=1200,labor=1300)=='QUOTE_PRESENTED','QUOTE')
    deny('quoteAlteredReplay','as',sql_step('r171_valid_quote',c,'QUOTE',2,part=1200,labor=1500),'R138_REPLAY_MISMATCH')
    deny('quoteStale','as',sql_step('r171_stale_quote',c,'QUOTE',2,part=1200,labor=1300),'R138_STALE_VERSION')
    require(step(cid,DB,'as','r171_a2_report',a2,'REPORT',1,note=note)=='REPORT_SAVED','A2_REPORT')
    require(step(cid,DB,'as','r171_a2_quote',a2,'QUOTE',2,part=500,labor=500)=='QUOTE_PRESENTED','A2_QUOTE')
    require(step(cid,DB,'bs','r171_b1_report',b1,'REPORT',1,note=note)=='REPORT_SAVED','B1_REPORT')
    require(step(cid,DB,'bs','r171_b1_quote',b1,'QUOTE',2,part=600,labor=700)=='QUOTE_PRESENTED','B1_QUOTE')
    deny('keyCrossCase','as',sql_step('r171_valid_report',a2,'REPORT',1,note=note),'R138_REPLAY_MISMATCH')
    deny('otherCustomerDecision','a2',sql_step('r171_foreign_owner',c,'DECIDE',3,choice='APPROVE'),'R138_OWNER_DENIED')
    deny('otherShopDecision','b1',sql_step('r171_foreign_shop',c,'DECIDE',3,choice='APPROVE'),'R138_CASE_NOT_FOUND')
    deny('staffDecision','as',sql_step('r171_staff_approve',c,'DECIDE',3,choice='APPROVE'),'R138_ROLE_DENIED')
    deny('invalidChoice','a1',sql_step('r171_bad_choice',c,'DECIDE',3,choice='UNKNOWN'),'R138_DECISION_RULE')
    require(step(cid,DB,'a1','r171_decide_a1',c,'DECIDE',3,choice='APPROVE')=='APPROVED','APPROVE')
    before=snapshot(cid)
    require(step(cid,DB,'a1','r171_decide_a1',c,'DECIDE',3,choice='APPROVE')=='IDEMPOTENT','APPROVE_REPLAY')
    require(snapshot(cid)==before,'APPROVE_REPLAY_MUTATED')
    deny('decisionAlteredReplay','a1',sql_step('r171_decide_a1',c,'DECIDE',3,choice='DECLINE'),'R138_REPLAY_MISMATCH')
    deny('ownerComplete','a1',sql_step('r171_owner_complete',c,'COMPLETE',4),'R138_ROLE_DENIED')
    deny('staleComplete','as',sql_step('r171_stale_complete',c,'COMPLETE',3),'R138_STALE_VERSION')
    require(step(cid,DB,'as','r171_complete_a1',c,'COMPLETE',4)=='COMPLETED','COMPLETE')
    before=snapshot(cid)
    require(step(cid,DB,'as','r171_complete_a1',c,'COMPLETE',4)=='IDEMPOTENT','COMPLETE_REPLAY')
    require(snapshot(cid)==before,'COMPLETE_REPLAY_MUTATED')
    deny('doubleComplete','as',sql_step('r171_complete_again',c,'COMPLETE',5),'R138_APPROVAL_REQUIRED')
    require(step(cid,DB,'a2','r171_decline_a2',a2,'DECIDE',3,choice='DECLINE')=='DECLINED','DECLINE')
    deny('declinedComplete','as',sql_step('r171_complete_declined',a2,'COMPLETE',4),'R138_APPROVAL_REQUIRED')
    require(step(cid,DB,'b1','r171_approve_b1',b1,'DECIDE',3,choice='APPROVE')=='APPROVED','B1_APPROVE')
    require(step(cid,DB,'bs','r171_complete_b1',b1,'COMPLETE',4)=='COMPLETED','B1_COMPLETE')
    deny('afterCompleteReport','as',sql_step('r171_late_report',c,'REPORT',5,note=note),'R138_REPORT_RULE')
    deny('afterCompleteDecision','a1',sql_step('r171_late_decision',c,'DECIDE',5,choice='DECLINE'),'R138_DECISION_RULE')
    deny('directWrite','a1','DELETE FROM car02_r138_qa.service_cases;','DIRECT_DML_DENIED')
    audits={}
    for owner,staff in [('a1','as'),('a2','as'),('b1','bs')]:
        caseid=ids[owner]
        audits[owner]={}
        for op in ('REPORT','QUOTE','DECIDE','COMPLETE'):
            ops=integer(cid,DB,staff,f"SELECT count(*) FROM car02_r138_qa.case_operations WHERE case_id={caseid} AND op='{op}';")
            events=integer(cid,DB,staff,f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={caseid} AND action='{op}' AND owner_login='{ROLES[owner]}';")
            require(ops==events,'AUDIT_OPERATION_PARITY')
            audits[owner][op]=ops
    require(set(denied)==set(REQUIRED_CHECKS),'CHECK_COVERAGE')
    report=dict(LOCK,githubCommit=commit,denied=denied,denialSnapshots=evidence,snapshots={'initial':initial,'final':snapshot(cid)},audits=audits)
    report['sha256']=seal(report)
    save(report,target)
    print('R171_PG17_FIVE_TABLE_DENIED_OPERATION_IMMUTABILITY_PASS_NO_GO_HOLD')
    return report

def main():
    p=argparse.ArgumentParser();p.add_argument('--cid',required=True);p.add_argument('--commit',required=True)
    p.add_argument('--out',default=OUT);a=p.parse_args();probe(a.cid,a.commit,a.out)
if __name__=='__main__':main()

#!/usr/bin/env python3
"""R168: concurrent service-case lifecycle on the immutable R138B disposable PG17 fixture.

Synthetic accounts and local disposable container only. This is NOT authentication,
RLS verification on production, a SQL migration, or authority to deploy.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
from car02_r138_pg17_lifecycle_qa import ROLES, booking, case, step, integer, psql, lit, digest
from car02_r159_concurrent_booking_isolated import DB, CID, COMMIT, concurrent_sql, in_parallel
from car02_r162_booking_stress_isolated import next_business_days

OUT='qa-evidence-r168/r168-case-lifecycle-concurrency.json'
GATES={
 'version':'R168', 'mode':'DISPOSABLE_PG17_CASE_REPORT_QUOTE_COMPLETION_RACE_ONLY',
 'release':'NO_GO', 'migration':'HOLD', 'realWorldGatesOpen':12,
 'syntheticOnly':True, 'productionTouched':False,'productionAuthorized':False,
 'realAuthenticationVerified':False,'realRLSVerified':False,
 'externalWitnessVerified':False,'externalSignatureVerified':False,
 'independentProductionTest':False,
 'originalR138BUnchanged':True,'originalR159Unchanged':True,
 'originalR162Unchanged':True,'originalR165Unchanged':True,
 'syntheticDb':'car02_r138_qa_ci','fixtureRoles':5,'casesTested':3,
 'concurrentReportOneWinner':True,'concurrentQuoteOneWinner':True,
 'approvalOwnerBound':True,'completionIdempotent':True,
 'deniedOperationsImmutable':True,'auditsExactlyOnce':True,
 'crossShopIsolated':True,
}
class CaseRaceError(AssertionError):pass

def require(ok, code):
    if not ok:raise CaseRaceError('R168_'+code)

def sha(report):
    body={k:v for k,v in report.items() if k!='sha256'}
    return hashlib.sha256(json.dumps(body,sort_keys=True,ensure_ascii=True,
        separators=(',',':'),allow_nan=False).encode('ascii')).hexdigest()

def check_round(q):
    keys={'shop','customer','reportResults','quoteResults','completionResults','finalState','finalVersion','quoteTotal','reportWinner','quoteWinner'}
    require(type(q) is dict and set(q)==keys,'ROUND_FIELDS')
    require(q['shop'] in ('street_house_demo','other_demo') and type(q['shop']) is str,'SHOP')
    require(q['customer'] in ('a1','a2','b1') and type(q['customer']) is str,'CUSTOMER')
    require((q['shop']=='other_demo')==(q['customer']=='b1'),'SHOP_OWNER_MATCH')
    require(type(q['reportResults']) is list and sorted(q['reportResults'])==['REJECTED','REPORT_SAVED'],'REPORT_ONE_WINNER')
    require(type(q['quoteResults']) is list and sorted(q['quoteResults'])==['QUOTE_PRESENTED','REJECTED'],'QUOTE_ONE_WINNER')
    require(type(q['completionResults']) is list and sorted(q['completionResults'])==['COMPLETED']+['IDEMPOTENT']*5,'COMPLETE_ONCE')
    require(q['finalState']=='COMPLETED' and type(q['finalState']) is str and type(q['finalVersion']) is int and q['finalVersion']==5,'FINAL_STATE')
    require(type(q['quoteTotal']) is int and q['quoteTotal'] in (2750,3850) ,'QUOTE_TOTAL')
    require(type(q['reportWinner']) is int and q['reportWinner'] in (0,1),'REPORT_WINNER')
    require(type(q['quoteWinner']) is int and q['quoteWinner'] in (0,1),'QUOTE_WINNER')
    require(q['reportResults'][q['reportWinner']]=='REPORT_SAVED' and q['quoteResults'][q['quoteWinner']]=='QUOTE_PRESENTED','WINNER_ALIGNMENT')
    require(q['quoteTotal']==(2750 if q['quoteWinner']==0 else 3850),'QUOTE_AMOUNT_MATCHES_WINNER')
    return True

def verify_report(report):
    require(type(report) is dict and set(report)==set(GATES)|{'githubCommit','rounds','sha256'},'FIELDS')
    for k,v in GATES.items():require(type(report[k]) is type(v) and report[k]==v,'GATE_'+k)
    require(type(report['githubCommit']) is str and COMMIT.fullmatch(report['githubCommit']) is not None,'COMMIT')
    require(type(report['rounds']) is list and len(report['rounds'])==3,'ROUND_COUNT')
    for row in report['rounds']:check_round(row)
    require([row['customer'] for row in report['rounds']]==['a1','a2','b1'],'COVER_ALL_OWNERS')
    require(type(report['sha256']) is str and re.fullmatch(r'[a-f0-9]{64}',report['sha256']) is not None and report['sha256']==sha(report),'DIGEST')
    return True

def store(report,target):
    require(isinstance(target,Path) and target.parent.is_dir() and not target.parent.is_symlink()
      and not target.exists() and not target.is_symlink(), 'OUTPUT_SCOPE')
    verify_report(report)
    data=json.dumps(report,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False)+'\n'
    with target.open('x',encoding='ascii') as file:file.write(data)
    decoded=json.loads(target.read_text(encoding='ascii'))
    require(decoded==report and verify_report(decoded),'FILE_ROUNDTRIP')
    return target

def sql_case_step(cid,actor,key,case_id,operation,version,note=None,part=None,labor=None,choice=None,accepted=None,rejected=None):
    parts=[lit(key),str(case_id),lit(operation),str(version),lit(note),lit(part),lit(labor),lit(choice)]
    return concurrent_sql(cid,actor,'SELECT car02_r138_qa.case_step('+','.join(parts)+');',rejected,accepted)

def run_round(cid,idx,day,owner,staff):
    shop='other_demo' if owner=='b1' else 'street_house_demo'
    book_key=f'r168_booking_{idx:02}_fresh'
    case_key=f'r168_case_{idx:02}_fresh'
    hour=['10:00','11:00','12:00'][idx]
    require(booking(cid,DB,staff,book_key,ROLES[owner],day,hour)=='CREATED','BOOKING')
    book_id=integer(cid,DB,staff,f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='{book_key}';")
    require(case(cid,DB,staff,case_key,book_id)=='OPENED','CASE_OPEN')
    case_id=integer(cid,DB,staff,f'SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={book_id};')
    # Owner privacy checks happen before any write, including same-shop A1/A2.
    stranger='a2' if owner=='a1' else 'a1'
    require(integer(cid,DB,stranger,f'SELECT count(*) FROM car02_r138_qa.service_cases WHERE id={case_id};')==0,'OTHER_CUSTOMER_CANNOT_READ')
    other_shop='b1' if shop=='street_house_demo' else 'a1'
    require(integer(cid,DB,other_shop,f'SELECT count(*) FROM car02_r138_qa.service_cases WHERE id={case_id};')==0,'OTHER_SHOP_CANNOT_READ')
    notes=[f'Synthetic inspected brakes for case {idx}: safe A',f'Synthetic inspected brakes for case {idx}: safe B']
    report_key=f'r168_report_key_{idx:02}'
    reports=in_parallel([lambda n=n:sql_case_step(cid,staff,report_key,case_id,'REPORT',1,note=n,
                 accepted='REPORT_SAVED',rejected='R138_REPLAY_MISMATCH') for n in notes])
    require(sorted(reports)==['REJECTED','REPORT_SAVED'],'REPORT_RACE')
    winning_note=notes[reports.index('REPORT_SAVED')]
    require(psql(cid,DB,staff,f'SELECT report FROM car02_r138_qa.service_cases WHERE id={case_id};')==winning_note,'REPORT_WINNER_PAYLOAD')
    require(integer(cid,DB,staff,f'SELECT version FROM car02_r138_qa.service_cases WHERE id={case_id};')==2,'REPORT_VERSION')
    require(integer(cid,DB,staff,f"SELECT count(*) FROM car02_r138_qa.case_operations WHERE case_id={case_id} AND op='REPORT';")==1,'REPORT_JOURNAL')
    # Competing quotes have different idempotency keys. The second must be stale.
    quotes=[(1200,1300),(1800,1700)]
    results=in_parallel([lambda k=k,p=p,l=l:sql_case_step(cid,staff,f'r168_quote_{idx:02}_{k}',case_id,'QUOTE',2,
              part=p,labor=l,accepted='QUOTE_PRESENTED',rejected='R138_STALE_VERSION')
              for k,(p,l) in enumerate(quotes)])
    require(sorted(results)==['QUOTE_PRESENTED','REJECTED'],'QUOTE_RACE')
    winner=results.index('QUOTE_PRESENTED')
    subtotal=sum(quotes[winner]); total=subtotal+(subtotal+5)//10
    require(integer(cid,DB,staff,f'SELECT total_yen FROM car02_r138_qa.service_cases WHERE id={case_id};')==total,'WINNING_AMOUNT')
    require(integer(cid,DB,staff,f'SELECT version FROM car02_r138_qa.service_cases WHERE id={case_id};')==3,'QUOTE_VERSION')
    require(integer(cid,DB,staff,f"SELECT count(*) FROM car02_r138_qa.case_operations WHERE case_id={case_id} AND op='QUOTE';")==1,'QUOTE_JOURNAL')
    pre=digest(cid,DB)
    # Wrong owner in same shop and another shop cannot authorize a quote.
    require(step(cid,DB,stranger,f'r168_foreign_{idx:02}',case_id,'DECIDE',3,choice='APPROVE',success=False)=='REJECTED','FOREIGN_APPROVAL_DENIED')
    require(step(cid,DB,other_shop,f'r168_foreign_shop_{idx:02}',case_id,'DECIDE',3,choice='APPROVE',success=False)=='REJECTED','FOREIGN_SHOP_APPROVAL_DENIED')
    require(digest(cid,DB)==pre,'FOREIGN_ATTEMPTS_MUTATED')
    approval_key=f'r168_approve_{idx:02}_only'
    require(step(cid,DB,owner,approval_key,case_id,'DECIDE',3,choice='APPROVE')=='APPROVED','OWNER_APPROVAL')
    require(step(cid,DB,owner,approval_key,case_id,'DECIDE',3,choice='APPROVE')=='IDEMPOTENT','APPROVAL_REPLAY')
    require(step(cid,DB,owner,approval_key,case_id,'DECIDE',3,choice='DECLINE',success=False)=='REJECTED','APPROVAL_CHANGED_REPLAY')
    complete_key=f'r168_complete_{idx:02}_once'
    completion=in_parallel([lambda:step(cid,DB,staff,complete_key,case_id,'COMPLETE',4) for _ in range(6)])
    require(sorted(completion)==['COMPLETED']+['IDEMPOTENT']*5,'COMPLETE_RACE')
    require(psql(cid,DB,staff,f'SELECT state FROM car02_r138_qa.service_cases WHERE id={case_id};')=='COMPLETED','COMPLETED_STATE')
    require(integer(cid,DB,staff,f'SELECT version FROM car02_r138_qa.service_cases WHERE id={case_id};')==5,'COMPLETED_VERSION')
    for op in ('REPORT','QUOTE','DECIDE','COMPLETE'):
        require(integer(cid,DB,staff,f"SELECT count(*) FROM car02_r138_qa.case_operations WHERE case_id={case_id} AND op='{op}';")==1,'ONE_OPERATION_'+op)
        require(integer(cid,DB,staff,f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={case_id} AND action='{op}';")==1,'ONE_AUDIT_'+op)
    before=digest(cid,DB)
    require(step(cid,DB,staff,f'r168_complete_again_{idx:02}',case_id,'COMPLETE',5,success=False)=='REJECTED','CANNOT_COMPLETE_TWICE')
    require(step(cid,DB,owner,f'r168_late_decide_{idx:02}',case_id,'DECIDE',5,choice='DECLINE',success=False)=='REJECTED','CANNOT_REDECIDE')
    require(psql(cid,DB,owner,'DELETE FROM car02_r138_qa.service_cases;',False)=='REJECTED','DIRECT_DML_DENIED')
    require(digest(cid,DB)==before,'REJECTIONS_MUTATED')
    return {'shop':shop,'customer':owner,'reportResults':reports,'quoteResults':results,
      'completionResults':sorted(completion),'finalState':'COMPLETED','finalVersion':5,
      'quoteTotal':total,'reportWinner':reports.index('REPORT_SAVED'),'quoteWinner':winner}

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT_ARG')
    require(out==OUT,'OUT_NAME')
    require(os.environ.get('GITHUB_SHA')==commit and os.environ.get('CAR02_RELEASE_LOCK')=='true'
       and os.environ.get('R168_DISPOSABLE_QA')=='yes','ENV_HOLD')
    target=Path(out)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'OUTPUT_EXISTS')
    days=next_business_days(3)
    rounds=[run_round(cid,i,day,owner,staff) for i,(day,owner,staff) in enumerate(zip(days,('a1','a2','b1'),('as','as','bs')))]
    report=dict(GATES,githubCommit=commit,rounds=rounds)
    report['sha256']=sha(report)
    verify_report(report)
    store(report,target)
    print('R168_PG17_CASE_LIFECYCLE_CONCURRENCY_SYNTHETIC_PASS_NO_GO_HOLD')
    return report

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--cid',required=True);p.add_argument('--commit',required=True);p.add_argument('--out',default=OUT)
    a=p.parse_args();probe(a.cid,a.commit,a.out)
if __name__=='__main__':main()

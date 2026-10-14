#!/usr/bin/env python3
"""R188: negative PostgreSQL 17 role escalation regression, disposable R138B DB only.

This does NOT validate real JWTs, live customer permissions, or production tenancy.
No code in this program addresses remote DB/Worker/LINE. Original R138B is immutable.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from car02_r138_pg17_lifecycle_qa import ROLES, booking, case, step, integer
from car02_r159_concurrent_booking_isolated import CID, COMMIT, DB, change
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import snapshot, TABLES
from car02_r185_rls_session_spoof_isolated import ACTORS, role_counts, exact_counts

OUT='qa-evidence-r188/r188-role-escalation-proof.json'
ROLE_NAMES=tuple(ROLES[a] for a in ACTORS)
SQLSTATE='42501'
LOCK={
  'version':'R188','mode':'DISPOSABLE_PG17_SYNTHETIC_ROLE_ESCALATION_DENIAL_ONLY',
  'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
  'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
  'realAuthenticationVerified':False,'realRLSVerified':False,
  'externalWitnessVerified':False,'externalSignatureVerified':False,
  'independentProductionTest':False,'fixtureDb':DB,'fixtureRoles':5,
  'allFiveTablesCovered':True,'originalR138BUnchanged':True,
  'priorR185Unchanged':True,'liveAuthorizationEstablished':False,
}

class RoleEscalationError(AssertionError):pass

def require(value,code):
    if not value:raise RoleEscalationError('R188_'+code)

def cases():
    """Fixed, exhaustive deny-only matrix. No untrusted names enter SQL."""
    c={}
    for actor in ACTORS:
        for target in (*ROLE_NAMES,'postgres'):
            if target != ROLES[actor]:
                c[f'{actor}:set_role:{target}']=f'SET ROLE {target};'
        c[f'{actor}:session_auth:postgres']='SET SESSION AUTHORIZATION postgres;'
        c[f'{actor}:disable_rls:bookings']='ALTER TABLE car02_r138_qa.bookings DISABLE ROW LEVEL SECURITY;'
        c[f'{actor}:bypassrls:{ROLES[actor]}']=f'ALTER ROLE {ROLES[actor]} BYPASSRLS;'
    require(len(c)==40,'MATRIX_SIZE')
    return c

CASE_MATRIX=cases()

def seal(doc):
    obj={k:v for k,v in doc.items() if k!='sha256'}
    return hashlib.sha256(json.dumps(obj,ensure_ascii=True,sort_keys=True,
            separators=(',',':'),allow_nan=False).encode('ascii')).hexdigest()

def verify_report(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','baseline',
             'after','dataBefore','dataAfter','denials','sha256'},'FIELDS')
    for name,val in LOCK.items():
        require(type(doc[name]) is type(val) and doc[name]==val,'LOCK_'+name)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']) is not None,'COMMIT')
    exact_counts(doc['baseline'])
    require(doc['after']==doc['baseline'],'VISIBILITY_DRIFT')
    for key in ('dataBefore','dataAfter'):
        entry=doc[key]
        require(type(entry) is dict and set(entry)==set(TABLES),'DATA_SHAPE')
        require(all(type(h) is str and re.fullmatch(r'[0-9a-f]{32}',h) is not None
                    for h in entry.values()),'DATA_DIGEST')
    require(doc['dataBefore']==doc['dataAfter'],'DATA_CHANGED')
    denials=doc['denials']
    require(type(denials) is dict and set(denials)==set(CASE_MATRIX),'DENIAL_MATRIX')
    require(all(type(x) is str and x==SQLSTATE for x in denials.values()),'DENIAL_STATE')
    require(type(doc['sha256']) is str and re.fullmatch(r'[a-f0-9]{64}',doc['sha256']) is not None
            and doc['sha256']==seal(doc),'DIGEST')
    return True

def denied_sql(cid,actor,statement):
    require(type(cid) is str and CID.fullmatch(cid) is not None and actor in ACTORS,'CONTAINER_ROLE')
    require(statement in CASE_MATRIX.values(),'STATEMENT_ALLOWLIST')
    command=['docker','exec','-i',cid,'env','PGPASSWORD=r138-throwaway-only',
             'psql','-h','127.0.0.1','-X','-A','-t','-v','ON_ERROR_STOP=1',
             '-v','VERBOSITY=sqlstate','-U',ROLES[actor],'-d',DB,'-c',statement]
    result=subprocess.run(command,capture_output=True,text=True,timeout=30)
    require(result.returncode != 0,'UNEXPECTED_SUCCESS')
    # "VERBOSITY=sqlstate" emits a SQLSTATE-only error, no localized error string.
    require(re.search(r'ERROR:\s*42501\b',result.stderr) is not None,'NOT_INSUFFICIENT_PRIVILEGE')
    return SQLSTATE

def safe_write(doc,dest):
    require(isinstance(dest,Path) and dest.parent.is_dir() and not dest.parent.is_symlink()
            and not dest.exists() and not dest.is_symlink(),'OUTPUT_PATH')
    verify_report(doc)
    with dest.open('x',encoding='ascii') as f:
        f.write(json.dumps(doc,sort_keys=True,ensure_ascii=True,allow_nan=False,indent=2)+'\n')
    restored=json.loads(dest.read_text(encoding='ascii'))
    require(restored==doc and verify_report(restored),'ROUNDTRIP')
    return dest

def seed(cid):
    day=next_business_days(1)[0]
    for actor,staff,clock in [('a1','as','10:00'),('a2','as','11:00'),('b1','bs','10:00')]:
        require(booking(cid,DB,staff,'r188_seed_book_'+actor,ROLES[actor],day,clock)=='CREATED','SEED_BOOK')
        bid=integer(cid,DB,staff,"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r188_seed_book_"+actor+"';")
        require(case(cid,DB,staff,'r188_seed_case_'+actor,bid)=='OPENED','SEED_CASE')
        case_id=integer(cid,DB,staff,f'SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={bid};')
        require(step(cid,DB,staff,'r188_report_'+actor,case_id,'REPORT',1,
                     note='Synthetic role escalation isolated inspection')=='REPORT_SAVED','REPORT')
        require(step(cid,DB,staff,'r188_quote_'+actor,case_id,'QUOTE',2,part=1200,labor=800)=='QUOTE_PRESENTED','QUOTE')
        extra='15:00' if actor=='a2' else '14:00'
        later='15:30' if actor=='a2' else '14:30'
        require(booking(cid,DB,staff,'r188_extra_'+actor,ROLES[actor],day,extra)=='CREATED','EXTRA')
        extra_id=integer(cid,DB,staff,"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r188_extra_"+actor+"';")
        require(change(cid,actor,'r188_move_'+actor,extra_id,'MOVE',1,day,later)=='MOVED','MOVE')

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT_ARG')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit
            and os.environ.get('CAR02_RELEASE_LOCK')=='true'
            and os.environ.get('R188_DISPOSABLE_QA')=='yes','RELEASE_LOCK')
    target=Path(out)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'OUTPUT_EXISTS')
    seed(cid)
    before=snapshot(cid)
    baseline={a:role_counts(cid,a) for a in ACTORS}
    exact_counts(baseline)
    denials={}
    for key,sql in CASE_MATRIX.items():
        actor=key.split(':',1)[0]
        denials[key]=denied_sql(cid,actor,sql)
    after=snapshot(cid)
    post={a:role_counts(cid,a) for a in ACTORS}
    doc=dict(LOCK,githubCommit=commit,baseline=baseline,after=post,
             dataBefore=before,dataAfter=after,denials=denials)
    doc['sha256']=seal(doc)
    safe_write(doc,target)
    print('R188_DISPOSABLE_PG17_SYNTHETIC_ROLE_ESCALATION_DENIED_PASS_NO_GO_HOLD')
    return doc

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--cid',required=True)
    ap.add_argument('--commit',required=True)
    ap.add_argument('--out',default=OUT)
    args=ap.parse_args()
    probe(args.cid,args.commit,args.out)
if __name__=='__main__':main()

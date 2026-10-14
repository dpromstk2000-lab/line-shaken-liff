#!/usr/bin/env python3
"""Emit deterministic local synthetic evidence to an explicitly local path only."""
import copy
from datetime import datetime
import json
import os
from pathlib import Path
from zoneinfo import ZoneInfo
from car02_r140_auth_boundary_isolated import SyntheticBoundary,mint_fixture,SCOPES
from car02_r141_independent_audit_isolated import attest,compare

def main():
    if os.environ.get('CAR02_RELEASE_LOCK')!='true' or os.environ.get('R140_SYNTHETIC_QA')!='yes':
        raise SystemExit('R141_SYNTHETIC_ISOLATION_REQUIRED')
    output=Path(os.environ.get('R141_PROOF_OUTPUT','r141-synthetic-proof.json'))
    if output.is_absolute() or len(output.parts)!=1 or output.name!= 'r141-synthetic-proof.json':
        raise SystemExit('R141_OUTPUT_RESTRICTED')
    now=int(datetime(2026,10,14,10,tzinfo=ZoneInfo('Asia/Tokyo')).timestamp())
    s=SyntheticBoundary(now)
    def tok(sub,tenant,role):return mint_fixture(sub=sub,tenant=tenant,role=role,scopes=sorted(SCOPES),now_sec=now)
    staff=tok('staff_AAA','street_house_demo','STAFF')
    cust=tok('cust_AAA','street_house_demo','CUSTOMER')
    def cmd(op,key,version,bid=None,cid=None,data=None,tenant='street_house_demo'):
        return {'op':op,'tenant':tenant,'key':key,'expectedVersion':version,
                'bookingId':bid,'caseId':cid,'data':{} if data is None else data}
    b=s.execute(staff,cmd('BOOK','evidence_book_001',0,data={'ownerId':'cust_AAA','date':'2026-10-19','time':'09:00'}))['bookingId']
    c=s.execute(staff,cmd('OPEN_CASE','evidence_case_001',1,bid=b))['caseId']
    s.execute(staff,cmd('REPORT','evidence_report_001',1,cid=c,data={'note':'Synthetic inspection: brake pad wear'}))
    s.execute(staff,cmd('QUOTE','evidence_quote_001',2,cid=c,data={'partYen':1000,'laborYen':3000}))
    s.execute(cust,cmd('DECIDE','evidence_decide_001',3,cid=c,data={'choice':'APPROVE'}))
    s.execute(staff,cmd('COMPLETE','evidence_complete_001',4,cid=c))
    bstaff=tok('staff_BBB','other_demo','STAFF')
    s.execute(bstaff,cmd('BOOK','evidence_other_001',0,
                         data={'ownerId':'cust_BBB','date':'2026-10-19','time':'09:00'},tenant='other_demo'))
    source=attest(s.state_snapshot())
    restored=attest(copy.deepcopy(s.state_snapshot()))
    assert compare(source,restored)
    proof={'source':source,'independentCopy':restored,'parity':True,
           'assurance':'SYNTHETIC_IN_MEMORY_ONLY_NOT_EXTERNAL_OR_DB_RESTORE',
           'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12}
    output.write_text(json.dumps(proof,indent=2,sort_keys=True)+'\n')
    print('R141_INDEPENDENT_SYNTHETIC_AUDIT_PASS_NO_GO_HOLD')

if __name__=='__main__':main()

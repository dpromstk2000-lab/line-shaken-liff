#!/usr/bin/env python3
"""R147 — fail-closed cross-evidence correlation of disposable R138/R139/R143/R144 QA.

A reproducibility manifest, NOT a signature, independent external witness,
real authentication proof, or authority to deploy/migrate production systems.
No SQL, network, secrets, storage, or production endpoints are accessed.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re

TABLES=('bookings','service_cases','case_operations','booking_operations','audit_events')
ROLE_MAP={'as':'street_house_demo','a1':'street_house_demo','a2':'street_house_demo',
          'bs':'other_demo','b1':'other_demo'}
COUNTS={'as':6,'a1':3,'a2':3,'bs':2,'b1':2}
INPUT_FILES={
 'source':'qa-evidence-r143/r138-source.json',
 'before':'qa-evidence-r143/r139-before.json',
 'after':'qa-evidence-r143/r139-after.json',
 'probe':'qa-evidence-r143/r143-r144-boundary-proof.json',
 'parity':'qa-evidence-r143/r144-independent-parity.json',
}
OUTPUT='qa-evidence-r143/r147-independent-evidence-chain.json'

class EvidenceGateError(AssertionError): pass

def gate(value,code):
    if not value: raise EvidenceGateError('R147_'+code)

def canonical(obj):
    return json.dumps(obj,sort_keys=True,ensure_ascii=True,separators=(',',':'),allow_nan=False).encode('ascii')

def digest(obj):return hashlib.sha256(canonical(obj)).hexdigest()

def protected():
    gate(os.environ.get('CAR02_RELEASE_LOCK')=='true' and
         os.environ.get('R138_DISPOSABLE_QA')=='yes' and
         os.environ.get('R139_DISPOSABLE_QA')=='yes' and
         os.environ.get('R143_DISPOSABLE_QA')=='yes', 'LOCK')

def verify(source,before,after,probe,parity,commit):
    protected()
    gate(type(commit) is str and bool(re.fullmatch(r'[0-9a-f]{40}',commit)), 'COMMIT')
    gate(all(type(v) is dict for v in (source,before,after,probe,parity)), 'SHAPE')
    gate(source.get('version')=='R138' and source.get('mode')=='source' and
         source.get('syntheticOnly') is True and source.get('release')=='NO_GO' and
         source.get('migration')=='HOLD', 'SOURCE_LOCK')
    lc=source.get('lifecycleChecks')
    gate(type(lc) is dict and lc.get('sixWayMove') is True and lc.get('sixWayCancel') is True,
         'SOURCE_LIFECYCLE')
    cases=source.get('caseIds')
    gate(type(cases) is dict and set(cases)=={'a1','a2','b1'} and
         all(type(v) is int and v>0 for v in cases.values()) and
         len(set(cases.values()))==3, 'SOURCE_CASES')
    for item in (before,after):
        gate(item.get('mode')=='source' and item.get('release')=='NO_GO' and
             item.get('migration')=='HOLD' and item.get('productionTouched') is False and
             item.get('syntheticOnly') is True,'SNAPSHOT_LOCK')
        shops=item.get('shops')
        gate(type(shops) is dict and set(shops)=={'street_house_demo','other_demo'}, 'SHOPS')
        for name,shop in shops.items():
            gate(type(shop) is dict and shop.get('shop')==name,'SHOP_ID')
            counts=shop.get('counts')
            gate(type(counts) is dict and set(counts)==set(TABLES) and
                 all(type(v) is int and v>=0 for v in counts.values()),'SHOP_COUNTS')
            gate(type(shop.get('eventsReconciled')) is int and
                 shop['eventsReconciled']==counts['audit_events'],'SHOP_EVENTS')
            gate(type(shop.get('digest')) is str and
                 bool(re.fullmatch(r'[a-f0-9]{64}',shop['digest'])),'SHOP_DIGEST')
    gate(before==after,'SNAPSHOT_CHANGED')
    gate(probe.get('version')=='R143_R144' and probe.get('release')=='NO_GO' and
         probe.get('migration')=='HOLD' and probe.get('realWorldGatesOpen')==12 and
         probe.get('productionTouched') is False and probe.get('sourceSynthetic') is True and
         probe.get('realAuthenticationVerified') is False and probe.get('realRLSVerified') is False,
         'PROBE_LOCK')
    gate(probe.get('sourceCaseIds')==cases,'CASE_LINK')
    checks=probe.get('checks')
    gate(type(checks) is list and len(checks)>=50 and
         all(type(c) is str and c for c in checks) and len(set(checks))==len(checks) and
         type(probe.get('checkCount')) is int and probe['checkCount']==len(checks), 'CHECKS')
    hash_original=probe.get('sha256')
    payload=dict(probe);payload.pop('sha256',None)
    gate(type(hash_original) is str and hash_original==digest(payload),'PROBE_DIGEST')
    visible=probe.get('visibleCounts')
    gate(type(visible) is dict and set(visible)==set(ROLE_MAP),'ROLE_SET')
    for role,rows in visible.items():
        gate(type(rows) is dict and set(rows)==set(TABLES) and
             all(type(v) is int and v>=0 for v in rows.values()),'VISIBLE_SHAPE')
        gate(rows['bookings']==COUNTS[role],'BOOKING_DRIFT_'+role)
    for table in TABLES:
        gate(visible['as'][table]==visible['a1'][table]+visible['a2'][table],
             'STAFF_CUSTOMER_A_'+table)
        gate(visible['bs'][table]==visible['b1'][table],'STAFF_CUSTOMER_B_'+table)
        gate(visible['as'][table]==before['shops']['street_house_demo']['counts'][table],
             'SNAPSHOT_ROLE_A_'+table)
        gate(visible['bs'][table]==before['shops']['other_demo']['counts'][table],
             'SNAPSHOT_ROLE_B_'+table)
    gate(parity.get('version')=='R144' and parity.get('release')=='NO_GO' and
         parity.get('migration')=='HOLD' and parity.get('realWorldGatesOpen')==12 and
         parity.get('productionTouched') is False and parity.get('syntheticOnly') is True and
         parity.get('fiveTableParity') is True and type(parity.get('probeChecks')) is int and
         parity['probeChecks']==len(checks),'PARITY_LOCK')
    gate(parity.get('shops')==before['shops'],'PARITY_SHOPS')
    gate(parity.get('snapshotSha256')==digest(before),'PARITY_DIGEST')
    result={
      'version':'R147','mode':'DISPOSABLE_PG17_EVIDENCE_CORRELATION_ONLY',
      'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
      'syntheticOnly':True,'productionTouched':False,
      'realAuthenticationVerified':False,'realRLSVerified':False,
      'externalWitnessVerified':False,'productionAuthorized':False,
      'githubCommit':commit,'checkCount':len(checks),
      'roleCount':len(visible),'tableCount':len(TABLES),
      'inputDigests':{k:digest(v) for k,v in zip(
        ('source','before','after','probe','parity'),(source,before,after,probe,parity))},
      'crossEvidenceMatched':True,
    }
    result['sha256']=digest(result)
    return result

def main():
    p=argparse.ArgumentParser()
    for k,v in INPUT_FILES.items():p.add_argument('--'+k,default=v)
    p.add_argument('--out',default=OUTPUT)
    p.add_argument('--commit',required=True)
    a=p.parse_args()
    protected()
    for k,v in INPUT_FILES.items():gate(getattr(a,k)==v,'PATH_'+k.upper())
    gate(a.out==OUTPUT,'OUTPUT_PATH')
    objs={k:json.loads(Path(v).read_text(encoding='utf8')) for k,v in INPUT_FILES.items()}
    out=verify(*(objs[k] for k in INPUT_FILES),a.commit)
    target=Path(OUTPUT)
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(out,sort_keys=True,indent=2)+'\n',encoding='utf8')
    gate(json.loads(target.read_text(encoding='utf8'))==out,'ROUND_TRIP')
    print('R147_PG17_CROSS_EVIDENCE_CORRELATION_PASS_NO_GO_HOLD')

if __name__=='__main__':main()

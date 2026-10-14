#!/usr/bin/env python3
"""R144: proof-only parity gate over two independent R139 snapshots.

R139 captures disposable PG17 five-table state before and after R143 probes.
Both snapshots must be byte-content-equivalent excluding the explicit mode.
This is not a real-world external witness nor a production restore.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path

class ParityError(AssertionError): pass

def check(ok,reason):
    if not ok:raise ParityError('R144_'+reason)

def canonical(obj):
    return json.dumps(obj,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('ascii')

def verify(before,after,probe):
    check(os.environ.get('CAR02_RELEASE_LOCK')=='true' and
          os.environ.get('R143_DISPOSABLE_QA')=='yes', 'LOCK')
    check(all(type(item) is dict for item in (before,after,probe)),'SHAPE')
    for item in (before,after):
        check(item.get('mode')=='source','R139_MODE')
        check(item.get('release')=='NO_GO' and item.get('migration')=='HOLD' and
              item.get('productionTouched') is False and item.get('syntheticOnly') is True,'R139_HOLD')
        shops=item.get('shops')
        check(type(shops) is dict and set(shops)=={'street_house_demo','other_demo'},'SHOP_SET')
        for k,v in shops.items():
            check(type(v) is dict and v.get('shop')==k and
                  isinstance(v.get('counts'),dict) and
                  type(v.get('eventsReconciled')) is int and
                  v['eventsReconciled']==v['counts'].get('audit_events') and
                  isinstance(v.get('digest'),str) and len(v['digest'])==64,'SHOP_EVIDENCE')
    check(before==after,'STATE_CHANGED')
    check(probe.get('version')=='R143_R144' and probe.get('release')=='NO_GO' and
          probe.get('migration')=='HOLD' and probe.get('realWorldGatesOpen')==12 and
          probe.get('sourceSynthetic') is True and probe.get('productionTouched') is False and
          probe.get('realAuthenticationVerified') is False and probe.get('realRLSVerified') is False,'PROBE_GATE')
    checks=probe.get('checks')
    check(type(checks) is list and len(set(checks))==len(checks) and
          all(type(x) is str for x in checks) and probe.get('checkCount')==len(checks),'PROBE_CHECKS')
    check(len(checks)>=50,'PROBE_TOO_FEW')
    digest=probe.get('sha256')
    copy=dict(probe);copy.pop('sha256',None)
    check(isinstance(digest,str) and digest==hashlib.sha256(canonical(copy)).hexdigest(),'PROBE_DIGEST')
    return {'version':'R144','release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
            'productionTouched':False,'syntheticOnly':True,
            'probeChecks':len(checks),'fiveTableParity':True,
            'shops':before['shops'],
            'snapshotSha256':hashlib.sha256(canonical(before)).hexdigest()}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--before',default='qa-evidence-r143/r139-before.json')
    parser.add_argument('--after',default='qa-evidence-r143/r139-after.json')
    parser.add_argument('--probe',default='qa-evidence-r143/r143-r144-boundary-proof.json')
    parser.add_argument('--out',default='qa-evidence-r143/r144-independent-parity.json')
    args=parser.parse_args()
    check([args.before,args.after,args.probe,args.out]==[
      'qa-evidence-r143/r139-before.json',
      'qa-evidence-r143/r139-after.json',
      'qa-evidence-r143/r143-r144-boundary-proof.json',
      'qa-evidence-r143/r144-independent-parity.json'], 'PATH_SCOPE')
    report=verify(*[json.loads(Path(p).read_text(encoding='utf8')) for p in (args.before,args.after,args.probe)])
    Path(args.out).write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf8')
    print('R144_INDEPENDENT_PG17_FIVE_TABLE_NO_MUTATION_PARITY_PASS_NO_GO_HOLD')

if __name__=='__main__':main()

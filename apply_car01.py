#!/usr/bin/env python3
"""Apply the UI overlay to a checked-out *existing* CAR repository.
This program is NOT run on the user's machine in the current step.
It is carried in the review/handoff ZIP for later reproducible integration.
Fails closed when the source differs from the audited GitHub blobs.
"""
from __future__ import annotations
import argparse, hashlib, pathlib, sys
FILES = {
    'dashboard.html': '0c83c08abdf9003b91c45a16c2390be4918225f4',
    'owner-ipad.html': '1319b04d3e824ebad8a5b589f3ae523512824617',
    'member.html': '75248f2e625a7c3e0f8bc41f1a62534b254de182',
    'index-product-demo.html': '0a5b9f68e4abe0c0231b19b51027523c5bde0eb9',
}
LINK='<link rel="stylesheet" href="dpro-car-ui-r2.css?v=20261008-R2">'
SCRIPT='<script defer src="dpro-car-ui-r2.js?v=20261008-R2"></script>'

def gitblob(data:bytes):
    return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\x00'+data).hexdigest()

def plan(base:pathlib.Path):
    changes={}
    for name,expected in FILES.items():
        path=base/name
        raw=path.read_bytes()
        if LINK.encode() in raw and SCRIPT.encode() in raw:
            print(f'ALREADY INTEGRATED {name}')
            continue
        sha=gitblob(raw)
        if sha != expected:
            raise ValueError(f'SOURCE CHANGED {name}: expected {expected}, actual {sha}; re-audit required')
        content=raw.decode('utf-8')
        if content.lower().count('</head>')!=1 or content.lower().count('</body>')!=1:
            raise ValueError(f'UNEXPECTED HTML STRUCTURE {name}')
        content=content.replace('</head>',LINK+'\n'+SCRIPT+'\n</head>',1)
        changes[path]=content.encode('utf-8')
    return changes

def main():
    p=argparse.ArgumentParser()
    p.add_argument('repo',type=pathlib.Path)
    p.add_argument('--apply',action='store_true',help='perform writes; default dry-run')
    args=p.parse_args(); base=args.repo
    work=plan(base)
    for path,data in work.items():
        print(('WRITE' if args.apply else 'DRY RUN'),path.name, len(data),'bytes')
    for name in ['dpro-car-ui-r2.css','dpro-car-ui-r2.js']:
        source=pathlib.Path(__file__).with_name(name)
        if not source.is_file():raise FileNotFoundError(source)
        if args.apply:(base/name).write_bytes(source.read_bytes())
        else:print('DRY RUN',name)
    if args.apply:
        for path,data in work.items():path.write_bytes(data)
        print('DONE. Review git diff, run browser tests; DO NOT auto-deploy.')
    else:print('NO CHANGES MADE. Rerun with --apply after review.')
if __name__=='__main__':
    try:main()
    except Exception as e:print('STOP:',e,file=sys.stderr);sys.exit(1)

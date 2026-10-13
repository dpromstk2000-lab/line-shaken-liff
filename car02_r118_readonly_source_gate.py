"""R118 read-only protected-source drift gate. Does not unlock production."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import re
from pathlib import Path

BASELINE = {
    'car02-private-photo-r47.mjs':'e0f3abec6bcf57830d9f3b72fe2eee099b1dff1d',
    'car02-unified-runtime-r50.mjs':'76e4e8cae27599f27e3d887118148718c32ebb80',
    'car02-edge-boundary-r51.mjs':'6614f2ed1933aa787576cb8074cb7d4bc704efa0',
    'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302',
    'car02-private-photo-upload-http-r82.mjs':'78f8b0f80fcc1f89d15fd25e4593c660cd197ea3',
    'car02-r93q-single-schema-lifecycle-isolated.mjs':'be1cd3feb78e26fb4759d9a86ecbd835d7ada144',
    'car02-r93s-durable-upload-intent-isolated.mjs':'64e907008448264512594573cdcdcd8773c4c29d',
}


def blob_hash(data: bytes) -> str:
    return hashlib.sha1(b'blob '+str(len(data)).encode('ascii')+b'\0'+data).hexdigest()


def check(root: Path) -> dict:
    files=[]
    src={}
    errors=[]
    for name,expected in BASELINE.items():
        target=root/name
        if not target.is_file():
            errors.append('PROTECTED_SOURCE_MISSING:'+name)
            files.append({'file':name,'integrity':'MISSING'})
            continue
        data=target.read_bytes()
        actual=blob_hash(data)
        if actual!=expected:
            errors.append('PROTECTED_SOURCE_DRIFT:'+name)
        files.append({'file':name,'blobSHA1':actual,'integrity':'MATCH' if actual==expected else 'DRIFT'})
        src[name]=data.decode('utf-8',errors='replace')
    r47=src.get('car02-private-photo-r47.mjs','')
    r50=src.get('car02-unified-runtime-r50.mjs','')
    r51=src.get('car02-edge-boundary-r51.mjs','')
    r52=src.get('car02-edge-entry-r52.ts','')
    r82=src.get('car02-private-photo-upload-http-r82.mjs','')
    r93q=src.get('car02-r93q-single-schema-lifecycle-isolated.mjs','')
    r93s=src.get('car02-r93s-durable-upload-intent-isolated.mjs','')
    invariants={
      'releaseLockHardClosed':bool(re.search(r'\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;',r52)),
      'uploadHandlerNotYetComposedInR50':not bool(re.search(r'createCar02PhotoUploadHttpR82|/api/car02/uploads/',r50)),
      'uploadRouteNotYetPresentInR51':not bool(re.search(r'/uploads|upload[_-]?path|UPLOAD_PATH',r51,re.I)),
      'R51GeneralBody32KiB':bool(re.search(r'\bMAX_BODY\s*=\s*32768\b',r51)),
      'R82PhotoLimit5MiB':bool(re.search(r'\bMAX_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024',r82)),
      'R82StableIntentForwardingNotProven':not bool(re.search(r'\bintentKey\b|\bIdempotency-Key\b',r82,re.I)),
      'R47ImmediateDeletePresent':bool(re.search(r'\bawait\s+deleteObject\s*\(path\)',r47)),
      'R93QProcessLocalReceiptsPresent':bool(re.search(r'\bconst\s+receipts\s*=\s*new Map\(',r93q)),
      'R93SRestrictedToDisposableQa':bool(re.search(r"\bconst\s+QA_DB\s*=\s*'car02_r93q_qa_ci'",r93s) and
                                    re.search(r"environment\s*!==\s*'isolated_qa'",r93s)),
    }
    for name,ok in invariants.items():
        if not ok:errors.append('SOURCE_CONTRACT_CHANGED:'+name)
    candidate=['car02_r118_isolated_safety.py','test_car02_r118_isolated_safety.py']
    forbidden={'requests','urllib','http','socket','boto3','supabase','subprocess'}
    for name in candidate:
        path=root/name
        if not path.is_file():
            errors.append('R118_MODULE_MISSING:'+name)
            continue
        try:
            tree=ast.parse(path.read_text(encoding='utf-8'),filename=name)
        except (SyntaxError,UnicodeError):
            errors.append('R118_MODULE_PARSE_ERROR:'+name)
            continue
        imported=[]
        for node in ast.walk(tree):
            if isinstance(node,ast.Import):imported.extend(alias.name.split('.')[0] for alias in node.names)
            if isinstance(node,ast.ImportFrom) and node.module:imported.append(node.module.split('.')[0])
        if set(imported)&forbidden:
            errors.append('R118_NETWORK_OR_PROCESS_MODULE_FORBIDDEN:'+name)
    return {
       'schema':'DPRO_CAR02_R118_READONLY_SOURCE_GATE_V1',
       'protectedFileCount':len(BASELINE),'sourceFiles':files,
       'sourceInvariants':invariants,'errors':errors,
       'integrityGatePassed':not errors,'noProdWrites':True,
       'sourceAuditOnly':True,'productionReady':False,
       'releaseDecision':'NO_GO','migrationDecision':'HOLD',
       'openProductionBlockers':['real Supabase private Storage/DELETE/privileged writer proof',
                                  'R47 uncertain-result delete remediation',
                                  'R50/R51/R82 actual route + 32KiB/5MiB policy',
                                  'durable multiclient backend booking+RLS',
                                  'R90 original pending/issues and release signoffs',
                                  'full live backup + independent restore + rollback approval'],
    }


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',default='.')
    parser.add_argument('--out',default='')
    parser.add_argument('--strict',action='store_true',help='fail on source drift / missing files')
    args=parser.parse_args()
    result=check(Path(args.root))
    if args.out:
        out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True)
        out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('R118_READONLY_GATE_'+('PASS' if result['integrityGatePassed'] else 'FAIL'))
    for err in result['errors']:
        print(err)
    print('R118_PRODUCTION_NO_GO_DB_HOLD')
    return 1 if args.strict and result['errors'] else 0

if __name__=='__main__':raise SystemExit(main())

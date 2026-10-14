#!/usr/bin/env python3
"""R142 CI read-only provenance lock. NEVER releases production or applies SQL.

Checks exact Git blob SHA-1 values against R139 official evidence only.
Digest matching is evidence of identical bytes, NOT real-world operational safety.
"""
import hashlib
import json
import os
from pathlib import Path

LOCKED = {
 'car02-private-photo-r47.mjs':'e0f3abec6bcf57830d9f3b72fe2eee099b1dff1d',
 'car02-unified-runtime-r50.mjs':'76e4e8cae27599f27e3d887118148718c32ebb80',
 'car02-edge-boundary-r51.mjs':'6614f2ed1933aa787576cb8074cb7d4bc704efa0',
 'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302',
 'car02-private-photo-upload-http-r82.mjs':'78f8b0f80fcc1f89d15fd25e4593c660cd197ea3',
 'car02-r93q-single-schema-lifecycle-isolated.mjs':'be1cd3feb78e26fb4759d9a86ecbd835d7ada144',
 'car02-r93s-durable-upload-intent-isolated.mjs':'64e907008448264512594573cdcdcd8773c4c29d',
 'car02_r139_pg17_reconciliation_qa.py':'b8de63152af691f3e8c7bbe0fb886dca1c58248d',
 'test_car02_r139_reconciliation.py':'346a812dddb0c7589a5f793c6c098b618b9634f1',
 '.github/workflows/car02-r139-pg17-independent-reconciliation-isolated-qa.yml':'bf897c54151efb34dc438743dcf2fc8bcc1f15a8',
 'R138_PG17_BOOKING_LIFECYCLE_QA_ONLY.sql':'3784f8a28549bc40343646bf88657c9d9b0b80f2',
 'car02_r138_pg17_lifecycle_qa.py':'ff98dd74916ff3ea77412b986138151a4fddab90',
}

class ProvenanceError(AssertionError): pass

def git_blob_sha1(data):
    if type(data) is not bytes:raise ProvenanceError('R142_EXPECTED_BYTES')
    return hashlib.sha1(f'blob {len(data)}\0'.encode('ascii')+data).hexdigest()

def verify(root, expected=LOCKED):
    if os.environ.get('CAR02_RELEASE_LOCK')!='true' or os.environ.get('R140_SYNTHETIC_QA')!='yes':
        raise ProvenanceError('R142_NO_ISOLATION_LOCK')
    root=Path(root).resolve();out={}
    for path,sha in expected.items():
        target=root/path
        if not target.is_file() or target.is_symlink() or not target.resolve().is_relative_to(root):
            raise ProvenanceError('R142_MISSING_OR_UNSAFE_SOURCE:'+path)
        digest=git_blob_sha1(target.read_bytes())
        if digest!=sha:raise ProvenanceError('R142_ORIGINAL_CHANGED:'+path)
        out[path]=digest
    return {'version':'R142','checked':len(out),'sources':out,
            'release':'NO_GO','migration':'HOLD','productionTouched':False,
            'syntheticOnly':True,'realWorldGatesOpen':12}

if __name__=='__main__':
    proof=verify(Path(__file__).resolve().parent)
    print(json.dumps(proof,sort_keys=True,indent=2))
    print('R142_ORIGINAL_SOURCE_INTEGRITY_PASS_PRODUCTION_NO_GO_DB_HOLD')

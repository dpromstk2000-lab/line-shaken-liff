#!/usr/bin/env python3
"""R150: strict on-disk QA proof acceptance and content-bound bundle verification.

Only synthetic R138/R139/R143/R144/R147 evidence on an isolated runner.
SHA256 here is tamper-evidence for accidental drift, NOT an external signature.
NO_GO / HOLD; NOT authorization for deployment, real RLS or production secrets.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat

from car02_r147_evidence_chain_isolated import INPUT_FILES, OUTPUT, digest, protected, verify

MAX_PROOF_BYTES = 1024 * 1024
BASE = Path('qa-evidence-r143')
OUTPUT_R150 = BASE / 'r150-strict-bundle.json'
FILES = {**INPUT_FILES, 'chain': OUTPUT}
SHA_PATTERN = re.compile(r'[0-9a-f]{40}\Z')

class BundleGateError(AssertionError):
    pass


def require(test: bool, code: str):
    if not test:
        raise BundleGateError('R150_' + code)


def no_duplicate_pairs(pairs):
    obj = {}
    for key, val in pairs:
        if key in obj:
            raise BundleGateError('R150_DUPLICATE_KEY')
        obj[key] = val
    return obj


def reject_nonfinite(token):
    raise BundleGateError('R150_NON_FINITE')


def parse_strict_bytes(raw: bytes):
    require(type(raw) is bytes and bool(raw), 'EMPTY')
    require(len(raw) <= MAX_PROOF_BYTES, 'OVERSIZE')
    require(not raw.startswith(b'\xef\xbb\xbf'), 'BOM')
    try:
        decoded = raw.decode('utf-8', errors='strict')
        result = json.loads(decoded, object_pairs_hook=no_duplicate_pairs,
                            parse_constant=reject_nonfinite)
    except (UnicodeError, json.JSONDecodeError, ValueError, RecursionError) as exc:
        raise BundleGateError('R150_INVALID_JSON') from exc
    require(type(result) is dict, 'OBJECT_REQUIRED')
    return result


def read_strict(filename: str):
    require(filename in FILES.values(), 'PATH_OUTSIDE_ALLOWLIST')
    path = Path(filename)
    require(path.parent == BASE and path.name not in ('.', '..'), 'PATH_SCOPE')
    # O_NOFOLLOW and fstat defend the read boundary against symlinked files.
    require(BASE.is_dir() and not BASE.is_symlink(), 'BASE_DIR')
    flags = (os.O_RDONLY | getattr(os, 'O_CLOEXEC', 0) |
             getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    try:
        fd = os.open(path, flags)
    except (OSError, ValueError) as exc:
        raise BundleGateError('R150_MISSING_OR_SYMLINK') from exc
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode), 'NON_REGULAR')
        require(info.st_size <= MAX_PROOF_BYTES, 'OVERSIZE')
        with os.fdopen(fd, 'rb', closefd=False) as fh:
            raw = fh.read(MAX_PROOF_BYTES + 1)
        return parse_strict_bytes(raw)
    finally:
        os.close(fd)


def validate(objects: dict, commit: str):
    protected()
    require(type(commit) is str and SHA_PATTERN.fullmatch(commit) is not None, 'COMMIT')
    require(type(objects) is dict and set(objects) == set(FILES), 'FILE_SET')
    require(all(type(obj) is dict for obj in objects.values()), 'SHAPE')
    actual = verify(*(objects[key] for key in INPUT_FILES), commit)
    chain = objects['chain']
    # Match the *whole* recomputed R147 report, not just user-provided hashes.
    require(chain == actual, 'CHAIN_RECOMPUTE')
    require(chain.get('sha256') == digest({k:v for k,v in chain.items() if k!='sha256'}), 'CHAIN_HASH')
    require(chain['githubCommit'] == commit, 'COMMIT_MISMATCH')
    require(chain['release'] == 'NO_GO' and chain['migration'] == 'HOLD', 'HOLD')
    require(chain['realWorldGatesOpen'] == 12, 'GATES')
    require(chain['productionTouched'] is False and chain['productionAuthorized'] is False, 'PRODUCTION')
    require(chain['externalWitnessVerified'] is False, 'WITNESS_CLAIM')
    require(chain['realAuthenticationVerified'] is False and chain['realRLSVerified'] is False,
            'REAL_AUTH_CLAIM')
    return {
        'version': 'R150',
        'mode': 'STRICT_LOCAL_SYNTHETIC_BUNDLE_QA_ONLY',
        'githubCommit': commit,
        'release': 'NO_GO', 'migration': 'HOLD', 'realWorldGatesOpen': 12,
        'syntheticOnly': True, 'productionTouched': False, 'productionAuthorized': False,
        'realAuthenticationVerified': False, 'realRLSVerified': False,
        'externalWitnessVerified': False, 'externalSignatureVerified': False,
        'duplicateJsonKeysRejected': True, 'nonFiniteNumbersRejected': True,
        'strictFileAllowlist': True,
        'inputDigests': {key:digest(objects[key]) for key in sorted(FILES)},
        'r147Sha256': chain['sha256'],
        'r147VerifiedRecomputed': True,
    }


def write_report(document: dict, output=OUTPUT_R150):
    path = Path(output)
    require(path.name == OUTPUT_R150.name and path.parent == OUTPUT_R150.parent,
            'OUTPUT_SCOPE')
    require(not path.is_symlink() and not path.exists(), 'OUTPUT_EXISTS')
    require(BASE.is_dir() and not BASE.is_symlink(), 'OUTPUT_DIR')
    content = json.dumps(document, sort_keys=True, indent=2, ensure_ascii=True, allow_nan=False) + '\n'
    # Write a private file; never overwrite a preexisting (possibly malicious) report.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write(content)
    require(read_back(path) == document, 'ROUND_TRIP')


def read_back(path):
    return parse_strict_bytes(Path(path).read_bytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--commit', required=True)
    args = ap.parse_args()
    # No user-controllable path flags; files restricted to checked-in QA evidence path.
    objects = {key:read_strict(fname) for key,fname in FILES.items()}
    report = validate(objects, args.commit)
    report['sha256'] = digest(report)
    write_report(report)
    print('R150_STRICT_SYNTHETIC_EVIDENCE_BUNDLE_PASS_NO_GO_HOLD')


if __name__ == '__main__':
    main()

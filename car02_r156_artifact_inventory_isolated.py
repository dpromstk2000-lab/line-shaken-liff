#!/usr/bin/env python3
"""R156 strict, closed-world disposable QA artifact inventory.

Local SHA256 checks detect accidental or later byte-level drift. This is NOT an
external signature, independently stored witness, provenance trust anchor or
permission to deploy. No network, database or production API access.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat

from car02_r147_evidence_chain_isolated import digest
from car02_r150_strict_bundle_isolated import parse_strict_bytes

BASE = Path('qa-evidence-r143')
OUTPUT = 'r156-closed-world-artifact-inventory.json'
MAX_FILE = 1024 * 1024
MAX_TOTAL = 8 * 1024 * 1024
COMMIT = re.compile(r'[a-f0-9]{40}\Z')
REQUIRED_JSON = (
    'r138-source.json', 'r139-before.json', 'r139-after.json',
    'r143-r144-boundary-proof.json', 'r144-independent-parity.json',
    'r147-independent-evidence-chain.json', 'r150-strict-bundle.json',
    'r153-post-cleanup-receipt.json',
)
REQUIRED_LOGS = (
    'r142-original-integrity.json.log', 'release-lock.log',
    'r149-git-object-pins.txt', 'r149-git-integrity.log',
    'r152-git-object-pins.txt', 'r152-git-integrity.log',
    'r155-git-object-pins.txt', 'r155-git-integrity.log',
    'r152-workflow-contract.log', 'r155-workflow-contract.log',
    'r149-contract.log', 'schema.log', 'r138-lifecycle.log',
    'r139-before.log', 'r143-probe.log', 'r139-after.log',
    'r144-parity.log', 'r147-evidence-chain.log',
    'r150-strict-bundle.log', 'cleanup.log', 'r153-post-cleanup-receipt.log',
    'r158-workflow-contract.log',
)
REPEATED = tuple(f'{prefix}-{i}.log' for prefix in (
    'offline', 'r148-cross-evidence', 'r151-strict',
    'r154-post-cleanup', 'r157-inventory') for i in (1,2,3))
EXPECTED = frozenset(REQUIRED_JSON + REQUIRED_LOGS + REPEATED)
CORE = ('release', 'migration', 'realWorldGatesOpen',
        'productionTouched', 'productionAuthorized', 'externalWitnessVerified',
        'externalSignatureVerified', 'realAuthenticationVerified', 'realRLSVerified')

class InventoryError(AssertionError):
    pass


def require(ok, code):
    if not ok:
        raise InventoryError('R156_' + code)


def read_blob(dirpath: Path, name: str):
    require(type(name) is str and name in EXPECTED, 'NAME')
    require(isinstance(dirpath, Path) and dirpath.is_dir() and not dirpath.is_symlink(), 'BASE')
    fd = None
    try:
        flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0) | getattr(os, 'O_CLOEXEC', 0)
        fd = os.open(dirpath/name, flags)
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode), 'NOT_REGULAR')
        require(before.st_nlink == 1, 'MULTIPLE_HARD_LINKS')
        require(0 < before.st_size <= MAX_FILE, 'SIZE')
        with os.fdopen(fd, 'rb', closefd=False) as f:
            raw = f.read(MAX_FILE+1)
        after = os.fstat(fd)
        require(before.st_dev == after.st_dev and before.st_ino == after.st_ino and
                before.st_size == after.st_size and before.st_mtime_ns == after.st_mtime_ns,
                'CHANGED_DURING_READ')
        require(len(raw) == before.st_size, 'READ_MISMATCH')
        return raw
    except (OSError, ValueError) as exc:
        raise InventoryError('R156_OPEN_FAILED') from exc
    finally:
        if fd is not None:
            os.close(fd)


def read_all(dirpath: Path, *, after_manifest=False):
    require(isinstance(dirpath, Path) and dirpath.is_dir() and not dirpath.is_symlink(), 'BASE')
    actual = {p.name for p in dirpath.iterdir()}
    require(actual == (EXPECTED | {OUTPUT} if after_manifest else EXPECTED), 'CLOSED_WORLD_FILE_SET')
    records = {}
    total = 0
    for name in sorted(EXPECTED):
        raw = read_blob(dirpath, name)
        total += len(raw)
        require(total <= MAX_TOTAL, 'TOTAL_BYTES')
        records[name] = raw
    return records


def validate_core(records: dict, commit: str):
    require(type(records) is dict and set(records) == EXPECTED, 'CORE_INPUT_SET')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None, 'COMMIT')
    objs = {name: parse_strict_bytes(records[name]) for name in REQUIRED_JSON}
    chain = objs['r147-independent-evidence-chain.json']
    strict = objs['r150-strict-bundle.json']
    receipt = objs['r153-post-cleanup-receipt.json']
    require(chain.get('version') == 'R147' and strict.get('version') == 'R150'
            and receipt.get('version') == 'R153', 'VERSIONS')
    for obj in (chain, strict, receipt):
        require(obj.get('githubCommit') == commit, 'COMMIT_LINK')
        require(obj.get('release') == 'NO_GO' and obj.get('migration') == 'HOLD' and
                type(obj.get('realWorldGatesOpen')) is int and obj['realWorldGatesOpen'] == 12 and
                obj.get('syntheticOnly') is True and obj.get('productionTouched') is False and
                obj.get('productionAuthorized') is False and
                obj.get('realAuthenticationVerified') is False and
                obj.get('realRLSVerified') is False and
                obj.get('externalWitnessVerified') is False, 'RELEASE_LOCK')
        require(obj.get('sha256') == digest({k:v for k,v in obj.items() if k!='sha256'}),
                'CORE_SHA')
    require(strict.get('externalSignatureVerified') is False and
            receipt.get('externalSignatureVerified') is False, 'SIGNATURE_CLAIM')
    require(strict.get('r147Sha256') == chain['sha256'] and
            receipt.get('r147Sha256') == chain['sha256'] and
            receipt.get('r150Sha256') == strict['sha256'], 'DIGEST_CHAIN')
    require(receipt.get('fixtureDatabaseRemaining') == 0 and
            receipt.get('fixtureRolesRemaining') == 0 and
            receipt.get('postgres17ServiceCleanupQuerySucceeded') is True and
            receipt.get('r150RecomputedAfterCleanup') is True, 'DB_TEARDOWN')
    require(records['release-lock.log'] == b'R143_R144_RELEASE_NO_GO_DB_MIGRATION_HOLD\n',
            'HOLD_LOG')
    require(records['cleanup.log'] == b'R143_ALL_DISPOSABLE_RESOURCES_DELETED\n',
            'CLEANUP_LOG')
    for name in REQUIRED_LOGS + REPEATED:
        require(b'\x00' not in records[name], 'BINARY_LOG')
    return True


def make_manifest(records: dict, commit: str):
    validate_core(records, commit)
    files = {key: {'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
             for key,raw in sorted(records.items())}
    doc = {
        'version': 'R156', 'mode': 'CLOSED_WORLD_DISPOSABLE_ARTIFACT_INVENTORY_ONLY',
        'githubCommit':commit, 'release':'NO_GO', 'migration':'HOLD',
        'realWorldGatesOpen':12, 'syntheticOnly':True,
        'productionTouched':False, 'productionAuthorized':False,
        'externalWitnessVerified':False, 'externalSignatureVerified':False,
        'realAuthenticationVerified':False, 'realRLSVerified':False,
        'artifactContentsAreExternalProof':False,
        'exactFileSetChecked':True,
        'fileCount':len(files), 'totalBytes':sum(v['bytes'] for v in files.values()),
        'files':files,
        'r153Sha256':parse_strict_bytes(records['r153-post-cleanup-receipt.json'])['sha256'],
    }
    doc['sha256']=digest(doc)
    return doc


def validate_manifest(records: dict, commit: str, report: dict):
    require(type(report) is dict and report == make_manifest(records,commit), 'MANIFEST_DRIFT')
    return True


def write_manifest(dirpath: Path, report: dict):
    require(isinstance(dirpath, Path) and dirpath == BASE and not dirpath.is_symlink(), 'OUTPUT_BASE')
    target = dirpath/OUTPUT
    require(not target.exists() and not target.is_symlink(), 'OUTPUT_EXISTS')
    raw=(json.dumps(report,indent=2,sort_keys=True,ensure_ascii=True,allow_nan=False)+'\n').encode('ascii')
    fd=os.open(target, os.O_CREAT|os.O_EXCL|os.O_WRONLY, 0o600)
    with os.fdopen(fd,'wb') as f:
        f.write(raw)
    reread=read_generated(target)
    require(reread == report, 'OUTPUT_ROUNDTRIP')
    return target


def read_generated(path: Path):
    require(isinstance(path, Path) and path == BASE/OUTPUT and BASE.is_dir() and
            not BASE.is_symlink() and not path.is_symlink(), 'OUTPUT_SCOPE')
    require(path.is_file() and path.stat().st_nlink == 1 and
            0 < path.stat().st_size <= MAX_FILE, 'OUTPUT_FILE')
    return parse_strict_bytes(path.read_bytes())


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--commit',required=True)
    args=ap.parse_args()
    require(os.environ.get('GITHUB_SHA') == args.commit and
            os.environ.get('CAR02_RELEASE_LOCK') == 'true' and
            os.environ.get('R143_DISPOSABLE_QA') == 'yes' and
            os.environ.get('R138_DISPOSABLE_QA') == 'yes' and
            os.environ.get('R139_DISPOSABLE_QA') == 'yes', 'ISOLATED_ENV')
    records=read_all(BASE)
    report=make_manifest(records,args.commit)
    write_manifest(BASE,report)
    validate_manifest(read_all(BASE, after_manifest=True),args.commit,read_generated(BASE/OUTPUT))
    print('R156_CLOSED_WORLD_PG17_ARTIFACT_INVENTORY_PASS_NO_GO_HOLD')

if __name__=='__main__':main()

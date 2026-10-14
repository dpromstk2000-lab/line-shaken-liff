#!/usr/bin/env python3
"""R153 isolated PostgreSQL closeout receipt; never production attestation.

Revalidates R150's R147-derived bundle AFTER DB teardown and independently
queries the disposable PG17 service to ensure its fixture DB and roles are gone.
A local SHA-256 digest is not a signature or an external witness.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess

from car02_r150_strict_bundle_isolated import (BASE, OUTPUT_R150, FILES,
    MAX_PROOF_BYTES, parse_strict_bytes, read_strict, validate, require)
from car02_r147_evidence_chain_isolated import digest

OUTPUT_R153 = BASE/'r153-post-cleanup-receipt.json'
CLEANUP = BASE/'cleanup.log'
LOCK = BASE/'release-lock.log'
CID_RE = re.compile(r'[a-f0-9]{12,64}\Z')
COMMIT_RE = re.compile(r'[a-f0-9]{40}\Z')
SQL = ("SELECT (SELECT count(*) FROM pg_database WHERE datname='car02_r138_qa_ci')"
       " || '|' || (SELECT count(*) FROM pg_roles WHERE rolname IN ("
       "'car02_r138_a_staff_ci','car02_r138_a_one_ci','car02_r138_a_two_ci',"
       "'car02_r138_b_staff_ci','car02_r138_b_one_ci'))")


def read_fixed(path: Path, allowed: tuple[Path, ...], *, json_document=True):
    require(path in allowed and path.parent == BASE and
            path.name not in ('.', '..'), 'R153_PATH_ALLOWLIST')
    require(BASE.is_dir() and not BASE.is_symlink(), 'R153_BASE')
    flags = os.O_RDONLY | getattr(os,'O_CLOEXEC',0) | getattr(os,'O_NOFOLLOW',0) | getattr(os,'O_NONBLOCK',0)
    try:
        fd = os.open(path, flags)
    except (OSError, ValueError) as exc:
        raise AssertionError('R153_MISSING_FILE') from exc
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode), 'R153_NOT_FILE')
        require(0 < info.st_size <= MAX_PROOF_BYTES, 'R153_LENGTH')
        with os.fdopen(fd,'rb',closefd=False) as stream:
            raw = stream.read(MAX_PROOF_BYTES+1)
    finally:
        os.close(fd)
    require(0 < len(raw) <= MAX_PROOF_BYTES, 'R153_LENGTH')
    if json_document:
        return parse_strict_bytes(raw)
    try:
        return raw.decode('ascii',errors='strict')
    except UnicodeError as exc:
        raise AssertionError('R153_LOG_ENCODING') from exc


def check_logs(cleanup_text: str, lock_text: str):
    require(type(cleanup_text) is str and
            cleanup_text == 'R143_ALL_DISPOSABLE_RESOURCES_DELETED\n', 'R153_CLEANUP_LOG')
    require(type(lock_text) is str and
            lock_text == 'R143_R144_RELEASE_NO_GO_DB_MIGRATION_HOLD\n', 'R153_RELEASE_LOCK_LOG')
    return True


def check_pg_output(output: str):
    require(type(output) is str and output == '0|0\n', 'R153_PG_RESOURCES_EXIST')
    return True


def query_disposable_pg(cid: str):
    require(type(cid) is str and CID_RE.fullmatch(cid) is not None, 'R153_CONTAINER_ID')
    try:
        result = subprocess.run(['docker','exec','-i',cid,'psql','-X','-U','postgres',
                                '-d','postgres','-Atqc',SQL],capture_output=True,
                                text=True,timeout=20,check=True)
    except (OSError, subprocess.SubprocessError) as exc:
        raise AssertionError('R153_PG_QUERY_FAILED') from exc
    check_pg_output(result.stdout)
    return {'databaseRemaining':0,'fixtureRolesRemaining':0,'directServiceQuery':True}


def construct_receipt(objects: dict, strict: dict, commit: str,
                      cleanup_text: str, lock_text: str, pg_state: dict):
    require(type(commit) is str and COMMIT_RE.fullmatch(commit) is not None,'R153_COMMIT')
    require(type(strict) is dict and strict.get('version')=='R150','R153_R150_VERSION')
    sha = strict.get('sha256')
    require(type(sha) is str and sha == digest({k:v for k,v in strict.items() if k!='sha256'}),
            'R153_R150_DIGEST')
    reference = validate(objects,commit)
    reference['sha256']=digest(reference)
    require(strict == reference,'R153_R150_REPLAY')
    check_logs(cleanup_text,lock_text)
    require(type(pg_state) is dict and pg_state == {
            'databaseRemaining':0, 'fixtureRolesRemaining':0, 'directServiceQuery':True},
            'R153_DB_NOT_CLEAN')
    receipt = {
        'version':'R153', 'mode':'ISOLATED_PG17_POST_CLEANUP_RECEIPT_ONLY',
        'githubCommit':commit,
        'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
        'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
        'realAuthenticationVerified':False,'realRLSVerified':False,
        'externalWitnessVerified':False,'externalSignatureVerified':False,
        'r150Sha256':sha, 'r147Sha256':objects['chain']['sha256'],
        'r150RecomputedAfterCleanup':True,
        'cleanupLogObserved':True,'holdLogObserved':True,
        'fixtureDatabaseRemaining':0,'fixtureRolesRemaining':0,
        'postgres17ServiceCleanupQuerySucceeded':True,
        'sourceEvidenceDigests':{k:digest(objects[k]) for k in sorted(objects)},
    }
    receipt['sha256']=digest(receipt)
    return receipt


def write_receipt(report: dict, output=OUTPUT_R153):
    target=Path(output)
    require(target==OUTPUT_R153 and target.parent==BASE,'R153_OUTPUT_SCOPE')
    require(BASE.is_dir() and not BASE.is_symlink() and not target.exists() and
            not target.is_symlink(),'R153_OUTPUT_EXISTS')
    raw=(json.dumps(report,sort_keys=True,indent=2,allow_nan=False)+'\n').encode('ascii')
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as stream:
        stream.write(raw)
    require(read_fixed(target,(OUTPUT_R153,))==report,'R153_ROUNDTRIP')


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--commit',required=True)
    ap.add_argument('--cid',required=True)
    args=ap.parse_args()
    require(os.environ.get('GITHUB_SHA')==args.commit,'R153_GITHUB_SHA_ENV')
    objects={key:read_strict(path) for key,path in FILES.items()}
    strict=read_fixed(OUTPUT_R150,(OUTPUT_R150,))
    cleanup=read_fixed(CLEANUP,(CLEANUP,),json_document=False)
    hold=read_fixed(LOCK,(LOCK,),json_document=False)
    pg=query_disposable_pg(args.cid)
    report=construct_receipt(objects,strict,args.commit,cleanup,hold,pg)
    write_receipt(report)
    print('R153_POST_CLEANUP_PG17_RECEIPT_PASS_NO_GO_HOLD')

if __name__=='__main__': main()

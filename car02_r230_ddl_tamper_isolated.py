#!/usr/bin/env python3
"""R230: forbidden synthetic DDL against immutable SECURITY DEFINER/RLS objects.

Only in R138B disposable PG17 fixture and five disposable identities; no real
authentication, production security, deployed services, or retained database.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from car02_r138_pg17_lifecycle_qa import ROLES, PASSWORD, booking, case, step, integer
from car02_r159_concurrent_booking_isolated import DB, CID, COMMIT, change
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import TABLES, snapshot

OUT = 'qa-evidence-r230/r230-ddl-tamper-proof.json'
ACTORS = ('as', 'a1', 'a2', 'bs', 'b1')
OPERATIONS = (
    'definer_to_invoker', 'alter_function_search_path', 'drop_function',
    'disable_booking_rls', 'rename_audit_table', 'change_table_owner',
)
SQL = {
    'definer_to_invoker': 'ALTER FUNCTION car02_r138_qa.claim_booking(text,text,date,time) SECURITY INVOKER;',
    'alter_function_search_path': 'ALTER FUNCTION car02_r138_qa.claim_booking(text,text,date,time) SET search_path TO public;',
    'drop_function': 'DROP FUNCTION car02_r138_qa.claim_booking(text,text,date,time);',
    'disable_booking_rls': 'ALTER TABLE car02_r138_qa.bookings DISABLE ROW LEVEL SECURITY;',
    'rename_audit_table': 'ALTER TABLE car02_r138_qa.audit_events RENAME TO audit_events_forged;',
    'change_table_owner': 'ALTER TABLE car02_r138_qa.service_cases OWNER TO car02_r138_a_staff_ci;',
}
LOCK = {
    'version': 'R230', 'mode': 'DISPOSABLE_PG17_DEFINER_RLS_DDL_TAMPER_REJECTION_ONLY',
    'release': 'NO_GO', 'migration': 'HOLD', 'realWorldGatesOpen': 12,
    'syntheticOnly': True, 'productionTouched': False, 'productionAuthorized': False,
    'productionReady': False, 'realAuthenticationVerified': False, 'realRLSVerified': False,
    'externalWitnessVerified': False, 'externalSignatureVerified': False,
    'fixtureDb': DB, 'fixtureRoles': 5, 'protectedFunctions': 4,
    'protectedTables': 5, 'attemptsPerRole': 6, 'totalRejectedDDL': 30,
    'sourceR138BUnchanged': True, 'sourceR227Unchanged': True,
}
class TamperError(AssertionError):
    pass

def require(ok, code):
    if not ok:
        raise TamperError('R230_' + code)

def seal(value):
    content = {k: v for k, v in value.items() if k != 'sha256'}
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(',', ':'),
                          ensure_ascii=True, allow_nan=False).encode('ascii')).hexdigest()

def exact_snapshot(s):
    require(type(s) is dict and set(s) == set(TABLES), 'SNAPSHOT_FIELDS')
    require(all(type(x) is str and re.fullmatch('[a-f0-9]{32}', x) is not None
                for x in s.values()), 'SNAPSHOT_VALUES')

def catalog_valid(c):
    require(type(c) is dict and set(c) == {'functions', 'tables'}, 'CATALOG_FIELDS')
    fs, ts = c['functions'], c['tables']
    require(type(fs) is list and len(fs) == 4, 'FUNCTION_COUNT')
    require([f['name'] for f in fs] == ['case_step', 'change_booking', 'claim_booking', 'open_case'], 'FUNCTIONS')
    for f in fs:
        require(type(f) is dict and set(f) == {'name','owner','definer','config','bodyHash','acl'}, 'FUNCTION_FIELDS')
        require(f['owner'] == 'postgres' and f['definer'] is True and
                f['config'] == ['search_path=pg_catalog'], 'FUNCTION_PROTECTION')
        require(type(f['bodyHash']) is str and re.fullmatch('[a-f0-9]{32}', f['bodyHash']), 'FUNCTION_HASH')
        require(f['acl'] is None or type(f['acl']) is str, 'FUNCTION_ACL')
    require(type(ts) is list and len(ts) == 5, 'TABLE_COUNT')
    require([x['name'] for x in ts] == sorted(TABLES), 'TABLE_NAMES')
    for t in ts:
        require(type(t) is dict and set(t) == {'name','owner','rls','force','acl'}, 'TABLE_FIELDS')
        require(t['owner'] == 'postgres' and t['rls'] is True and t['force'] is True, 'TABLE_PROTECTION')
        require(t['acl'] is None or type(t['acl']) is str, 'TABLE_ACL')

def verify_proof(doc):
    require(type(doc) is dict and set(doc) == set(LOCK) | {
        'githubCommit','catalogBefore','catalogAfter','snapshots','rejections',
        'visibleBookingsBefore','visibleBookingsAfter','sha256'}, 'PROOF_FIELDS')
    for k, v in LOCK.items():
        require(type(doc[k]) is type(v) and doc[k] == v, 'LOCK_' + k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']), 'GITHUB_SHA')
    for key in ('catalogBefore', 'catalogAfter'):
        catalog_valid(doc[key])
    require(doc['catalogBefore'] == doc['catalogAfter'], 'CATALOG_DRIFT')
    require(type(doc['snapshots']) is list and len(doc['snapshots']) == len(ACTORS)+1,
            'SNAPSHOT_COUNT')
    for s in doc['snapshots']:
        exact_snapshot(s)
        require(s == doc['snapshots'][0], 'DATA_MUTATED')
    expected = [{'actor': a, 'operation': op, 'sqlstate': '42501'}
                for a in ACTORS for op in OPERATIONS]
    require(type(doc['rejections']) is list and doc['rejections'] == expected,
            'DENIALS')
    for name in ('visibleBookingsBefore', 'visibleBookingsAfter'):
        visible = doc[name]
        require(type(visible) is dict and set(visible) == set(ACTORS), 'VISIBLE_ACTORS')
        require(all(type(v) is int for v in visible.values()), 'VISIBLE_TYPES')
        require(visible == {'as': 1,'a1': 1,'a2': 0,'bs': 1,'b1': 1}, 'VISIBLE_ISOLATION')
    require(doc['visibleBookingsBefore'] == doc['visibleBookingsAfter'], 'READ_DRIFT')
    require(type(doc['sha256']) is str and re.fullmatch('[a-f0-9]{64}',doc['sha256']) is not None
            and doc['sha256'] == seal(doc), 'DIGEST')
    return True

def admin_query(cid, sql):
    require(type(cid) is str and CID.fullmatch(cid) is not None, 'ADMIN_CONTAINER')
    require(type(sql) is str and len(sql) < 2800 and sql.startswith('SELECT '), 'ADMIN_SQL')
    cmd = ['docker','exec','-i',cid,'psql','-X','-qAt','-v','ON_ERROR_STOP=1',
           '-U','postgres','-d',DB,'-c',sql]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
    require(result.returncode == 0, 'ADMIN_RESULT')
    return result.stdout.strip()

def protected_catalog(cid):
    functions = json.loads(admin_query(cid,
       "SELECT coalesce(json_agg(json_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner),"
       "'definer',p.prosecdef,'config',p.proconfig,'bodyHash',md5(p.prosrc),"
       "'acl',p.proacl::text) ORDER BY p.proname)::text,'[]') "
       "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
       "WHERE n.nspname='car02_r138_qa';"))
    tables = json.loads(admin_query(cid,
       "SELECT coalesce(json_agg(json_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),"
       "'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'acl',c.relacl::text)"
       " ORDER BY c.relname)::text,'[]') "
       "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
       "WHERE n.nspname='car02_r138_qa' AND c.relkind='r';"))
    result = {'functions':functions,'tables':tables}
    catalog_valid(result)
    return result

def reject_ddl(cid, actor, operation):
    require(type(cid) is str and CID.fullmatch(cid) is not None and actor in ACTORS,
            'ACTOR_SCOPE')
    require(operation in OPERATIONS, 'OPERATION_SCOPE')
    cmd = ['docker','exec','-i',cid,'env','PGPASSWORD='+PASSWORD,
           'psql','-h','127.0.0.1','-X','-qAt',
           '-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',
           '-U',ROLES[actor],'-d',DB,'-c',SQL[operation]]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
    require(res.returncode != 0 and re.search(r'ERROR:\s+42501:',res.stderr) is not None,
            'EXPECTED_42501_' + actor + '_' + operation)
    return {'actor':actor, 'operation':operation, 'sqlstate':'42501'}

def save_proof(doc, path):
    require(isinstance(path, Path) and path.parent.is_dir() and not path.parent.is_symlink()
            and not path.exists() and not path.is_symlink(), 'OUTPUT_SCOPE')
    verify_proof(doc)
    with path.open('x',encoding='ascii') as f:
        json.dump(doc,f,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False)
        f.write('\n')
    again=json.loads(path.read_text(encoding='ascii'))
    require(again==doc and verify_proof(again), 'OUTPUT_ROUNDTRIP')
    return path

def probe(cid, commit, out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None and
            type(commit) is str and COMMIT.fullmatch(commit) is not None,
            'ARGUMENTS')
    require(out == OUT and os.environ.get('GITHUB_SHA') == commit and
            os.environ.get('CAR02_RELEASE_LOCK') == 'true' and
            os.environ.get('R230_DISPOSABLE_QA') == 'yes', 'RELEASE_ENV')
    dest=Path(out)
    require(dest.parent.is_dir() and not dest.parent.is_symlink() and not dest.exists(),
            'OUTPUT_READY')
    expected_empty=hashlib.md5(b'[]').hexdigest()
    require(snapshot(cid) == dict.fromkeys(TABLES,expected_empty), 'NONEMPTY_FIXTURE')
    day=next_business_days(1)[0]
    require(booking(cid,DB,'as','r230_seed_a_book',ROLES['a1'],day,'10:00')=='CREATED', 'BOOK_A')
    require(booking(cid,DB,'bs','r230_seed_b_book',ROLES['b1'],day,'11:00')=='CREATED', 'BOOK_B')
    booking_id=integer(cid,DB,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r230_seed_a_book';")
    require(change(cid,'a1','r230_seed_move',booking_id,'MOVE',1,day,'10:30')=='MOVED','BOOK_MOVE')
    other_id=integer(cid,DB,'bs',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r230_seed_b_book';")
    require(case(cid,DB,'bs','r230_seed_case',other_id)=='OPENED', 'CASE_B')
    case_id=integer(cid,DB,'bs',f'SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={other_id};')
    require(step(cid,DB,'bs','r230_seed_report',case_id,'REPORT',1,
                 note='Synthetic tamper protection report')=='REPORT_SAVED', 'CASE_REPORT')
    before=protected_catalog(cid)
    snapshots=[snapshot(cid)]
    counts=lambda: {role:integer(cid,DB,role,'SELECT count(*) FROM car02_r138_qa.bookings;') for role in ACTORS}
    visible=counts()
    rejected=[]
    for actor in ACTORS:
        for operation in OPERATIONS:
            rejected.append(reject_ddl(cid,actor,operation))
        snapshots.append(snapshot(cid))
        require(snapshots[-1] == snapshots[0], 'MIDWAY_DATA_DRIFT_'+actor)
    after=protected_catalog(cid)
    proof=dict(LOCK,githubCommit=commit,catalogBefore=before,catalogAfter=after,
               snapshots=snapshots,rejections=rejected,visibleBookingsBefore=visible,
               visibleBookingsAfter=counts())
    proof['sha256']=seal(proof)
    save_proof(proof,dest)
    print('R230_DISPOSABLE_PG17_30_DDL_TAMPER_DENIALS_CATALOG_AND_FIVE_TABLE_IMMUTABLE_NO_GO_HOLD_PASS')
    return proof

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--cid',required=True)
    ap.add_argument('--commit',required=True)
    ap.add_argument('--out',default=OUT)
    args=ap.parse_args()
    probe(args.cid,args.commit,args.out)
if __name__ == '__main__':
    main()

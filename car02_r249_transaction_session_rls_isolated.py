#!/usr/bin/env python3
"""R249 synthetic-only PostgreSQL 17 transaction-local session-state / prepared RLS proof.

A single authenticated connection per actor/mode crosses COMMIT and ROLLBACK
boundaries while prepared statements remain allocated. No cross-user SET ROLE,
real pooler, production DB, JWT trust, or production-readiness claim is made.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
from car02_r138_pg17_lifecycle_qa import ROLES, psql
from car02_r159_concurrent_booking_isolated import CID, COMMIT, DB
from car02_r171_rejection_immutability_isolated import TABLES, snapshot
from car02_r237_exact_row_rls_isolated import ACTORS, oracle, relevant, row_valid, seed, R237Error
from car02_r246_prepared_plan_rls_isolated import MODES, OWNERS

PHASES=('baseline','local_commit','after_commit','local_rollback','after_rollback')
LOCAL=('local_commit','local_rollback')
OUTPUT='qa-evidence-r249/r249-transaction-local-rls-proof.json'
LOCK=dict(version='R249',mode='DISPOSABLE_PG17_TRANSACTION_LOCAL_PREPARED_RLS_ONLY',
 release='NO_GO',migration='HOLD',realWorldGatesOpen=12,syntheticOnly=True,
 fixtureDb=DB,fixtureRoles=5,protectedTables=5,productionTouched=False,
 productionAuthorized=False,productionReady=False,realAuthenticationVerified=False,
 realRLSVerified=False,realPoolerVerified=False,externalWitnessVerified=False,
 sourceR138BUnchanged=True,sourceR248Unchanged=True,
 preparedStatementsAcrossCommitRollback=True,transactionLocalSettingsReset=True,
 exactRowIdentityAcrossPhases=True,readonlyBusinessTables=True)

class R249Error(AssertionError): pass

def require(ok,code):
    if not ok: raise R249Error('R249_'+code)

def seal(doc):
    return hashlib.sha256(json.dumps({k:v for k,v in doc.items() if k!='sha256'},
        sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('ascii')).hexdigest()

def readback_keys():
    return {a+':'+m for a in ACTORS for m in MODES}

def statements(mode):
    require(mode in MODES,'MODE')
    sql=[f'SET plan_cache_mode TO {mode};']
    for table in TABLES:
        sql.append(f"PREPARE r249_{table}(text,text) AS "
          "SELECT 'R249|ROW|' || $2 || '|"+table+"|' || $1 || '|' || "
          "coalesce(jsonb_agg(jsonb_build_object('id',id,'shop',shop_code,'owner',owner_login) "
          "ORDER BY id),'[]'::jsonb)::text FROM car02_r138_qa."+table+" WHERE owner_login=$1;")
    def phase(tag):
        sql.append("SELECT 'R249|STATE|"+tag+"|'||current_user||'|'||session_user||'|'||"
                   "current_setting('search_path')||'|'||"
                   "coalesce(nullif(current_setting('request.jwt.claims',true),''),'');")
        for table in TABLES:
            for owner in OWNERS:
                sql.append(f"EXECUTE r249_{table}('{ROLES[owner]}','{tag}');")
    phase('baseline')
    sql += ['BEGIN;', 'SET LOCAL search_path TO pg_temp, public;',
            "SET LOCAL request.jwt.claims TO '{\"role\":\"service_role\",\"sub\":\"r249-synthetic\"}';"]
    phase('local_commit');sql.append('COMMIT;')
    phase('after_commit')
    sql += ['BEGIN;', 'SET LOCAL search_path TO pg_temp, public;',
            "SET LOCAL request.jwt.claims TO '{\"role\":\"service_role\",\"sub\":\"r249-synthetic\"}';"]
    phase('local_rollback');sql.append('ROLLBACK;')
    phase('after_rollback')
    sql.append("SELECT 'R249|PLAN|' || name || '|' || generic_plans::text || ',' || "
               "custom_plans::text FROM pg_catalog.pg_prepared_statements "
               "WHERE name LIKE 'r249_%' ORDER BY name;")
    return '\n'.join(sql)

def parse(output,actor):
    require(type(output) is str and actor in ACTORS,'PARSE_ARGS')
    states={};rows={p:{t:{} for t in TABLES} for p in PHASES};plans={}
    for line in output.splitlines():
        if not line.startswith('R249|'):continue
        if line.startswith('R249|STATE|'):
            parts=line.split('|',6)
            require(len(parts)==7,'STATE_FORMAT')
            _,_,p,current,session,path,claims=parts
            require(p in PHASES and p not in states,'DUPLICATE_STATE')
            states[p]={'currentUser':current,'sessionUser':session,'searchPath':path,'claims':claims}
        elif line.startswith('R249|ROW|'):
            parts=line.split('|',5)
            require(len(parts)==6,'ROW_FORMAT')
            _,_,p,table,role,payload=parts
            require(p in PHASES and table in TABLES and role in (ROLES[o] for o in OWNERS),'ROW_TARGET')
            owner=next(o for o in OWNERS if ROLES[o]==role)
            require(owner not in rows[p][table],'DUPLICATE_ROW')
            try:rows[p][table][owner]=json.loads(payload)
            except (ValueError,TypeError) as exc:raise R249Error('R249_ROW_JSON') from exc
        elif line.startswith('R249|PLAN|'):
            parts=line.split('|',3)
            require(len(parts)==4,'PLAN_FORMAT')
            table=parts[2].removeprefix('r249_')
            require(table in TABLES and table not in plans and
                    re.fullmatch(r'\d+,\d+',parts[3]) is not None,'PLAN_RECORD')
            generic,custom=map(int,parts[3].split(','))
            plans[table]={'generic':generic,'custom':custom}
        else:require(False,'UNKNOWN_MARKER')
    require(set(states)==set(PHASES) and set(plans)==set(TABLES) and
        all(set(rows[p][t])==set(OWNERS) for p in PHASES for t in TABLES),'INCOMPLETE_OUTPUT')
    return {'states':states,'rows':rows,'plans':plans}

def validate(doc):
    try:
      _validate(doc)
    except R237Error as exc:
      raise R249Error('R249_ORACLE_FORMAT') from exc
    return True

def _validate(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{
        'githubCommit','oracle','readbacks','snapshotBefore','snapshotAfter','sha256'},'FIELDS')
    for k,v in LOCK.items():require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']) is not None,'COMMIT')
    require(type(doc['oracle']) is dict and set(doc['oracle'])==set(TABLES),'ORACLE')
    require(type(doc['readbacks']) is dict and set(doc['readbacks'])==readback_keys(),'READBACK_KEYS')
    for t in TABLES:
        row_valid(doc['oracle'][t]);require(len(doc['oracle'][t])>=3,'ORACLE_ROWS')
    for a in ACTORS:
        for mode in MODES:
            rec=doc['readbacks'][a+':'+mode]
            require(type(rec) is dict and set(rec)=={'states','rows','plans'},'RECORD')
            require(type(rec['states']) is dict and set(rec['states'])==set(PHASES),'STATES')
            require(type(rec['rows']) is dict and set(rec['rows'])==set(PHASES),'PHASE_ROWS')
            require(type(rec['plans']) is dict and set(rec['plans'])==set(TABLES),'PLANS')
            before=rec['states']['baseline']
            require(before['claims']=='' and type(before['searchPath']) is str and
                len(before['searchPath'])>0,'BASELINE_GUC')
            for phase in PHASES:
                state=rec['states'][phase]
                require(type(state) is dict and set(state)=={'currentUser','sessionUser','searchPath','claims'},'STATE_KEYS')
                require(state['currentUser']==ROLES[a] and state['sessionUser']==ROLES[a],'ROLE_IDENTITY')
                if phase in LOCAL:
                    require(state['claims']=='{"role":"service_role","sub":"r249-synthetic"}' and
                        'pg_temp' in state['searchPath'],'LOCAL_SETTING')
                else:
                    require(state['searchPath']==before['searchPath'] and state['claims']=='','LOCAL_NOT_RESET')
                require(type(rec['rows'][phase]) is dict and set(rec['rows'][phase])==set(TABLES),'ROW_TABLES')
                for table in TABLES:
                    targets=rec['rows'][phase][table]
                    require(type(targets) is dict and set(targets)==set(OWNERS),'OWNER_KEYS')
                    for owner in OWNERS:
                        actual=targets[owner];row_valid(actual)
                        expected=[r for r in relevant(doc['oracle'][table],a) if r['owner']==ROLES[owner]]
                        require(actual==expected,'VISIBILITY_'+a+'_'+mode+'_'+phase+'_'+table+'_'+owner)
            for table in TABLES:
                plan=rec['plans'][table]
                require(type(plan) is dict and set(plan)=={'generic','custom'} and
                        all(type(x) is int and x>=0 for x in plan.values()),'PLAN_FIELDS')
                require(plan==({'generic':15,'custom':0} if mode==MODES[0] else
                               {'generic':0,'custom':15}),'PLAN_COUNTER_'+table)
    for field in ('snapshotBefore','snapshotAfter'):
        snap=doc[field]
        require(type(snap) is dict and set(snap)==set(TABLES) and
                all(type(x) is str and re.fullmatch('[0-9a-f]{32}',x) for x in snap.values()),'SNAPSHOT')
    require(doc['snapshotBefore']==doc['snapshotAfter'],'DATA_MUTATION')
    require(type(doc['sha256']) is str and re.fullmatch('[0-9a-f]{64}',doc['sha256']) is not None
            and doc['sha256']==seal(doc),'SEAL')
    return True

def save(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
        and not path.exists() and not path.is_symlink(),'SAVE_PATH')
    validate(doc)
    with path.open('x',encoding='ascii') as fh:
        json.dump(doc,fh,indent=2,sort_keys=True,ensure_ascii=True,allow_nan=False);fh.write('\n')
    restored=json.loads(path.read_text(encoding='ascii'))
    require(restored==doc and validate(restored),'SAVE_ROUNDTRIP')
    return path

def probe(cid,commit,out=OUTPUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None and type(commit) is str
            and COMMIT.fullmatch(commit) is not None,'PROBE_ARGS')
    require(out==OUTPUT and os.environ.get('GITHUB_SHA')==commit and
        os.environ.get('CAR02_RELEASE_LOCK')=='true' and os.environ.get('R249_DISPOSABLE_QA')=='yes','ENV_LOCK')
    dest=Path(out)
    require(dest.parent.is_dir() and not dest.parent.is_symlink() and not dest.exists(),'DEST')
    require(snapshot(cid)==dict.fromkeys(TABLES,hashlib.md5(b'[]').hexdigest()),'NONEMPTY_DB')
    seed(cid)
    before=snapshot(cid)
    full={table:oracle(cid,table) for table in TABLES}
    reads={a+':'+mode:parse(psql(cid,DB,a,statements(mode)),a) for a in ACTORS for mode in MODES}
    after=snapshot(cid)
    doc=dict(LOCK,githubCommit=commit,oracle=full,readbacks=reads,
             snapshotBefore=before,snapshotAfter=after)
    doc['sha256']=seal(doc)
    save(doc,dest)
    print('R249_DISPOSABLE_PG17_TRANSACTION_LOCAL_SESSION_RESET_PREPARED_RLS_NO_GO_HOLD_PASS')
    return doc

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--cid',required=True);parser.add_argument('--commit',required=True)
    parser.add_argument('--out',default=OUTPUT)
    args=parser.parse_args();probe(args.cid,args.commit,args.out)
if __name__=='__main__': main()

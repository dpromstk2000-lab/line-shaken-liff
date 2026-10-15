#!/usr/bin/env python3
"""R246: disposable PG17 prepared-plan parameter / actor RLS isolation.

Synthetic fixture only. A prepared statement is session-scoped; this probes
role-authenticated sessions independently and compares exact row identities.
No production auth, API, retained DB, or real JWT test is claimed.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re
from pathlib import Path
from car02_r138_pg17_lifecycle_qa import ROLES, psql
from car02_r159_concurrent_booking_isolated import CID, COMMIT, DB
from car02_r171_rejection_immutability_isolated import TABLES, snapshot
from car02_r237_exact_row_rls_isolated import ACTORS, row_valid, relevant, seed, oracle, R237Error

OWNERS=('a1','a2','b1')
MODES=('force_generic_plan','force_custom_plan')
PROFILES=('baseline','spoof_claims_path')
OUT='qa-evidence-r246/r246-prepared-plan-rls-proof.json'
LOCK=dict(version='R246',mode='DISPOSABLE_PG17_PREPARED_PLAN_RLS_ONLY',release='NO_GO',
 migration='HOLD',realWorldGatesOpen=12,syntheticOnly=True,fixtureDb=DB,fixtureRoles=5,
 protectedTables=5,productionTouched=False,productionAuthorized=False,productionReady=False,
 realAuthenticationVerified=False,realRLSVerified=False,externalWitnessVerified=False,
 externalSignatureVerified=False,sourceR138BUnchanged=True,sourceR245Unchanged=True,
 parameterizedPreparedStatements=True,validatedPlanCacheCounters=True,
 actorAndTenantScopedRows=True,sessionSpoofDoesNotExpandRows=True)
class R246Error(AssertionError):pass

def require(ok,code):
    if not ok:raise R246Error('R246_'+code)

def seal(doc):
    return hashlib.sha256(json.dumps({k:v for k,v in doc.items() if k!='sha256'},
        sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('ascii')).hexdigest()

def required_keys():
    return {a+':'+m+':'+p for a in ACTORS for m in MODES for p in PROFILES}

def validate(doc):
    try:
        require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','oracle','readbacks',
            'snapshotBefore','snapshotAfter','sha256'},'FIELDS')
        for k,v in LOCK.items():require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
        require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']) is not None,'COMMIT')
        require(type(doc['oracle']) is dict and set(doc['oracle'])==set(TABLES),'ORACLE_TABLES')
        require(type(doc['readbacks']) is dict and set(doc['readbacks'])==required_keys(),'READBACK_KEYS')
        for table in TABLES:
            rows=doc['oracle'][table];row_valid(rows)
            require(len(rows)>=3 and {r['owner'] for r in rows}=={ROLES[o] for o in OWNERS},'ORACLE_POPULATION_'+table)
        for a in ACTORS:
            for mode in MODES:
                for profile in PROFILES:
                    rec=doc['readbacks'][a+':'+mode+':'+profile]
                    require(type(rec) is dict and set(rec)=={'currentUser','sessionUser','plans','rows'},'RECORD_FIELDS')
                    require(rec['currentUser']==ROLES[a] and rec['sessionUser']==ROLES[a],'IDENTITY_'+a)
                    require(type(rec['plans']) is dict and set(rec['plans'])==set(TABLES),'PLAN_SET')
                    require(type(rec['rows']) is dict and set(rec['rows'])==set(TABLES),'ROW_SET')
                    for table in TABLES:
                        plan=rec['plans'][table]
                        require(type(plan) is dict and set(plan)=={'generic','custom'},'PLAN_FIELDS')
                        require(all(type(plan[k]) is int and plan[k]>=0 for k in plan),'PLAN_COUNTS')
                        require(plan==({'generic':3,'custom':0} if mode==MODES[0] else
                            {'generic':0,'custom':3}),'PLAN_MODE_'+table)
                        targets=rec['rows'][table]
                        require(type(targets) is dict and set(targets)==set(OWNERS),'TARGET_SET_'+table)
                        for owner in OWNERS:
                            actual=targets[owner];row_valid(actual)
                            expected=[r for r in relevant(doc['oracle'][table],a) if r['owner']==ROLES[owner]]
                            require(actual==expected,'SCOPE_'+a+'_'+mode+'_'+profile+'_'+table+'_'+owner)
        for f in ('snapshotBefore','snapshotAfter'):
            snap=doc[f]
            require(type(snap) is dict and set(snap)==set(TABLES) and
                all(type(x) is str and re.fullmatch('[0-9a-f]{32}',x) for x in snap.values()),'SNAP_'+f)
        require(doc['snapshotBefore']==doc['snapshotAfter'],'READ_MUTATION')
        require(type(doc['sha256']) is str and re.fullmatch('[0-9a-f]{64}',doc['sha256']) is not None
                and doc['sha256']==seal(doc),'SHA256')
        return True
    except R237Error as exc:
        raise R246Error('R246_ORACLE_FORMAT') from exc

def statements(mode, profile):
    require(mode in MODES and profile in PROFILES,'SQL_PROFILE')
    sql=[f'SET plan_cache_mode TO {mode};']
    if profile=='spoof_claims_path':
        sql.extend(["SET request.jwt.claims TO '{\"role\":\"service_role\",\"sub\":\"synthetic-spoof\"}';",
                    'SET search_path TO pg_temp, public;'])
    sql.append("SELECT 'R246|IDENTITY|' || current_user || ',' || session_user;")
    for table in TABLES:
        sql.append(f"PREPARE r246_{table}(text) AS "
          "SELECT 'R246|ROW|"+table+"|' || $1 || '|' || "
          "coalesce(jsonb_agg(jsonb_build_object('id',id,'shop',shop_code,'owner',owner_login) "
          "ORDER BY id),'[]'::jsonb)::text FROM car02_r138_qa."+table+" WHERE owner_login=$1;")
        for target in OWNERS:
            sql.append(f"EXECUTE r246_{table}('{ROLES[target]}');")
    sql.append("SELECT 'R246|PLAN|' || name || '|' || generic_plans::text || ',' || custom_plans::text "
        "FROM pg_catalog.pg_prepared_statements WHERE name LIKE 'r246_%' ORDER BY name;")
    return sql

def parse(output, actor):
    require(type(output) is str and actor in ACTORS,'PARSE_ARGS')
    identities=[];rows={t:{} for t in TABLES};plans={}
    for line in output.splitlines():
        if not line.startswith('R246|'):continue
        parts=line.split('|',4)
        require(len(parts)>=3,'BAD_TAG')
        if parts[1]=='IDENTITY':
            require(len(parts)==3,'IDENTITY_TAG');identities.append(parts[2]);continue
        require(len(parts)==5 if parts[1]=='ROW' else len(parts)==4,'TAG_FORMAT')
        if parts[1]=='ROW':
            table,target,payload=parts[2:]
            require(table in TABLES and target in (ROLES[o] for o in OWNERS),'ROW_TARGET')
            owner=next(o for o in OWNERS if ROLES[o]==target)
            require(owner not in rows[table],'DUPLICATE_ROW')
            try: rows[table][owner]=json.loads(payload)
            except (ValueError,TypeError) as exc:raise R246Error('R246_JSON') from exc
        elif parts[1]=='PLAN':
            table=parts[2].removeprefix('r246_')
            require(table in TABLES and table not in plans,'PLAN_TARGET')
            require(re.fullmatch(r'[0-9]+,[0-9]+',parts[3]) is not None,'PLAN_FORMAT')
            g,c=map(int,parts[3].split(','));plans[table]={'generic':g,'custom':c}
        else:require(False,'UNKNOWN_TAG')
    require(identities==[ROLES[actor]+','+ROLES[actor]],'IDENTITY')
    require(set(plans)==set(TABLES) and all(set(rows[t])==set(OWNERS) for t in TABLES),'COMPLETENESS')
    return {'currentUser':ROLES[actor],'sessionUser':ROLES[actor], 'plans':plans,'rows':rows}

def readback(cid,actor,mode,profile):
    require(type(cid) is str and CID.fullmatch(cid) is not None and actor in ACTORS and
            mode in MODES and profile in PROFILES,'READ_ARGS')
    return parse(psql(cid,DB,actor,'\n'.join(statements(mode,profile))),actor)

def save(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
        and not path.exists() and not path.is_symlink(),'SAVE_SCOPE')
    validate(doc)
    with path.open('x',encoding='ascii') as fh:
        json.dump(doc,fh,indent=2,sort_keys=True,ensure_ascii=True,allow_nan=False);fh.write('\n')
    restored=json.loads(path.read_text(encoding='ascii'))
    require(restored==doc and validate(restored),'SAVE_ROUNDTRIP')
    return path

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None and type(commit) is str and
        COMMIT.fullmatch(commit) is not None,'ARGS')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit and
        os.environ.get('CAR02_RELEASE_LOCK')=='true' and
        os.environ.get('R246_DISPOSABLE_QA')=='yes','ENV_LOCK')
    target=Path(out)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'OUT')
    require(snapshot(cid)==dict.fromkeys(TABLES,hashlib.md5(b'[]').hexdigest()),'NONEMPTY_DB')
    seed(cid)
    before=snapshot(cid)
    originals={t:oracle(cid,t) for t in TABLES}
    reads={a+':'+m+':'+p:readback(cid,a,m,p) for a in ACTORS for m in MODES for p in PROFILES}
    after=snapshot(cid)
    doc=dict(LOCK,githubCommit=commit,oracle=originals,readbacks=reads,snapshotBefore=before,snapshotAfter=after)
    doc['sha256']=seal(doc)
    save(doc,target)
    print('R246_DISPOSABLE_PG17_PREPARED_GENERIC_CUSTOM_PLAN_RLS_NO_GO_HOLD_PASS')
    return doc

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--cid',required=True)
    parser.add_argument('--commit',required=True);parser.add_argument('--out',default=OUT)
    x=parser.parse_args();probe(x.cid,x.commit,x.out)
if __name__=='__main__':main()

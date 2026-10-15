#!/usr/bin/env python3
"""R243: cross-role GROUP / HAVING / DISTINCT / UNION / window / EXISTS RLS.

Synthetic disposable PG17 fixture only; no production authorization claims.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import os
import re
from pathlib import Path
from car02_r138_pg17_lifecycle_qa import ROLES, psql
from car02_r159_concurrent_booking_isolated import CID, COMMIT, DB
from car02_r171_rejection_immutability_isolated import TABLES, snapshot
from car02_r230_ddl_tamper_isolated import admin_query
from car02_r237_exact_row_rls_isolated import ACTORS, OWNER_SHOPS, relevant, row_valid, seed, oracle, R237Error
from car02_r240_rls_query_shapes_isolated import oracle_join, joined_valid, R240Error

OUT='qa-evidence-r243/r243-rls-aggregate-setops-proof.json'
PROFILES=('baseline','spoof_claims_path')
OWNERS=('a1','a2','b1')
SHAPES=('count','groups','having','distinct','unionIds','windows','existsOwners')
LOCK=dict(version='R243',mode='DISPOSABLE_PG17_RLS_AGGREGATE_SETOPS_ONLY',
    release='NO_GO',migration='HOLD',realWorldGatesOpen=12,syntheticOnly=True,
    fixtureDb=DB,fixtureRoles=5,protectedTables=5,productionTouched=False,
    productionAuthorized=False,productionReady=False,realAuthenticationVerified=False,
    realRLSVerified=False,externalWitnessVerified=False,externalSignatureVerified=False,
    sourceR138BUnchanged=True,sourceR242Unchanged=True,groupByRls=True,
    havingRls=True,distinctRls=True,unionRls=True,windowRls=True,
    correlatedExistsRls=True,spoofedSessionNoExpansion=True)

class R243Error(AssertionError):pass

def require(ok,code):
    if not ok:raise R243Error('R243_'+code)

def seal(doc):
    return hashlib.sha256(json.dumps({k:v for k,v in doc.items() if k!='sha256'},
       sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('ascii')).hexdigest()

def expected_view(rows):
    row_valid(rows)
    counts=Counter(r['owner'] for r in rows)
    owners=sorted(counts)
    ranks=defaultdict(int)
    windows=[]
    for row in rows:
        ranks[row['owner']]+=1
        windows.append({'id':row['id'],'owner':row['owner'],'rank':ranks[row['owner']]})
    return {'count':len(rows),
        'groups':[{'owner':o,'count':counts[o]} for o in owners],
        'having':[{'owner':o,'count':counts[o]} for o in owners if counts[o]>=2],
        'distinct':owners,
        'unionIds':[r['id'] for r in rows],
        'windows':windows,
        'existsOwners':{key:ROLES[key] in counts for key in OWNERS}}

def _validate(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','oracle','oracleJoin',
              'readbacks','snapshotBefore','snapshotAfter','sha256'},'FIELDS')
    for k,v in LOCK.items():require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']) is not None,'COMMIT')
    require(type(doc['oracle']) is dict and set(doc['oracle'])==set(TABLES),'ORACLE_TABLES')
    for table in TABLES:
        row_valid(doc['oracle'][table])
        require(len(doc['oracle'][table])>=3 and
            {r['owner'] for r in doc['oracle'][table]}=={ROLES[x] for x in OWNERS},
            'ORACLE_SEEDED_'+table)
    joined_valid(doc['oracleJoin'])
    case_ids={x['id']:x for x in doc['oracle']['service_cases']}
    booking_ids={x['id']:x for x in doc['oracle']['bookings']}
    require(len(doc['oracleJoin'])==len(case_ids),'JOIN_SIZE')
    for row in doc['oracleJoin']:
        require(row['case'] in case_ids and row['booking'] in booking_ids,'JOIN_IDS')
        require((case_ids[row['case']]['owner'],case_ids[row['case']]['shop']) ==
                (booking_ids[row['booking']]['owner'],booking_ids[row['booking']]['shop']) ==
                (row['owner'],row['shop']),'JOIN_OWNERSHIP')
    expected_keys={a+':'+p for a in ACTORS for p in PROFILES}
    require(type(doc['readbacks']) is dict and set(doc['readbacks'])==expected_keys,'READBACK_KEYS')
    for actor in ACTORS:
        for profile in PROFILES:
            rec=doc['readbacks'][actor+':'+profile]
            require(type(rec) is dict and set(rec)=={'currentUser','sessionUser','tables','correlatedBookings'},
                    'RECORD_FIELDS')
            require(rec['currentUser']==ROLES[actor] and rec['sessionUser']==ROLES[actor],
                    'SESSION_IDENTITY_'+actor+'_'+profile)
            require(type(rec['tables']) is dict and set(rec['tables'])==set(TABLES),'RECORD_TABLES')
            for table in TABLES:
                expected=relevant(doc['oracle'][table],actor)
                require(0<len(expected)<len(doc['oracle'][table]),'NONTRIVIAL_SCOPE')
                val=rec['tables'][table]
                oracle_value=expected_view(expected)
                require(type(val) is dict and set(val)==set(SHAPES),'SHAPE_SET_'+table)
                for shape in SHAPES:
                    require(type(val[shape]) is type(oracle_value[shape]) and
                            val[shape]==oracle_value[shape],
                            'SCOPE_'+actor+'_'+profile+'_'+table+'_'+shape)
            expected_corr=sorted(x['booking'] for x in doc['oracleJoin']
                                 if (x['shop']=='street_house_demo' if actor=='as' else
                                     x['shop']=='other_demo' if actor=='bs' else
                                     x['owner']==ROLES[actor]))
            require(type(rec['correlatedBookings']) is list and
                    rec['correlatedBookings']==expected_corr,'CORRELATED_'+actor+'_'+profile)
    for field in ('snapshotBefore','snapshotAfter'):
        snap=doc[field]
        require(type(snap) is dict and set(snap)==set(TABLES) and all(
            type(v) is str and re.fullmatch('[a-f0-9]{32}',v) for v in snap.values()),
            'SNAP_'+field)
    require(doc['snapshotBefore']==doc['snapshotAfter'],'READ_MUTATION')
    require(type(doc['sha256']) is str and re.fullmatch('[a-f0-9]{64}',doc['sha256']) and
            doc['sha256']==seal(doc),'DIGEST')
    return True

def validate(doc):
    try:
        return _validate(doc)
    except (R237Error,R240Error) as exc:
        raise R243Error('R243_PREVIOUS_ORACLE_CONTRACT') from exc

def statements():
    stmts=["SELECT 'R243|IDENTITY|' || current_user || ',' || session_user;"]
    for table in TABLES:
        q='car02_r138_qa.'+table
        p='R243|'+table+'|'
        stmts.append(f"SELECT '{p}COUNT|' || count(*) FROM {q};")
        for label,having in (('GROUP',''),('HAVING',' HAVING count(*) >= 2')):
            sql=(f"SELECT '{p}{label}|' || coalesce(jsonb_agg(jsonb_build_object(" 
                 "'owner',owner_login,'count',n) ORDER BY owner_login),'[]'::jsonb)::text "
                 f"FROM (SELECT owner_login,count(*) AS n FROM {q} GROUP BY owner_login{having}) v;")
            stmts.append(sql)
        stmts.append(f"SELECT '{p}DISTINCT|' || coalesce(jsonb_agg(owner_login ORDER BY owner_login),'[]'::jsonb)::text "
                     f"FROM (SELECT DISTINCT owner_login FROM {q}) v;")
        stmts.append(f"SELECT '{p}UNION|' || coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb)::text "
                     f"FROM (SELECT id FROM {q} WHERE id % 2 = 0 UNION ALL "
                     f"SELECT id FROM {q} WHERE id % 2 = 1) v;")
        stmts.append(f"SELECT '{p}WINDOW|' || coalesce(jsonb_agg(jsonb_build_object(" 
                     "'id',id,'owner',owner_login,'rank',rank) ORDER BY id),'[]'::jsonb)::text "
                     f"FROM (SELECT id,owner_login,row_number() OVER(PARTITION BY owner_login ORDER BY id) AS rank FROM {q}) v;")
        for owner in OWNERS:
            stmts.append(f"SELECT '{p}EXISTS{owner}|' || CASE WHEN EXISTS (SELECT 1 FROM {q} "
                         f"WHERE owner_login='{ROLES[owner]}') THEN '1' ELSE '0' END;")
    stmts.append("SELECT 'R243|CORRELATED|' || coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb)::text "
        "FROM (SELECT b.id FROM car02_r138_qa.bookings b "
        "WHERE EXISTS (SELECT 1 FROM car02_r138_qa.service_cases s "
        "WHERE s.booking_id=b.id AND s.owner_login=b.owner_login AND s.shop_code=b.shop_code)) v;")
    return stmts

def parse(output,actor):
    require(type(output) is str and actor in ACTORS,'PARSE_ARGS')
    found={}
    for line in output.splitlines():
        if line.startswith('R243|'):
            key,sep,value=line[5:].rpartition('|')
            require(sep and key not in found,'DUPLICATE_OR_TAG')
            found[key]=value
    tagset={'IDENTITY','CORRELATED'}|{table+'|'+kind for table in TABLES for kind in
        ('COUNT','GROUP','HAVING','DISTINCT','UNION','WINDOW')+tuple('EXISTS'+owner for owner in OWNERS)}
    require(set(found)==tagset,'TAGS')
    require(found['IDENTITY']==ROLES[actor]+','+ROLES[actor],'IDENTITY')
    try:
        all_tables={}
        for table in TABLES:
            prefix=table+'|'
            raw_count=found[prefix+'COUNT']
            require(raw_count.isdecimal(),'COUNT_FORMAT')
            result={'count':int(raw_count)}
            for tag,key in [('GROUP','groups'),('HAVING','having'),('DISTINCT','distinct'),
                            ('UNION','unionIds'),('WINDOW','windows')]:
                result[key]=json.loads(found[prefix+tag])
            result['existsOwners']={o:(found[prefix+'EXISTS'+o]=='1') for o in OWNERS}
            require(all(found[prefix+'EXISTS'+o] in ('0','1') for o in OWNERS),'EXISTS_FORMAT')
            all_tables[table]=result
        correlated=json.loads(found['CORRELATED'])
        require(type(correlated) is list,'CORRELATED_TYPE')
        return {'currentUser':ROLES[actor],'sessionUser':ROLES[actor],
                'tables':all_tables,'correlatedBookings':correlated}
    except (ValueError,TypeError,KeyError,json.JSONDecodeError) as exc:
        raise R243Error('R243_BAD_OUTPUT') from exc

def readback(cid,actor,profile):
    require(type(cid) is str and CID.fullmatch(cid) is not None and
            actor in ACTORS and profile in PROFILES,'READ_ARGS')
    prefix=("SET request.jwt.claims TO '{\"role\":\"service_role\",\"sub\":\"spoof\"}'; "
            "SET search_path TO pg_temp, public; ") if profile=='spoof_claims_path' else ''
    return parse(psql(cid,DB,actor,prefix+'\n'.join(statements())),actor)

def save(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
            and not path.is_symlink() and not path.exists(),'SAVE_SCOPE')
    validate(doc)
    with path.open('x',encoding='ascii') as f:
        json.dump(doc,f,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False);f.write('\n')
    restored=json.loads(path.read_text(encoding='ascii'))
    require(restored==doc and validate(restored),'ROUNDTRIP')
    return path

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None and
            type(commit) is str and COMMIT.fullmatch(commit) is not None,'ARGS')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit and
            os.environ.get('CAR02_RELEASE_LOCK')=='true' and
            os.environ.get('R243_DISPOSABLE_QA')=='yes','ENV')
    target=Path(out)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'OUTPUT')
    require(snapshot(cid)==dict.fromkeys(TABLES,hashlib.md5(b'[]').hexdigest()),'EMPTY_FIXTURE')
    seed(cid)
    before=snapshot(cid)
    full={table:oracle(cid,table) for table in TABLES}
    joined=oracle_join(cid)
    reads={a+':'+p:readback(cid,a,p) for a in ACTORS for p in PROFILES}
    after=snapshot(cid)
    doc=dict(LOCK,githubCommit=commit,oracle=full,oracleJoin=joined,
             readbacks=reads,snapshotBefore=before,snapshotAfter=after)
    doc['sha256']=seal(doc)
    save(doc,target)
    print('R243_DISPOSABLE_PG17_RLS_AGGREGATE_SETOPS_CORRELATED_NO_GO_HOLD_PASS')
    return doc

def main():
    a=argparse.ArgumentParser();a.add_argument('--cid',required=True)
    a.add_argument('--commit',required=True);a.add_argument('--out',default=OUT)
    opts=a.parse_args();probe(opts.cid,opts.commit,opts.out)
if __name__=='__main__':main()

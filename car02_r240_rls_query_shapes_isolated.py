#!/usr/bin/env python3
"""R240: synthetic PG17 RLS visibility under pagination, ownership predicates and joins.

Uses the immutable R138B fixture in a disposable GitHub Actions PostgreSQL 17.
Not evidence of production authentication, API permissions, or deployed RLS.
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
from car02_r230_ddl_tamper_isolated import admin_query
from car02_r237_exact_row_rls_isolated import (ACTORS, OWNER_SHOPS, relevant, row_valid,
                                                 require as old_require, seed)

OUTPUT = 'qa-evidence-r240/r240-rls-query-shapes-proof.json'
PROFILES = ('baseline', 'spoof_claims_path')
OWNERS = ('a1', 'a2', 'b1')
MAX_PAGES = 12
PAGE_SIZE = 2
LOCK = dict(version='R240',mode='DISPOSABLE_PG17_RLS_QUERY_SHAPES_ONLY',release='NO_GO',
    migration='HOLD',realWorldGatesOpen=12,syntheticOnly=True,fixtureDb=DB,fixtureRoles=5,
    protectedTables=5,productionTouched=False,productionAuthorized=False,productionReady=False,
    realAuthenticationVerified=False,realRLSVerified=False,externalWitnessVerified=False,
    sourceR138BUnchanged=True,sourceR239Unchanged=True,paginationLimitOffset=True,
    ownershipPredicates=True,bookingCaseJoin=True,sessionSpoofNoExpansion=True)

class R240Error(AssertionError): pass

def require(ok, code):
    if not ok: raise R240Error('R240_'+code)

def seal(doc):
    return hashlib.sha256(json.dumps({k:v for k,v in doc.items() if k!='sha256'},
        sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode('ascii')).hexdigest()

def query(table):
    require(type(table) is str and table in TABLES,'TABLE_NAME')
    return 'car02_r138_qa.'+table

def oracle_join_sql():
    return ("SELECT coalesce(jsonb_agg(jsonb_build_object('case',s.id,'booking',b.id,"
            "'shop',s.shop_code,'owner',s.owner_login) ORDER BY s.id),'[]'::jsonb)::text "
            "FROM car02_r138_qa.service_cases s JOIN car02_r138_qa.bookings b "
            "ON s.booking_id=b.id AND s.shop_code=b.shop_code AND s.owner_login=b.owner_login")

def joined_valid(rows):
    require(type(rows) is list,'JOIN_TYPE')
    seen=[]
    for x in rows:
        require(type(x) is dict and set(x)=={'case','booking','shop','owner'} and
                type(x['case']) is int and x['case']>0 and type(x['booking']) is int and
                x['booking']>0 and type(x['shop']) is str and x['shop'] in OWNER_SHOPS.values() and
                type(x['owner']) is str and x['owner'] in [ROLES[o] for o in OWNERS],
                'JOIN_FORMAT')
        require(x['shop']==OWNER_SHOPS[next(a for a in OWNERS if ROLES[a]==x['owner'])],
                'JOIN_TENANT')
        seen.append(x['case'])
    require(seen==sorted(set(seen)),'JOIN_DUPLICATES')

def allowed(actor, row):
    if actor=='as':return row['shop']=='street_house_demo'
    if actor=='bs':return row['shop']=='other_demo'
    return row['owner']==ROLES[actor]

def expected_pages(rows):
    ids=[x['id'] for x in rows]
    return [ids[i:i+PAGE_SIZE] for i in range(0,len(ids),PAGE_SIZE)]

def verify(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','oracle','oracleJoin',
         'readbacks','snapshotBefore','snapshotAfter','sha256'},'FIELDS')
    for k,v in LOCK.items():
        require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']) is not None,'COMMIT')
    require(type(doc['oracle']) is dict and set(doc['oracle'])==set(TABLES),'ORACLE')
    for table in TABLES:
        row_valid(doc['oracle'][table]);require(len(doc['oracle'][table])>=3,'SEED_'+table)
        require({r['owner'] for r in doc['oracle'][table]}=={ROLES[x] for x in OWNERS},
                'ORACLE_OWNERS_'+table)
    joined_valid(doc['oracleJoin'])
    case_rows={x['id']:x for x in doc['oracle']['service_cases']}
    booking_rows={x['id']:x for x in doc['oracle']['bookings']}
    require(len(doc['oracleJoin'])==len(case_rows),'JOIN_ORACLE_COMPLETE')
    for x in doc['oracleJoin']:
        require(x['case'] in case_rows and x['booking'] in booking_rows and
                (case_rows[x['case']]['shop'],case_rows[x['case']]['owner']) ==
                (x['shop'],x['owner']) ==
                (booking_rows[x['booking']]['shop'],booking_rows[x['booking']]['owner']),
                'JOIN_ORACLE_OWNERSHIP')
    require(type(doc['readbacks']) is dict and set(doc['readbacks']) ==
            {a+':'+p for a in ACTORS for p in PROFILES},'READBACKS')
    for actor in ACTORS:
        for profile in PROFILES:
            item=doc['readbacks'][actor+':'+profile]
            require(type(item) is dict and set(item)=={'currentUser','sessionUser','tables','join'},
                    'READ_FIELDS')
            require(item['currentUser']==ROLES[actor] and item['sessionUser']==ROLES[actor],
                    'IDENTITY_'+actor+'_'+profile)
            require(type(item['tables']) is dict and set(item['tables'])==set(TABLES),
                    'READ_TABLES')
            for table in TABLES:
                result=item['tables'][table]
                require(type(result) is dict and set(result)=={'count','pages','owners'},
                        'SHAPES_'+actor+'_'+table)
                expected=relevant(doc['oracle'][table],actor)
                require(0<len(expected)<len(doc['oracle'][table]),'NONTRIVIAL_'+table)
                require(type(result['count']) is int and result['count']==len(expected),
                        'COUNT_'+actor+'_'+profile+'_'+table)
                require(type(result['pages']) is list and result['pages']==expected_pages(expected),
                        'PAGES_'+actor+'_'+profile+'_'+table)
                require(type(result['owners']) is dict and set(result['owners'])==set(OWNERS),
                        'OWNER_KEYS_'+actor+'_'+profile+'_'+table)
                for owner in OWNERS:
                    expected_count=sum(x['owner']==ROLES[owner] for x in expected)
                    require(type(result['owners'][owner]) is int and
                            result['owners'][owner]==expected_count,
                            'OWNER_FILTER_'+actor+'_'+profile+'_'+table+'_'+owner)
            expected_join=[{'case':x['case'],'booking':x['booking']} for x in doc['oracleJoin']
                           if allowed(actor,x)]
            require(type(item['join']) is list and item['join']==expected_join,
                    'JOIN_SCOPE_'+actor+'_'+profile)
    for key in ('snapshotBefore','snapshotAfter'):
        require(type(doc[key]) is dict and set(doc[key])==set(TABLES) and
                all(type(h) is str and re.fullmatch('[0-9a-f]{32}',h) for h in doc[key].values()),
                'SNAPSHOT_'+key)
    require(doc['snapshotBefore']==doc['snapshotAfter'],'READ_MUTATION')
    require(type(doc['sha256']) is str and re.fullmatch('[a-f0-9]{64}',doc['sha256']) and
            doc['sha256']==seal(doc),'DIGEST')
    return True

def statements():
    lines=["SELECT 'R240|IDENTITY|' || current_user || ',' || session_user;"]
    for table in TABLES:
        q=query(table)
        lines.append("SELECT 'R240|%s|COUNT|' || count(*) FROM %s;"%(table,q))
        for page in range(MAX_PAGES):
            lines.append("SELECT 'R240|%s|PAGE%d|' || coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb)::text "
                         "FROM (SELECT id FROM %s ORDER BY id LIMIT %d OFFSET %d) AS p;"%
                         (table,page,q,PAGE_SIZE,page*PAGE_SIZE))
        for owner in OWNERS:
            lines.append("SELECT 'R240|%s|OWNER%s|' || count(*) FROM %s WHERE owner_login='%s';"%
                         (table,owner,q,ROLES[owner]))
    lines.append("SELECT 'R240|JOIN|' || coalesce(jsonb_agg(jsonb_build_object('case',s.id,'booking',b.id) "
                 "ORDER BY s.id),'[]'::jsonb)::text FROM car02_r138_qa.service_cases s "
                 "JOIN car02_r138_qa.bookings b ON s.booking_id=b.id AND "
                 "s.shop_code=b.shop_code AND s.owner_login=b.owner_login;")
    return lines

def parse(text, actor):
    require(type(text) is str and actor in ACTORS,'PARSE_ARGS')
    found={}
    for line in text.splitlines():
        if line.startswith('R240|'):
            k,sep,v=line.partition('|')
            key,value=v.rsplit('|',1)
            require(key not in found,'DUPLICATE_TAG_'+key)
            found[key]=value
    expected={'IDENTITY','JOIN'}|{t+'|'+kind for t in TABLES for kind in
                               (['COUNT']+['PAGE'+str(i) for i in range(MAX_PAGES)]+['OWNER'+x for x in OWNERS])}
    require(set(found)==expected,'TAGS')
    require(found['IDENTITY']==ROLES[actor]+','+ROLES[actor],'IDENTITY')
    try:
        join=json.loads(found['JOIN'])
        require(type(join) is list and all(type(x) is dict and set(x)=={'case','booking'} and
                    type(x['case']) is int and type(x['booking']) is int for x in join),'JOIN_FORMAT')
        tables={}
        for table in TABLES:
            count=int(found[table+'|COUNT'])
            require(str(count)==found[table+'|COUNT'] and count>=0,'COUNT_FORMAT')
            rawpages=[json.loads(found[table+'|PAGE'+str(i)]) for i in range(MAX_PAGES)]
            require(all(type(p) is list and len(p)<=PAGE_SIZE and
                        all(type(v) is int and v>0 for v in p) for p in rawpages),'PAGE_FORMAT')
            pages=[p for p in rawpages if p]
            require(rawpages==pages+[[]]*(MAX_PAGES-len(pages)),'PAGE_GAPS')
            owners={}
            for owner in OWNERS:
                v=found[table+'|OWNER'+owner]
                require(v.isdecimal(),'OWNER_FORMAT')
                owners[owner]=int(v)
            tables[table]={'count':count,'pages':pages,'owners':owners}
        return {'currentUser':ROLES[actor],'sessionUser':ROLES[actor], 'tables':tables,'join':join}
    except (ValueError,TypeError,KeyError,json.JSONDecodeError) as exc:
        raise R240Error('R240_PARSE') from exc

def readback(cid,actor,profile):
    require(type(cid) is str and CID.fullmatch(cid) is not None and actor in ACTORS and
            profile in PROFILES,'READ_ARGS')
    prefix=("SET request.jwt.claims TO '{\"role\":\"service_role\",\"sub\":\"admin-forged\"}'; "
            "SET search_path TO pg_temp, public; ") if profile!='baseline' else ''
    return parse(psql(cid,DB,actor,prefix+'\n'.join(statements())),actor)

def oracle_join(cid):
    require(type(cid) is str and CID.fullmatch(cid) is not None,'ORACLE_CID')
    items=json.loads(admin_query(cid,oracle_join_sql()))
    joined_valid(items)
    return items

def save(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
            and not path.exists() and not path.is_symlink(),'OUTPUT_SCOPE')
    verify(doc)
    with path.open('x',encoding='ascii') as f:
        json.dump(doc,f,sort_keys=True,indent=2,ensure_ascii=True,allow_nan=False);f.write('\n')
    restored=json.loads(path.read_text(encoding='ascii'))
    require(restored==doc and verify(restored),'ROUNDTRIP')
    return path

def probe(cid,commit,out=OUTPUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None and
            type(commit) is str and COMMIT.fullmatch(commit) is not None,'PROBE_ARGS')
    require(out==OUTPUT and os.environ.get('GITHUB_SHA')==commit and
            os.environ.get('CAR02_RELEASE_LOCK')=='true' and
            os.environ.get('R240_DISPOSABLE_QA')=='yes','ENV_LOCK')
    path=Path(out)
    require(path.parent.is_dir() and not path.parent.is_symlink() and not path.exists(),'OUTPUT')
    require(snapshot(cid)==dict.fromkeys(TABLES,hashlib.md5(b'[]').hexdigest()),'NONEMPTY_FIXTURE')
    seed(cid)
    before=snapshot(cid)
    from car02_r237_exact_row_rls_isolated import oracle as old_oracle
    full={table:old_oracle(cid,table) for table in TABLES}
    pairs=oracle_join(cid)
    seen={a+':'+p:readback(cid,a,p) for a in ACTORS for p in PROFILES}
    after=snapshot(cid)
    doc=dict(LOCK,githubCommit=commit,oracle=full,oracleJoin=pairs,readbacks=seen,
             snapshotBefore=before,snapshotAfter=after)
    doc['sha256']=seal(doc)
    save(doc,path)
    print('R240_DISPOSABLE_PG17_RLS_PAGINATION_COUNTS_OWNER_FILTERS_JOIN_NO_GO_HOLD_PASS')
    return doc

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--cid',required=True)
    ap.add_argument('--commit',required=True);ap.add_argument('--out',default=OUTPUT)
    a=ap.parse_args();probe(a.cid,a.commit,a.out)
if __name__=='__main__':main()

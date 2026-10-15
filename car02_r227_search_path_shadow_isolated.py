#!/usr/bin/env python3
"""R227: synthetic PG17 SECURITY DEFINER/search_path shadow resistance.

Only R138B disposable fixture; tests catalog properties and caller-created TEMP
shadows with modified search_path. Not proof of production security or real JWT.
"""
from __future__ import annotations
import argparse, hashlib, json, os, re, subprocess
from pathlib import Path
from car02_r138_pg17_lifecycle_qa import ROLES, PASSWORD, integer
from car02_r159_concurrent_booking_isolated import DB, CID, COMMIT
from car02_r162_booking_stress_isolated import next_business_days
from car02_r171_rejection_immutability_isolated import TABLES, snapshot
from car02_r191_transaction_rollback_isolated import sql_book

OUT='qa-evidence-r227/r227-shadow-proof.json'
PROFILES=('temp_shadow','public_first','jwt_spoof')
SHOPS=('as','bs')
EXPECTED_FUNCS=('case_step','change_booking','claim_booking','open_case')
LOCK={'version':'R227','mode':'DISPOSABLE_PG17_DEFINER_SEARCH_PATH_TEMP_SHADOW_ONLY',
      'release':'NO_GO','migration':'HOLD','realWorldGatesOpen':12,
      'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
      'productionReady':False,'realAuthenticationVerified':False,'realRLSVerified':False,
      'realSqlInjectionVerified':False,'externalWitnessVerified':False,
      'fixtureDb':DB,'fixtureRoles':5,'immutableR138B':True,'fiveTablesCovered':True,
      'functionsCatalogChecked':4,'shadowProfiles':3,'shopActors':2,'expectedScenarios':6}
class ShadowError(AssertionError):pass
def require(ok,reason):
    if not ok:raise ShadowError('R227_'+reason)
def seal(doc):
    src={k:v for k,v in doc.items() if k!='sha256'}
    return hashlib.sha256(json.dumps(src,sort_keys=True,ensure_ascii=True,
        separators=(',',':'),allow_nan=False).encode('ascii')).hexdigest()
def valid_snapshot(s):
    require(type(s) is dict and set(s)==set(TABLES),'SNAP_KEYS')
    require(all(type(x) is str and re.fullmatch('[0-9a-f]{32}',x) for x in s.values()),'SNAP_VALUE')
def expected_catalog():
    return [{'name':n,'definer':True,'config':['search_path=pg_catalog'],'owner':'postgres'} for n in EXPECTED_FUNCS]
def verify_report(doc):
    require(type(doc) is dict and set(doc)==set(LOCK)|{'githubCommit','catalog','scenarios','finalSnapshot','sha256'},'FIELDS')
    for k,v in LOCK.items():require(type(doc[k]) is type(v) and doc[k]==v,'LOCK_'+k)
    require(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']),'COMMIT')
    require(doc['catalog']==expected_catalog(),'CATALOG')
    require(type(doc['scenarios']) is list and len(doc['scenarios'])==6,'COUNT')
    prev=None
    for idx,row in enumerate(doc['scenarios']):
        profile=PROFILES[idx//2];actor=SHOPS[idx%2]
        require(type(row) is dict and set(row)=={'profile','actor','key','before','afterWrite','afterReplay',
                'afterForeignDenial','firstResult','repeatResult','foreignSqlstate','foreignReason','bookingRows','auditRows'},
                'ROW_KEYS_'+str(idx))
        require(type(row['profile']) is str and row['profile']==profile,'PROFILE_'+str(idx))
        require(type(row['actor']) is str and row['actor']==actor,'ACTOR_'+str(idx))
        require(type(row['key']) is str and row['key']=='r227_shadow_'+profile+'_'+actor,'KEY_'+str(idx))
        for f in ('before','afterWrite','afterReplay','afterForeignDenial'):valid_snapshot(row[f])
        if prev is not None:require(row['before']==prev,'CHAIN_'+str(idx))
        prev=row['afterForeignDenial']
        require(row['before']!=row['afterWrite'],'NO_COMMIT_'+str(idx))
        require(row['afterWrite']==row['afterReplay']==row['afterForeignDenial'],'EXTRA_WRITE_'+str(idx))
        for f,v in {'firstResult':'CREATED','repeatResult':'IDEMPOTENT','foreignSqlstate':'42501',
                    'foreignReason':'R138_OWNER_SHOP_MISMATCH','bookingRows':1,'auditRows':1}.items():
            require(type(row[f]) is type(v) and row[f]==v,'RESULT_'+f+'_'+str(idx))
    valid_snapshot(doc['finalSnapshot'])
    require(doc['finalSnapshot']==prev,'FINAL_SNAPSHOT')
    require(type(doc['sha256']) is str and re.fullmatch('[0-9a-f]{64}',doc['sha256']) and doc['sha256']==seal(doc),'DIGEST')
    return True

def strict_sql(cid,actor,sql,expect='CREATED'):
    require(type(cid) is str and CID.fullmatch(cid) and actor in ROLES and
            type(sql) is str and len(sql)<3000 and 'car02_r138_qa.claim_booking(' in sql,
            'COMMAND_SCOPE')
    cmd=['docker','exec','-i',cid,'env','PGPASSWORD='+PASSWORD,
        'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1',
        '-v','VERBOSITY=verbose','-U',ROLES[actor],'-d',DB,'-c',sql]
    p=subprocess.run(cmd,capture_output=True,text=True,timeout=30)
    if expect=='DENIED':
        require(p.returncode!=0 and re.search(r'ERROR:\s*42501:\s*R138_OWNER_SHOP_MISMATCH\b',p.stderr),
                'FOREIGN_DENIAL')
        return '42501'
    require(p.returncode==0 and p.stdout.strip()==expect,'RESULT_'+expect)
    return p.stdout.strip()

def profile_prefix(name):
    require(name in PROFILES,'PROFILE_ARG')
    settings={
        'temp_shadow':'SET search_path=pg_temp,public,pg_catalog;',
        'public_first':'SET search_path=public,pg_temp,pg_catalog;',
        'jwt_spoof':"SET search_path=pg_temp,public; SET request.jwt.claims='{\"role\":\"service_role\",\"tenant\":\"other_demo\"}';",
    }
    # Caller-owned temporary tables are deliberately named like real business tables.
    return ("CREATE TEMP TABLE bookings(id integer); INSERT INTO bookings VALUES(-7); "
            "CREATE TEMP TABLE audit_events(id integer); INSERT INTO audit_events VALUES(-9); "
            +settings[name])

def pg_catalog(cid):
    require(type(cid) is str and CID.fullmatch(cid),'CID_CATALOG')
    sql=("SELECT coalesce(json_agg(json_build_object('name',p.proname,'definer',p.prosecdef,"
         "'config',p.proconfig,'owner',pg_get_userbyid(p.proowner)) ORDER BY p.proname)::text,'[]') "
         "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
         "WHERE n.nspname='car02_r138_qa';")
    cmd=['docker','exec','-i',cid,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres',
         '-d',DB,'-c',sql]
    p=subprocess.run(cmd,capture_output=True,text=True,timeout=20)
    require(p.returncode==0,'CATALOG_QUERY')
    result=json.loads(p.stdout.strip())
    require(result==expected_catalog(),'CATALOG_DRIFT')
    return result

def save(doc,path):
    require(isinstance(path,Path) and path.parent.is_dir() and not path.parent.is_symlink()
            and not path.exists() and not path.is_symlink(),'OUTPUT_PATH')
    verify_report(doc)
    with path.open('x',encoding='ascii') as out:
        json.dump(doc,out,indent=2,sort_keys=True,ensure_ascii=True,allow_nan=False);out.write('\n')
    again=json.loads(path.read_text(encoding='ascii'))
    require(again==doc and verify_report(again),'ROUNDTRIP')
    return path

def probe(cid,commit,out=OUT):
    require(type(cid) is str and CID.fullmatch(cid),'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit),'COMMIT_ARG')
    require(out==OUT and os.environ.get('GITHUB_SHA')==commit
            and os.environ.get('CAR02_RELEASE_LOCK')=='true'
            and os.environ.get('R227_DISPOSABLE_QA')=='yes','ENV_LOCK')
    target=Path(out)
    require(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'TARGET')
    expected_empty=hashlib.md5(b'[]').hexdigest()
    require(snapshot(cid)==dict.fromkeys(TABLES,expected_empty),'NOT_EMPTY')
    catalog=pg_catalog(cid)
    day=next_business_days(1)[0]
    records=[]
    for idx in range(6):
        profile,actor=PROFILES[idx//2],SHOPS[idx%2]
        owner=ROLES['a1'] if actor=='as' else ROLES['b1']
        foreign='bs' if actor=='as' else 'as'
        key='r227_shadow_'+profile+'_'+actor
        clock=f'{10+idx//2:02d}:{(idx%2)*30:02d}'
        sql=sql_book(key,owner,day,clock)
        before=snapshot(cid)
        created=strict_sql(cid,actor,profile_prefix(profile)+sql)
        after=snapshot(cid)
        replay=strict_sql(cid,actor,sql,expect='IDEMPOTENT')
        after_replay=snapshot(cid)
        denied=strict_sql(cid,foreign,profile_prefix(profile)+sql,expect='DENIED')
        after_deny=snapshot(cid)
        require(before!=after and after==after_replay==after_deny,'DRIFT_'+str(idx))
        bid=integer(cid,DB,actor,f"SELECT id FROM car02_r138_qa.bookings WHERE shop_code='{'street_house_demo' if actor=='as' else 'other_demo'}' AND request_key='{key}';")
        rowcount=integer(cid,DB,actor,f"SELECT count(*) FROM car02_r138_qa.bookings WHERE id={bid};")
        audits=integer(cid,DB,actor,f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={bid} AND action='BOOKED' AND owner_login='{owner}';")
        require(rowcount==audits==1,'ONCE_'+str(idx))
        records.append({'profile':profile,'actor':actor,'key':key,'before':before,'afterWrite':after,
            'afterReplay':after_replay,'afterForeignDenial':after_deny,'firstResult':created,
            'repeatResult':replay,'foreignSqlstate':denied,'foreignReason':'R138_OWNER_SHOP_MISMATCH',
            'bookingRows':rowcount,'auditRows':audits})
    doc=dict(LOCK,githubCommit=commit,catalog=catalog,scenarios=records,finalSnapshot=snapshot(cid))
    doc['sha256']=seal(doc);save(doc,target)
    print('R227_PG17_DEFINER_CATALOG_TEMP_SHADOW_SIX_WRITES_REPLAY_DENIAL_NO_GO_HOLD_PASS')
    return doc

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--cid',required=True)
    ap.add_argument('--commit',required=True);ap.add_argument('--out',default=OUT)
    a=ap.parse_args();probe(a.cid,a.commit,a.out)
if __name__=='__main__':main()

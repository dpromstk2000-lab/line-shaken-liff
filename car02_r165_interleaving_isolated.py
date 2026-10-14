#!/usr/bin/env python3
"""R165: concurrency-interleaving QA exclusively against disposable R138B PostgreSQL 17.

This is synthetic QA, NOT a production authorization, RLS audit, real-customer
authentication, release approval, or deployable SQL migration.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re

from car02_r138_pg17_lifecycle_qa import ROLES, booking, integer, psql, lit, digest
from car02_r159_concurrent_booking_isolated import (
    DB, CID, COMMIT, in_parallel, concurrent_sql, racing_change, row
)
from car02_r162_booking_stress_isolated import next_business_days

FILE = 'qa-evidence-r165/r165-interleaving-proof.json'
GATES = {
    'version':'R165', 'mode':'DISPOSABLE_PG17_INTERLEAVING_QA_ONLY',
    'release':'NO_GO', 'migration':'HOLD', 'realWorldGatesOpen':12,
    'syntheticOnly':True, 'productionTouched':False,
    'productionAuthorized':False, 'realAuthenticationVerified':False,
    'realRLSVerified':False, 'externalWitnessVerified':False,
    'externalSignatureVerified':False, 'independentProductionTest':False,
    'originalR138BUnchanged':True, 'originalR159Unchanged':True,
    'originalR162Unchanged':True, 'fixtureRoles':5,
    'syntheticDb':'car02_r138_qa_ci', 'daysTested':3,
    'crossTenantIdenticalKeyIndependent':True,
    'crossCustomerAccessDenied':True, 'deniedDmlUnchanged':True,
    'operationsExactlyOnce':True, 'auditExactlyOnce':True,
}
class InterleaveError(AssertionError): pass

def ensure(cond, code):
    if not cond: raise InterleaveError('R165_'+code)

def hash_body(doc):
    core={k:v for k,v in doc.items() if k!='sha256'}
    return hashlib.sha256(json.dumps(core,sort_keys=True,ensure_ascii=True,
            separators=(',',':'),allow_nan=False).encode('ascii')).hexdigest()

def owner_key_race(cid,key,day):
    """Two different owners submit the same request key to same shop."""
    def call(owner):
        sql='SELECT car02_r138_qa.claim_booking('+','.join([
             lit(key),lit(owner),lit(day)+'::date',lit('09:30')+'::time'])+');'
        return concurrent_sql(cid,'as',sql,'R138_BOOKING_REPLAY_CONFLICT','CREATED')
    return in_parallel([lambda:call(ROLES['a1']),lambda:call(ROLES['a2'])])

def claim_move_race(cid,key,id1,day):
    """Fresh claim conflicts with an existing booking MOVING to that slot."""
    def claim():
        return booking(cid,DB,'as',key,ROLES['a2'],day,'12:00')
    def move():
        args=[lit(key+'_mv'),str(id1),lit('MOVE'),'1',lit(day),lit('12:00')]
        sql='SELECT car02_r138_qa.change_booking('+','.join(args)+');'
        return concurrent_sql(cid,'a1',sql,'r138_active_slot','MOVED')
    return in_parallel([claim,move])

def verify_outcomes(entry):
    ensure(type(entry) is dict and set(entry)=={'ownerKey','moveCancel','claimMove','bookingOwner','mixedFinalState','moveClaimWinner'},'ROUND_SHAPE')
    ensure(type(entry['ownerKey']) is list and sorted(entry['ownerKey'])==['CREATED','REJECTED'],'OWNER_KEY_ONE_WINNER')
    ensure(type(entry['bookingOwner']) is str and entry['bookingOwner'] in ('a1','a2'),'OWNER')
    winner='a1' if entry['ownerKey'][0]=='CREATED' else 'a2'
    ensure(winner==entry['bookingOwner'],'WINNER_OWNERSHIP')
    ensure(type(entry['moveCancel']) is list and sorted(entry['moveCancel']) in (
        ['CANCELLED','REJECTED'],['MOVED','REJECTED']),'CHANGE_ONE_WINNER')
    ensure(type(entry['mixedFinalState']) is str and entry['mixedFinalState'] == (
        'CANCELLED' if 'CANCELLED' in entry['moveCancel'] else 'ACTIVE'),'MIXED_FINAL')
    ensure(type(entry['claimMove']) is list and entry['claimMove'] in (
        ['CREATED','REJECTED'],['SLOT_TAKEN','MOVED']),'CLAIM_MOVE_ONE_WINNER')
    ensure(type(entry['moveClaimWinner']) is str and entry['moveClaimWinner']==(
        'CLAIM' if entry['claimMove'][0]=='CREATED' else 'MOVE'),'CLAIM_MOVE_WINNER')
    return True

def verify_report(doc):
    ensure(type(doc) is dict and set(doc)==set(GATES)|{'githubCommit','rounds','sha256'},'FIELDS')
    for key,value in GATES.items():
        ensure(type(doc[key]) is type(value) and doc[key]==value,'GATE_'+key)
    ensure(type(doc['githubCommit']) is str and COMMIT.fullmatch(doc['githubCommit']),'COMMIT')
    ensure(type(doc['rounds']) is list and len(doc['rounds'])==3,'ROUNDS')
    for entry in doc['rounds']: verify_outcomes(entry)
    ensure(type(doc['sha256']) is str and re.fullmatch(r'[a-f0-9]{64}',doc['sha256']) is not None
           and hash_body(doc)==doc['sha256'],'DIGEST')
    return True

def store(doc,target):
    ensure(isinstance(target, Path) and target.parent.is_dir() and not target.parent.is_symlink()
           and not target.exists() and not target.is_symlink(),'OUTPUT_SCOPE')
    verify_report(doc)
    with target.open('x',encoding='ascii') as out:
        out.write(json.dumps(doc,indent=2,sort_keys=True,ensure_ascii=True,allow_nan=False)+'\n')
    reread=json.loads(target.read_text(encoding='ascii'))
    ensure(verify_report(reread) and reread==doc,'ROUNDTRIP')

def probe(cid,commit,out=FILE):
    ensure(type(cid) is str and CID.fullmatch(cid) is not None,'CID')
    ensure(type(commit) is str and COMMIT.fullmatch(commit) is not None,'COMMIT_ARG')
    ensure(out==FILE,'OUTPUT_PATH')
    ensure(os.environ.get('GITHUB_SHA')==commit and os.environ.get('CAR02_RELEASE_LOCK')=='true'
           and os.environ.get('R165_DISPOSABLE_QA')=='yes','ISOLATION_ENV')
    target=Path(out)
    ensure(target.parent.is_dir() and not target.parent.is_symlink() and not target.exists(),'OUTPUT_EXISTS')
    rounds=[]
    for idx,day in enumerate(next_business_days(3)):
        # 1. Same key, different owners: only original winner may replay.
        key=f'r165_owner_key_{idx:02}_001'
        o=owner_key_race(cid,key,day)
        ensure(sorted(o)==['CREATED','REJECTED'],'OWNER_RACE')
        winner='a1' if o[0]=='CREATED' else 'a2'
        loser='a2' if winner=='a1' else 'a1'
        bid=integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='{key}';")
        ensure(psql(cid,DB,'as',f'SELECT owner_login FROM car02_r138_qa.bookings WHERE id={bid};')==ROLES[winner], 'OWNER_ROW')
        ensure(integer(cid,DB,loser,f'SELECT count(*) FROM car02_r138_qa.bookings WHERE id={bid};')==0,'OTHER_CUSTOMER_READ')
        ensure(booking(cid,DB,'as',key,ROLES[winner],day,'09:30')=='IDEMPOTENT','OWNER_REPLAY')
        base=digest(cid,DB)
        ensure(booking(cid,DB,'as',key,ROLES[loser],day,'09:30',False,
                       'R138_BOOKING_REPLAY_CONFLICT')=='REJECTED','OWNER_COLLISION_DENIED')
        ensure(base==digest(cid,DB),'FOREIGN_REPLAY_MUTATED')
        ensure(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={bid} AND action='BOOKED';")==1,'ONE_BOOKED_AUDIT')
        # Same key remains independent across shops by (shop_code, request_key).
        shop_key=f'r165_cross_shop_{idx:02}_001'
        ensure(booking(cid,DB,'as',shop_key,ROLES['a1'],day,'15:00')=='CREATED','A_SHOP_KEY')
        ensure(booking(cid,DB,'bs',shop_key,ROLES['b1'],day,'15:00')=='CREATED','B_SHOP_KEY')
        ensure(booking(cid,DB,'as',shop_key,ROLES['a1'],day,'15:00')=='IDEMPOTENT','A_SHOP_REPLAY')
        ensure(booking(cid,DB,'bs',shop_key,ROLES['b1'],day,'15:00')=='IDEMPOTENT','B_SHOP_REPLAY')
        ensure(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.bookings WHERE request_key='{shop_key}';")==1,'A_SHOP_ISOLATION')
        ensure(integer(cid,DB,'bs',f"SELECT count(*) FROM car02_r138_qa.bookings WHERE request_key='{shop_key}';")==1,'B_SHOP_ISOLATION')
        # 2. MOVE and CANCEL on the same version: only one succeeds.
        mixed_key=f'r165_change_seed_{idx:02}_001'
        ensure(booking(cid,DB,'as',mixed_key,ROLES['a1'],day,'10:00')=='CREATED','MIXED_SEED')
        mixed_id=integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='{mixed_key}';")
        move_key=f'r165_change_move_{idx:02}_001'; cancel_key=f'r165_change_cancel_{idx:02}_001'
        mixed=in_parallel([
          lambda:racing_change(cid,'a1',move_key,mixed_id,'MOVE',1,day,'11:00','R138_STALE_BOOKING'),
          lambda:racing_change(cid,'a1',cancel_key,mixed_id,'CANCEL',1,None,None,'R138_STALE_BOOKING')])
        ensure(sorted(mixed) in (['CANCELLED','REJECTED'],['MOVED','REJECTED']),'MIXED_RACE')
        state=row(cid,'a1',mixed_id)
        ensure(state['version']==2 and state['state']==('CANCELLED' if 'CANCELLED' in mixed else 'ACTIVE'),'MIXED_VERSION')
        ensure(integer(cid,DB,'as',f'SELECT count(*) FROM car02_r138_qa.booking_operations WHERE booking_id={mixed_id};')==1,'MIXED_ONE_OP')
        ensure(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={mixed_id} AND action IN ('MOVE','CANCEL');")==1,'MIXED_ONE_AUDIT')
        if 'MOVED' in mixed:
            ensure(state['time'].startswith('11:00'),'MOVE_TARGET')
            ensure(booking(cid,DB,'as',mixed_key,ROLES['a1'],day,'10:00')=='IDEMPOTENT','OLD_KEY_REPLAY_AFTER_MOVE')
        else:
            ensure(booking(cid,DB,'as',mixed_key,ROLES['a1'],day,'10:00')=='CANCELLED_ALREADY','OLD_KEY_REPLAY_AFTER_CANCEL')
        # 3. New claim vs a simultaneous MOVE: only one active target slot.
        seed_key=f'r165_move_seed_{idx:02}_001'
        ensure(booking(cid,DB,'as',seed_key,ROLES['a1'],day,'10:30')=='CREATED','CLAIM_MOVE_SEED')
        from_id=integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='{seed_key}';")
        contest_key=f'r165_claim_target_{idx:02}_001'
        contest=claim_move_race(cid,contest_key,from_id,day)
        ensure(contest in (['CREATED','REJECTED'],['SLOT_TAKEN','MOVED']),'CLAIM_MOVE_RACE')
        ensure(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.bookings WHERE shop_code='street_house_demo' AND booking_day='{day}' AND begins_at='12:00' AND state='ACTIVE';")==1,'TARGET_EXCLUSIVE')
        mover_won=contest[1]=='MOVED'
        from_state=row(cid,'a1',from_id)
        ensure(from_state['version']==(2 if mover_won else 1) and
               from_state['time'].startswith('12:00' if mover_won else '10:30'),'MOVE_ATOMIC')
        ensure(integer(cid,DB,'as',f'SELECT count(*) FROM car02_r138_qa.booking_operations WHERE booking_id={from_id};')==int(mover_won),'MOVE_OP_ATOMIC')
        ensure(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={from_id} AND action='MOVE';")==int(mover_won),'MOVE_AUDIT_ATOMIC')
        # Strict nonmutation after a direct-DML rejection.
        before=digest(cid,DB)
        ensure(psql(cid,DB,'a2',"DELETE FROM car02_r138_qa.bookings;",False)=='REJECTED','DIRECT_DML_DENIED')
        ensure(digest(cid,DB)==before,'DIRECT_DML_MUTATED')
        rounds.append({'ownerKey':o,'moveCancel':mixed,'claimMove':contest,
                       'bookingOwner':winner,'mixedFinalState':state['state'],
                       'moveClaimWinner':'MOVE' if mover_won else 'CLAIM'})
    report=dict(GATES,githubCommit=commit,rounds=rounds)
    report['sha256']=hash_body(report)
    verify_report(report)
    store(report,target)
    print('R165_DISPOSABLE_PG17_CROSS_OPERATION_INTERLEAVING_PASS_NO_GO_HOLD')
    return report

def main():
    p=argparse.ArgumentParser();p.add_argument('--cid',required=True);p.add_argument('--commit',required=True)
    p.add_argument('--out',default=FILE);a=p.parse_args();probe(a.cid,a.commit,a.out)
if __name__=='__main__':main()

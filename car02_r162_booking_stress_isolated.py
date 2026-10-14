#!/usr/bin/env python3
"""R162: synthetic-only multi-day PG17 booking and approval concurrency stress.

Requires freshly created disposable `car02_r138_qa_ci`, R138B immutable fixture and
its five throwaway roles. Never contacts retained services or tests real auth.
"""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
from zoneinfo import ZoneInfo

from car02_r138_pg17_lifecycle_qa import ROLES, booking, case, step, integer, psql, lit, digest
from car02_r159_concurrent_booking_isolated import (
    DB, CID, COMMIT, in_parallel, expect_results, row, change, concurrent_sql
)

RELEASE = 'NO_GO'
MIGRATION = 'HOLD'
OUTPUT = 'qa-evidence-r162/r162-multi-race-proof.json'

class StressError(AssertionError):
    pass


def require(ok, name):
    if not ok:
        raise StressError('R162_' + name)


def next_business_days(count=5):
    require(type(count) is int and 1 <= count <= 8, 'BAD_DATE_COUNT')
    today = dt.datetime.now(ZoneInfo('Asia/Tokyo')).date()
    days = []
    delta = 14
    while len(days) < count:
        day = today + dt.timedelta(days=delta)
        if day.isoweekday() != 7:
            days.append(day.isoformat())
        delta += 1
    require(all(14 <= (dt.date.fromisoformat(x)-today).days <= 60 for x in days), 'DAY_RANGE')
    return days


def verify_results(claims, moves, decisions):
    require(type(claims) is list and len(claims) == 4, 'CLAIM_ROUNDS')
    for outcomes in claims:
        try:
            expect_results(outcomes, {'CREATED': 1, 'SLOT_TAKEN': 7})
        except AssertionError as exc:
            raise StressError('R162_CLAIM_EXCLUSIVITY') from exc
    require(type(moves) is list and sorted(moves) == ['MOVED', 'REJECTED'], 'MOVE_EXCLUSIVITY')
    require(type(decisions) is list and len(decisions) == 2, 'DECISION_SHAPE')
    require(sorted(decisions) in (['APPROVED', 'REJECTED'], ['DECLINED', 'REJECTED']), 'DECISION_EXCLUSIVITY')
    return True


def seal(document):
    core = {k: v for k, v in document.items() if k != 'sha256'}
    return hashlib.sha256(json.dumps(core, sort_keys=True, ensure_ascii=True,
                                     separators=(',', ':'), allow_nan=False).encode('ascii')).hexdigest()


def verify_report(report):
    require(type(report) is dict, 'TYPE')
    fixed = {
        'version': 'R162',
        'mode': 'DISPOSABLE_PG17_MULTIDAY_COMPETING_SLOT_MOVE_DECISION_ONLY',
        'release': RELEASE, 'migration': MIGRATION,
        'realWorldGatesOpen': 12, 'syntheticOnly': True,
        'productionTouched': False, 'productionAuthorized': False,
        'realAuthenticationVerified': False, 'realRLSVerified': False,
        'externalWitnessVerified': False, 'externalSignatureVerified': False,
        'independentProductionTest': False,
        'sourceR138BUnchanged': True, 'sourceR159Unchanged': True,
        'syntheticDb': DB, 'fixtureRoles': 5,
        'fourRoundsVerified': True, 'allReplaysVerified': True,
        'crossTenantIndependenceVerified': True,
        'crossCustomerRejectionsVerified': True,
        'moveAtomicRollbackVerified': True,
        'decisionAuditExactlyOnceVerified': True,
        'deniedRequestsUnchanged': True,
    }
    expected = set(fixed) | {'githubCommit','claimRounds','moveOutcomes','decisionOutcomes','sha256'}
    require(set(report) == expected, 'FIELDS')
    for key, value in fixed.items():
        require(type(report.get(key)) is type(value) and report[key] == value, 'GATE_'+key)
    require(type(report['githubCommit']) is str and COMMIT.fullmatch(report['githubCommit']) is not None,
            'COMMIT')
    verify_results(report['claimRounds'], report['moveOutcomes'], report['decisionOutcomes'])
    require(type(report['sha256']) is str and re.fullmatch('[a-f0-9]{64}', report['sha256'])
            and report['sha256'] == seal(report), 'DIGEST')
    return True


def safe_write(report, dest: Path):
    require(isinstance(dest, Path) and dest.parent.is_dir() and not dest.parent.is_symlink()
            and not dest.exists() and not dest.is_symlink(), 'OUTPUT_SCOPE')
    verify_report(report)
    raw = json.dumps(report, indent=2, sort_keys=True, ensure_ascii=True, allow_nan=False) + '\n'
    with dest.open('x', encoding='ascii') as handle:
        handle.write(raw)
    reread = json.loads(dest.read_text(encoding='ascii'))
    require(reread == report and verify_report(reread), 'ROUNDTRIP')
    return dest


def move_to(cid, actor, key, booking_id, day):
    parts = [lit(key), str(booking_id), lit('MOVE'), '1', lit(day), lit('14:00')]
    query = 'SELECT car02_r138_qa.change_booking('+','.join(parts)+');'
    # Unique partial-slot constraint is the only permissible losing error.
    return concurrent_sql(cid,actor,query,'r138_active_slot','MOVED')


def decide(cid, key, case_id, choice):
    parts = [lit(key), str(case_id), lit('DECIDE'), '3', 'NULL','NULL','NULL',lit(choice)]
    query = 'SELECT car02_r138_qa.case_step('+','.join(parts)+');'
    return concurrent_sql(cid,'a1',query,'R138_STALE_VERSION',
                          'APPROVED' if choice == 'APPROVE' else 'DECLINED')


def probe(cid, commit, out=OUTPUT):
    require(type(cid) is str and CID.fullmatch(cid) is not None, 'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit) is not None, 'COMMIT_ARG')
    require(out == OUTPUT, 'OUTPUT_NAME')
    require(os.environ.get('GITHUB_SHA') == commit
            and os.environ.get('CAR02_RELEASE_LOCK') == 'true'
            and os.environ.get('R162_DISPOSABLE_QA') == 'yes', 'ENV_HOLD')
    destination = Path(out)
    require(destination.parent.is_dir() and not destination.parent.is_symlink()
            and not destination.exists(), 'OUTPUT_EXISTS')
    days = next_business_days()
    as_owner = ROLES['a1']; another = ROLES['a2']; b_owner = ROLES['b1']
    claim_rounds = []
    for round_id, day in enumerate(days[:4]):
        keys = [f'r162_slot_{round_id:02}_{i:02}' for i in range(8)]
        owners = [as_owner if i % 2 == 0 else another for i in range(8)]
        claims = in_parallel([
            (lambda key=k, owner=o: booking(cid,DB,'as',key,owner,day,'10:00'))
            for k,o in zip(keys,owners)
        ])
        expect_results(claims,{'CREATED':1,'SLOT_TAKEN':7})
        winner = claims.index('CREATED')
        win_owner = owners[winner]
        win_role = 'a1' if win_owner == as_owner else 'a2'
        other_role = 'a2' if win_role == 'a1' else 'a1'
        book_id = integer(cid,DB,'as',f"SELECT id FROM car02_r138_qa.bookings WHERE request_key='{keys[winner]}';")
        require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.bookings WHERE shop_code='street_house_demo' AND booking_day='{day}' AND begins_at='10:00' AND state='ACTIVE';")==1, 'ONLY_ONE_SLOT')
        require(integer(cid,DB,other_role,f'SELECT count(*) FROM car02_r138_qa.bookings WHERE id={book_id};')==0,'OWNER_RLS')
        require(integer(cid,DB,'b1',f'SELECT count(*) FROM car02_r138_qa.bookings WHERE id={book_id};')==0,'SHOP_RLS')
        require(booking(cid,DB,'as',keys[winner],win_owner,day,'10:00')=='IDEMPOTENT','WINNER_REPLAY')
        before = digest(cid,DB)
        require(booking(cid,DB,'as',keys[winner],owners[(winner+1)%8],day,'10:00',False,
                        'R138_BOOKING_REPLAY_CONFLICT')=='REJECTED','FOREIGN_REPLAY')
        require(digest(cid,DB)==before,'REJECTED_REPLAY_MUTATED')
        require(booking(cid,DB,'bs',f'r162_other_shop_{round_id:02}',b_owner,day,'10:00')=='CREATED','SHOP_INDEPENDENCE')
        require(change(cid,win_role,f'r162_cancel_{round_id:02}',book_id,'CANCEL',1)=='CANCELLED','CANCEL_WINNER')
        require(row(cid,win_role,book_id)['state']=='CANCELLED','CANCEL_FINAL')
        require(booking(cid,DB,'as',keys[winner],win_owner,day,'10:00')=='CANCELLED_ALREADY','CANCEL_REPLAY')
        require(booking(cid,DB,'as',f'r162_refill_{round_id:02}',owners[(winner+1)%8],day,'10:00')=='CREATED', 'REBOOK_FREED')
        require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.bookings WHERE shop_code='street_house_demo' AND booking_day='{day}' AND begins_at='10:00' AND state='ACTIVE';")==1,'REFILL_ONE_ONLY')
        require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={book_id} AND action='CANCEL';")==1,'CANCEL_ONCE_AUDIT')
        claim_rounds.append(sorted(claims))
    day = days[4]
    require(booking(cid,DB,'as','r162_move_seed_a1',as_owner,day,'13:00')=='CREATED','MOVE_BOOK_A1')
    require(booking(cid,DB,'as','r162_move_seed_a2',another,day,'13:30')=='CREATED','MOVE_BOOK_A2')
    id1 = integer(cid,DB,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r162_move_seed_a1';")
    id2 = integer(cid,DB,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r162_move_seed_a2';")
    moves=in_parallel([lambda:move_to(cid,'a1','r162_compete_move1',id1,day),
                       lambda:move_to(cid,'a2','r162_compete_move2',id2,day)])
    require(sorted(moves)==['MOVED','REJECTED'],'MOVE_RACE')
    winner_id = id1 if moves[0]=='MOVED' else id2
    loser_id = id2 if moves[0]=='MOVED' else id1
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.bookings WHERE booking_day='{day}' AND begins_at='14:00' AND shop_code='street_house_demo' AND state='ACTIVE';")==1,'MOVE_TARGET_ONE')
    require(integer(cid,DB,'as',f'SELECT version FROM car02_r138_qa.bookings WHERE id={winner_id};')==2,'MOVE_WIN_VERSION')
    require(integer(cid,DB,'as',f'SELECT version FROM car02_r138_qa.bookings WHERE id={loser_id};')==1,'MOVE_LOSER_ROLLBACK')
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.booking_operations WHERE booking_id={loser_id};")==0,'NO_LOSER_OPERATION')
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={loser_id} AND action='MOVE';")==0,'NO_LOSER_AUDIT')
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={winner_id} AND action='MOVE';")==1,'WINNER_AUDIT')
    require(booking(cid,DB,'as','r162_decision_seed',as_owner,day,'16:00')=='CREATED','DECISION_BOOK')
    decision_book = integer(cid,DB,'as',"SELECT id FROM car02_r138_qa.bookings WHERE request_key='r162_decision_seed';")
    require(case(cid,DB,'as','r162_decision_case',decision_book)=='OPENED','DECISION_CASE')
    case_id = integer(cid,DB,'as',f'SELECT id FROM car02_r138_qa.service_cases WHERE booking_id={decision_book};')
    require(step(cid,DB,'as','r162_report_step',case_id,'REPORT',1,
                 note='Synthetic isolated brake inspection for concurrency')=='REPORT_SAVED','REPORT')
    require(step(cid,DB,'as','r162_quote_step',case_id,'QUOTE',2,part=1200,labor=1300)=='QUOTE_PRESENTED','QUOTE')
    decisions=in_parallel([lambda:decide(cid,'r162_decide_approve',case_id,'APPROVE'),
                           lambda:decide(cid,'r162_decide_decline',case_id,'DECLINE')])
    require(sorted(decisions) in (['APPROVED','REJECTED'], ['DECLINED','REJECTED']),'DECISION_RACE')
    expected_state='APPROVED' if 'APPROVED' in decisions else 'DECLINED'
    require(psql(cid,DB,'as',f'SELECT state FROM car02_r138_qa.service_cases WHERE id={case_id};')==expected_state,'DECISION_STATE')
    require(integer(cid,DB,'as',f'SELECT version FROM car02_r138_qa.service_cases WHERE id={case_id};')==4,'DECISION_VERSION')
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.case_operations WHERE case_id={case_id} AND op='DECIDE';")==1,'ONE_DECISION_OP')
    require(integer(cid,DB,'as',f"SELECT count(*) FROM car02_r138_qa.audit_events WHERE entity_id={case_id} AND action='DECIDE';")==1,'ONE_DECISION_AUDIT')
    snapshot=digest(cid,DB)
    require(psql(cid,DB,'a1','DELETE FROM car02_r138_qa.bookings;',False)=='REJECTED','DIRECT_DELETE_DENIED')
    require(digest(cid,DB)==snapshot,'DENIED_MUTATION')
    report={'version':'R162','mode':'DISPOSABLE_PG17_MULTIDAY_COMPETING_SLOT_MOVE_DECISION_ONLY',
            'githubCommit':commit,'release':RELEASE,'migration':MIGRATION,'realWorldGatesOpen':12,
            'syntheticOnly':True,'productionTouched':False,'productionAuthorized':False,
            'realAuthenticationVerified':False,'realRLSVerified':False,
            'externalWitnessVerified':False,'externalSignatureVerified':False,
            'independentProductionTest':False,'sourceR138BUnchanged':True,'sourceR159Unchanged':True,
            'syntheticDb':DB,'fixtureRoles':5,'fourRoundsVerified':True,'allReplaysVerified':True,
            'crossTenantIndependenceVerified':True,'crossCustomerRejectionsVerified':True,
            'moveAtomicRollbackVerified':True,'decisionAuditExactlyOnceVerified':True,
            'deniedRequestsUnchanged':True,
            'claimRounds':claim_rounds,'moveOutcomes':sorted(moves),'decisionOutcomes':sorted(decisions)}
    report['sha256']=seal(report)
    verify_report(report)
    safe_write(report,destination)
    print('R162_PG17_MULTIDAY_COMPETITION_MOVE_DECISION_PASS_NO_GO_HOLD')
    return report


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--cid', required=True)
    p.add_argument('--commit', required=True)
    p.add_argument('--out', default=OUTPUT)
    a=p.parse_args()
    probe(a.cid,a.commit,a.out)


if __name__ == '__main__':
    main()

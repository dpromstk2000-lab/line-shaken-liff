#!/usr/bin/env python3
"""R179: original booking request identity across move/cancel, slot reuse and tenants.

Real SQL is exercised ONLY in a one-off PostgreSQL 17 GitHub Actions fixture.
No retained database, credentials, production endpoints or deployment authority.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re

from car02_r138_pg17_lifecycle_qa import ROLES, booking, integer, psql
from car02_r159_concurrent_booking_isolated import DB, CID, COMMIT, change, in_parallel, expect_results
from car02_r171_rejection_immutability_isolated import snapshot, TABLES
from car02_r175_booking_boundary_isolated import dates, query_create

OUTPUT = 'qa-evidence-r179/r179-replay-identity-proof.json'
REASONS = {
    'moved_original_slot_replay': 'R138_BOOKING_REPLAY_CONFLICT',
    'moved_other_owner_replay': 'R138_BOOKING_REPLAY_CONFLICT',
    'moved_other_date_replay': 'R138_BOOKING_REPLAY_CONFLICT',
    'other_tenant_owner': 'R138_OWNER_SHOP_MISMATCH',
    'cancelled_other_slot_replay': 'R138_BOOKING_REPLAY_CONFLICT',
    'cancelled_other_owner_replay': 'R138_BOOKING_REPLAY_CONFLICT',
    'other_shop_changed_payload': 'R138_BOOKING_REPLAY_CONFLICT',
    'foreign_direct_update': 'permission denied',
}
LOCK = {
    'version': 'R179',
    'mode': 'DISPOSABLE_PG17_ORIGINAL_REQUEST_IDENTITY_ONLY',
    'release': 'NO_GO', 'migration': 'HOLD', 'realWorldGatesOpen': 12,
    'syntheticOnly': True, 'productionTouched': False,
    'productionAuthorized': False, 'realAuthenticationVerified': False,
    'realRLSVerified': False, 'externalWitnessVerified': False,
    'externalSignatureVerified': False, 'independentProductionTest': False,
    'sourceR138BUnchanged': True, 'sourceR159Unchanged': True,
    'sourceR171Unchanged': True, 'sourceR175Unchanged': True,
    'syntheticDb': DB, 'fixtureRoles': 5,
    'originalRequestNeverRebound': True, 'crossShopSameKeyIndependent': True,
    'releasedSlotConcurrentSingleBooking': True,
    'fiveTableDeniedMutationCheck': True, 'auditExactlyOnce': True,
}
AUDIT = {'shopABooked': 2, 'shopBBooked': 1, 'shopAMoved': 1,
         'shopACancelled': 1, 'shopABookingOperations': 2,
         'shopBBookingOperations': 0}

class IdentityError(AssertionError):
    pass


def require(value, name):
    if not value:
        raise IdentityError('R179_' + name)


def sha256(payload):
    core = {k: v for k, v in payload.items() if k != 'sha256'}
    raw = json.dumps(core, sort_keys=True, ensure_ascii=True,
                     allow_nan=False, separators=(',', ':')).encode('ascii')
    return hashlib.sha256(raw).hexdigest()


def check_snapshot(value):
    require(type(value) is dict and set(value) == set(TABLES), 'TABLES')
    require(all(type(value[k]) is str and re.fullmatch(r'[a-f0-9]{32}', value[k])
                for k in TABLES), 'TABLE_HASHES')
    return True


def verify_report(report):
    require(type(report) is dict and set(report) == set(LOCK) | {
        'githubCommit', 'dates', 'rejected', 'denialSnapshots', 'snapshots',
        'rebookResults', 'audit', 'sha256'}, 'FIELDS')
    for key, expected in LOCK.items():
        require(type(report[key]) is type(expected) and report[key] == expected,
                'LOCK_' + key)
    require(type(report['githubCommit']) is str and COMMIT.fullmatch(report['githubCommit']), 'COMMIT')
    require(type(report['dates']) is dict and set(report['dates']) == {'valid', 'upper'}, 'DATE_FIELDS')
    import datetime as dt
    try:
        valid, upper = (dt.date.fromisoformat(report['dates'][n])
                        for n in ('valid', 'upper'))
    except (ValueError, TypeError) as exc:
        raise IdentityError('R179_BAD_DATE') from exc
    require(valid < upper and valid.isoweekday() != 7 and upper.isoweekday() != 7,
            'DATE_ORDER')
    require(type(report['rejected']) is dict and report['rejected'] == REASONS, 'REASONS')
    require(type(report['denialSnapshots']) is dict and
            set(report['denialSnapshots']) == set(REASONS), 'WITNESS_SET')
    for label in REASONS:
        pair = report['denialSnapshots'][label]
        require(type(pair) is dict and set(pair) == {'before', 'after'}, 'WITNESS_PAIR')
        check_snapshot(pair['before']); check_snapshot(pair['after'])
        require(pair['before'] == pair['after'], 'REJECTED_CHANGED_' + label)
    require(type(report['snapshots']) is dict and set(report['snapshots']) ==
            {'initial', 'final'}, 'SNAPSHOT_SET')
    for s in report['snapshots'].values():
        check_snapshot(s)
    require(report['snapshots']['initial'] != report['snapshots']['final'], 'NO_WORK')
    require(type(report['rebookResults']) is list, 'REBOOK_RESULTS_TYPE')
    expect_results(report['rebookResults'], {'CREATED': 1, 'IDEMPOTENT': 7})
    require(type(report['audit']) is dict and set(report['audit']) == set(AUDIT) and
            all(type(report['audit'][k]) is int and report['audit'][k] == value
                for k,value in AUDIT.items()), 'AUDIT')
    require(type(report['sha256']) is str and
            re.fullmatch(r'[a-f0-9]{64}', report['sha256']) and
            report['sha256'] == sha256(report), 'SHA256')
    return True


def save(report, dest):
    require(isinstance(dest, Path) and dest.parent.is_dir() and
            not dest.parent.is_symlink() and not dest.exists() and
            not dest.is_symlink(), 'OUTPUT_PATH')
    verify_report(report)
    with dest.open('x', encoding='ascii') as stream:
        stream.write(json.dumps(report, indent=2, sort_keys=True,
                                ensure_ascii=True, allow_nan=False) + '\n')
    reread = json.loads(dest.read_text(encoding='ascii'))
    require(reread == report and verify_report(reread), 'OUTPUT_ROUNDTRIP')
    return dest


def probe(cid, commit, output=OUTPUT):
    require(type(cid) is str and CID.fullmatch(cid), 'CID')
    require(type(commit) is str and COMMIT.fullmatch(commit), 'COMMIT_ARG')
    require(output == OUTPUT and os.environ.get('GITHUB_SHA') == commit and
            os.environ.get('CAR02_RELEASE_LOCK') == 'true' and
            os.environ.get('R179_DISPOSABLE_QA') == 'yes', 'ISOLATION_LOCK')
    target = Path(output)
    require(target.parent.is_dir() and not target.parent.is_symlink() and
            not target.exists() and not target.is_symlink(), 'OUTPUT_EXISTS')
    initial = snapshot(cid)
    require(all(d == hashlib.md5(b'[]').hexdigest() for d in initial.values()),
            'STARTS_EMPTY')
    ds = dates()
    day, upper = ds['valid'], ds['upper']
    a1, a2, b1 = ROLES['a1'], ROLES['a2'], ROLES['b1']
    key = 'r179_shared_request_01'
    require(booking(cid, DB, 'as', key, a1, day, '10:00') == 'CREATED', 'A_CREATED')
    require(booking(cid, DB, 'bs', key, b1, day, '10:00') == 'CREATED', 'B_CREATED')
    require(booking(cid, DB, 'as', key, a1, day, '10:00') == 'IDEMPOTENT', 'A_REPLAY')
    require(booking(cid, DB, 'bs', key, b1, day, '10:00') == 'IDEMPOTENT', 'B_REPLAY')
    bid = integer(cid, DB, 'as', "SELECT id FROM car02_r138_qa.bookings WHERE shop_code='street_house_demo' AND request_key='r179_shared_request_01';")
    require(change(cid, 'a1', 'r179_move_origin_01', bid, 'MOVE', 1, day, '11:00') == 'MOVED', 'A_MOVED')
    require(booking(cid, DB, 'as', key, a1, day, '10:00') == 'IDEMPOTENT', 'A_ORIGINAL_IDENTITY')
    witnessed, rejected = {}, {}
    def refuse(label, actor, sql):
        require(label in REASONS and label not in witnessed, 'DUPLICATE_DENIAL')
        before = snapshot(cid)
        require(psql(cid, DB, actor, sql, False, expected_error=REASONS[label]) ==
                'REJECTED', 'DENIED_' + label)
        after = snapshot(cid)
        require(before == after, 'MUTATED_' + label)
        rejected[label] = REASONS[label]
        witnessed[label] = {'before': before, 'after': after}
    refuse('moved_original_slot_replay','as',query_create(key,a1,day,'11:00'))
    refuse('moved_other_owner_replay','as',query_create(key,a2,day,'10:00'))
    refuse('moved_other_date_replay','as',query_create(key,a1,upper,'10:00'))
    refuse('other_tenant_owner','bs',query_create('r179_wrong_shop_01',a1,day,'10:00'))
    # Eight concurrent requests for the released A slot: just one creation.
    rebook = in_parallel([lambda: booking(cid, DB, 'as',
                            'r179_new_owner_slot_01', a2, day, '10:00')
                          for _ in range(8)])
    expect_results(rebook, {'CREATED': 1, 'IDEMPOTENT': 7})
    require(integer(cid, DB, 'as', f"SELECT count(*) FROM car02_r138_qa.bookings WHERE shop_code='street_house_demo' AND booking_day='{day}' AND begins_at='10:00' AND state='ACTIVE';") == 1, 'REBOOK_SLOT_UNIQUE')
    require(integer(cid, DB, 'a1', f'SELECT count(*) FROM car02_r138_qa.bookings WHERE id={bid};') == 1, 'OWNER_PRESERVED')
    require(integer(cid, DB, 'a2', f'SELECT count(*) FROM car02_r138_qa.bookings WHERE id={bid};') == 0, 'NO_OWNER_TRANSFER')
    require(change(cid, 'a1', 'r179_cancel_origin_01', bid, 'CANCEL', 2) == 'CANCELLED', 'A_CANCELLED')
    require(booking(cid, DB, 'as', key, a1, day, '10:00') == 'CANCELLED_ALREADY', 'CANCELLED_ORIGINAL')
    refuse('cancelled_other_slot_replay','as',query_create(key,a1,day,'11:00'))
    refuse('cancelled_other_owner_replay','as',query_create(key,a2,day,'10:00'))
    refuse('other_shop_changed_payload','bs',query_create(key,b1,day,'11:00'))
    refuse('foreign_direct_update','a2',"UPDATE car02_r138_qa.bookings SET state='ACTIVE';")
    require(booking(cid, DB, 'bs', key, b1, day, '10:00') == 'IDEMPOTENT', 'B_NOT_AFFECTED')
    audit = {
       'shopABooked': integer(cid, DB, 'as', "SELECT count(*) FROM car02_r138_qa.audit_events WHERE action='BOOKED';"),
       'shopBBooked': integer(cid, DB, 'bs', "SELECT count(*) FROM car02_r138_qa.audit_events WHERE action='BOOKED';"),
       'shopAMoved': integer(cid, DB, 'as', "SELECT count(*) FROM car02_r138_qa.audit_events WHERE action='MOVE';"),
       'shopACancelled': integer(cid, DB, 'as', "SELECT count(*) FROM car02_r138_qa.audit_events WHERE action='CANCEL';"),
       'shopABookingOperations': integer(cid, DB, 'as', 'SELECT count(*) FROM car02_r138_qa.booking_operations;'),
       'shopBBookingOperations': integer(cid, DB, 'bs', 'SELECT count(*) FROM car02_r138_qa.booking_operations;'),
    }
    require(audit == AUDIT, 'AUDIT_COUNTS')
    require(rejected == REASONS, 'REJECTIONS_COMPLETE')
    report = dict(LOCK, githubCommit=commit,
                  dates={'valid': day, 'upper': upper}, rejected=rejected,
                  denialSnapshots=witnessed, snapshots={'initial':initial,'final':snapshot(cid)},
                  rebookResults=sorted(rebook), audit=audit)
    report['sha256'] = sha256(report)
    save(report, target)
    print('R179_DISPOSABLE_PG17_ORIGINAL_REQUEST_IDENTITY_PASS_NO_GO_HOLD')
    return report


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--cid',required=True)
    parser.add_argument('--commit',required=True)
    parser.add_argument('--out',default=OUTPUT)
    opts=parser.parse_args()
    probe(opts.cid,opts.commit,opts.out)

if __name__ == '__main__':
    main()

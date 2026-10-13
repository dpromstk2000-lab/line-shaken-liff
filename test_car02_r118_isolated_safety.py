"""R118 synthetic-only QA; can be run locally without credentials or network.
Run: python3 test_car02_r118_isolated_safety.py --json /tmp/R118_results.json
"""
from __future__ import annotations
import argparse
import json
import multiprocessing as mp
import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from car02_r118_isolated_safety import (
    Actor, BookingSwitches, Denied, JST, assert_restored_integrity,
    connect, create_fixture_schema, quarantine_photo, read_quarantine,
    reserve_booking, review_quarantine, set_staff,
)

NOW = datetime(2026, 10, 13, 13, 0, tzinfo=JST)
T1 = 'qa_shop_a'
T2 = 'qa_shop_b'
STAFF_A = Actor(T1,'qa_staff_a','staff')
STAFF_B = Actor(T2,'qa_staff_b','staff')
OWNER_A = Actor(T1,'qa_owner_a','owner')
OWNER_B = Actor(T2,'qa_owner_b','owner')
REVIEW_A = Actor(T1,'qa_reviewer_a','reviewer')


def _booking_attempt(db_path, ready_event, slot, key, out):
    """Separate OS process with independent DB connection."""
    try:
        if not ready_event.wait(12):
            out.put(('ERROR','WORKER_EVENT_TIMEOUT')); return
        c=connect(db_path)
        try:
            ident,created=reserve_booking(c,STAFF_A,T1,'qa_bay_1',slot,key,'web',BookingSwitches(),NOW)
            out.put(('CREATED' if created else 'IDEMPOTENT',ident))
        except Denied as e:
            out.put(('DENIED',str(e)))
        finally:
            c.close()
    except BaseException as e:
        out.put(('ERROR',type(e).__name__))


class SyntheticSafetyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='car02_r118_qa_')
        self.db = Path(self.temp.name)/'disposable.sqlite3'
        self.conn = connect(self.db)
        create_fixture_schema(self.conn)

    def tearDown(self):
        self.conn.close()
        self.temp.cleanup()

    def reserve(self, slot='2026-10-14T09:30', key='qa-valid-key-001', tenant=T1,
                actor=STAFF_A, source='web', switches=BookingSwitches(),resource='qa_bay_1'):
        return reserve_booking(self.conn,actor,tenant,resource,slot,key,source,switches,NOW)

    def expect_denied(self, code, fn):
        with self.assertRaises(Denied) as cm: fn()
        self.assertEqual(str(cm.exception),code)

    def test_01_valid_half_hour_reservation_and_one_record(self):
        ident,created=self.reserve()
        self.assertTrue(created)
        self.assertTrue(ident.startswith('qa_'))
        self.assertEqual(self.conn.execute('SELECT count(*) FROM bookings').fetchone()[0],1)

    def test_02_same_request_idempotent_after_new_connection(self):
        first=self.reserve()
        self.conn.close()
        self.conn=connect(self.db)
        second=self.reserve()
        self.assertEqual(first[0],second[0])
        self.assertFalse(second[1])
        self.assertEqual(self.conn.execute('SELECT count(*) FROM bookings').fetchone()[0],1)

    def test_03_new_key_same_tenant_resource_slot_conflict(self):
        self.reserve()
        self.expect_denied('SLOT_ALREADY_RESERVED',lambda:self.reserve(key='qa-second-key-002'))

    def test_04_different_tenants_have_independent_slots(self):
        self.reserve()
        self.reserve(tenant=T2,actor=STAFF_B,key='qa-second-key-002')
        self.assertEqual(self.conn.execute('SELECT count(*) FROM bookings').fetchone()[0],2)

    def test_05_same_tenant_other_resource_independent(self):
        self.reserve()
        self.reserve(key='qa-other-resource-003',resource='qa_bay_2')
        self.assertEqual(self.conn.execute('SELECT count(*) FROM bookings').fetchone()[0],2)

    def test_06_mutated_request_payload_rejected(self):
        self.reserve()
        self.expect_denied('IDEMPOTENCY_PAYLOAD_MISMATCH',lambda:self.reserve(slot='2026-10-14T10:00'))

    def test_07_tenant_role_binding_denies_cross_tenant(self):
        self.expect_denied('TENANT_OR_ROLE_DENIED',lambda:self.reserve(tenant=T2,actor=STAFF_A))
        self.assertEqual(self.conn.execute('SELECT count(*) FROM bookings').fetchone()[0],0)

    def test_08_past_and_same_instant_fail_closed(self):
        self.expect_denied('PAST_OR_NOW',lambda:self.reserve(slot='2026-10-13T12:30'))
        self.expect_denied('PAST_OR_NOW',lambda:self.reserve(slot='2026-10-13T13:00'))

    def test_09_sunday_and_61_day_limit(self):
        self.expect_denied('CLOSED_SUNDAY',lambda:self.reserve(slot='2026-10-18T09:00'))
        self.expect_denied('OUTSIDE_BOOKING_WINDOW',lambda:self.reserve(slot='2026-12-13T09:00'))

    def test_10_valid_60_day_edge_and_out_of_hours(self):
        self.reserve(slot='2026-12-12T17:30')
        self.expect_denied('INVALID_HALF_HOUR_SLOT',lambda:self.reserve(slot='2026-10-14T17:45',key='qa-badslot-key-02'))
        self.expect_denied('INVALID_HALF_HOUR_SLOT',lambda:self.reserve(slot='2026-10-14T18:00',key='qa-badslot-key-03'))
        self.expect_denied('INVALID_HALF_HOUR_SLOT',lambda:self.reserve(slot='2026-10-14T08:30',key='qa-badslot-key-04'))

    def test_11_web_off_blocks_all_sources(self):
        for src in ('web','hp','line'):
            self.expect_denied('BOOKING_DISABLED',lambda src=src:self.reserve(
                source=src,switches=BookingSwitches(False,True,True)))

    def test_12_independent_hp_line_switches(self):
        self.expect_denied('HP_DISABLED',lambda:self.reserve(source='hp',switches=BookingSwitches(True,False,True)))
        self.expect_denied('LINE_DISABLED',lambda:self.reserve(source='line',switches=BookingSwitches(True,True,False)))
        self.reserve(source='line',switches=BookingSwitches(True,False,True))

    def test_13_invalid_request_and_source_format(self):
        self.expect_denied('BAD_IDEMPOTENCY_KEY',lambda:self.reserve(key='bad'))
        self.expect_denied('BAD_SOURCE',lambda:self.reserve(source='unknown'))
        self.expect_denied('BAD_RESOURCE',lambda:self.reserve(resource='production-bay'))

    def test_14_parallel_separate_processes_slot_uniqueness(self):
        self.conn.close()
        ctx=mp.get_context('spawn')
        ready=ctx.Event()
        out=ctx.Queue()
        proc=[ctx.Process(target=_booking_attempt,args=(str(self.db),ready,'2026-10-14T09:30',f'qa-race-key-00{i}',out)) for i in range(6)]
        for p in proc: p.start()
        ready.set()
        received=[out.get(timeout=25) for _ in proc]
        for p in proc:
            p.join(timeout=25)
            self.assertEqual(p.exitcode,0)
        self.assertEqual(len([x for x in received if x[0]=='CREATED']),1,received)
        self.assertEqual(len([x for x in received if x==('DENIED','SLOT_ALREADY_RESERVED')]),5,received)
        self.conn=connect(self.db)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM bookings').fetchone()[0],1)

    def test_15_parallel_same_request_key_idempotency(self):
        self.conn.close()
        ctx=mp.get_context('spawn')
        ready=ctx.Event(); out=ctx.Queue()
        proc=[ctx.Process(target=_booking_attempt,args=(str(self.db),ready,'2026-10-14T11:30','qa-allsame-key-01',out)) for _ in range(5)]
        for p in proc:p.start()
        ready.set()
        received=[out.get(timeout=25) for _ in proc]
        for p in proc:
            p.join(timeout=25);self.assertEqual(p.exitcode,0)
        self.assertEqual(len([x for x in received if x[0]=='CREATED']),1,received)
        self.assertEqual(len([x for x in received if x[0]=='IDEMPOTENT']),4,received)
        self.assertEqual(len(set(x[1] for x in received)),1,received)
        self.conn=connect(self.db)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM bookings').fetchone()[0],1)

    def test_16_quarantine_persists_after_reopening(self):
        ident,created=quarantine_photo(self.conn,STAFF_A,T1,'qa_photo_abcdef1234','qa_objects/photo_a_123456','qa-photo-key-001')
        self.assertTrue(created)
        self.conn.close();self.conn=connect(self.db)
        self.assertIn((ident,'QUARANTINED'),read_quarantine(self.conn,REVIEW_A,T1))
        self.assertEqual(quarantine_photo(self.conn,STAFF_A,T1,'qa_photo_abcdef1234','qa_objects/photo_a_123456','qa-photo-key-001'),(ident,False))

    def test_17_quarantine_no_reuse_and_collision_safe(self):
        quarantine_photo(self.conn,STAFF_A,T1,'qa_photo_abcdef1234','qa_objects/photo_a_123456','qa-photo-key-001')
        self.expect_denied('OBJECT_KEY_ALREADY_RESERVED',lambda:quarantine_photo(
            self.conn,STAFF_A,T1,'qa_photo_zyxwvu1234','qa_objects/photo_a_123456','qa-photo-key-002'))
        self.expect_denied('QUARANTINE_REQUEST_MISMATCH',lambda:quarantine_photo(
            self.conn,STAFF_A,T1,'qa_photo_abcdef1234','qa_objects/photo_b_123456','qa-photo-key-001'))

    def test_18_quarantine_cross_tenant_hidden(self):
        ident,_=quarantine_photo(self.conn,STAFF_A,T1,'qa_photo_abcdef1234','qa_objects/photo_a_123456','qa-photo-key-001')
        self.assertEqual(read_quarantine(self.conn,OWNER_B,T2),[])
        self.expect_denied('TENANT_OR_ROLE_DENIED',lambda:read_quarantine(self.conn,OWNER_A,T2))
        self.expect_denied('QUARANTINE_NOT_FOUND_IN_TENANT',lambda:review_quarantine(self.conn,OWNER_B,T2,ident,'EVIDENCE_SEEN'))

    def test_19_review_events_never_grant_delete(self):
        ident,_=quarantine_photo(self.conn,STAFF_A,T1,'qa_photo_abcdef1234','qa_objects/photo_a_123456','qa-photo-key-001')
        review_quarantine(self.conn,REVIEW_A,T1,ident,'EVIDENCE_SEEN')
        review_quarantine(self.conn,REVIEW_A,T1,ident,'ESCALATE_ONLY')
        self.expect_denied('DELETION_APPROVAL_UNSUPPORTED',lambda:review_quarantine(self.conn,REVIEW_A,T1,ident,'APPROVE_DELETE'))
        self.assertEqual(self.conn.execute('SELECT state FROM photo_quarantine WHERE id=?',(ident,)).fetchone()[0],'QUARANTINED')

    def test_20_sqlite_fixture_blocks_accidental_photo_update_delete(self):
        ident,_=quarantine_photo(self.conn,STAFF_A,T1,'qa_photo_abcdef1234','qa_objects/photo_a_123456','qa-photo-key-001')
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute('UPDATE photo_quarantine SET state=? WHERE id=?',('QUARANTINED',ident))
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute('DELETE FROM photo_quarantine WHERE id=?',(ident,))
        self.assertEqual(self.conn.execute('SELECT count(*) FROM photo_quarantine').fetchone()[0],1)

    def test_21_review_append_only_and_scoped(self):
        ident,_=quarantine_photo(self.conn,STAFF_A,T1,'qa_photo_abcdef1234','qa_objects/photo_a_123456','qa-photo-key-001')
        eid=review_quarantine(self.conn,REVIEW_A,T1,ident,'ESCALATE_ONLY')
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute('DELETE FROM review_events WHERE id=?',(eid,))
        self.expect_denied('TENANT_OR_ROLE_DENIED',lambda:review_quarantine(self.conn,REVIEW_A,T2,ident,'ESCALATE_ONLY'))

    def seed_owners(self):
        self.conn.executemany('INSERT INTO staff_roles VALUES (?,?,?,?)',[(T1,'qa_owner_a','owner',1),
            (T1,'qa_owner_c','owner',1),(T1,'qa_staff_a','staff',1),(T2,'qa_owner_b','owner',1)])

    def test_22_owner_only_privilege_and_self_protection(self):
        self.seed_owners()
        self.expect_denied('TENANT_OR_ROLE_DENIED',lambda:set_staff(self.conn,STAFF_A,T1,'qa_owner_c','staff',True))
        self.expect_denied('SELF_ROLE_CHANGE_DENIED',lambda:set_staff(self.conn,OWNER_A,T1,'qa_owner_a','staff',True))
        set_staff(self.conn,OWNER_A,T1,'qa_staff_a','staff',False)
        self.assertEqual(self.conn.execute('SELECT active FROM staff_roles WHERE tenant=? AND staff_id=?',(T1,'qa_staff_a')).fetchone()[0],0)

    def test_23_last_owner_protected_after_demotion(self):
        self.seed_owners()
        set_staff(self.conn,OWNER_A,T1,'qa_owner_c','staff',True)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM staff_roles WHERE tenant=? AND role=? AND active=1',(T1,'owner')).fetchone()[0],1)
        self.expect_denied('SELF_ROLE_CHANGE_DENIED',lambda:set_staff(self.conn,OWNER_A,T1,'qa_owner_a','staff',True))
        self.expect_denied('OWNER_AUTHORIZATION_RECHECK_FAILED',lambda:set_staff(self.conn,Actor(T1,'qa_owner_c','owner'),T1,'qa_owner_a','staff',True))

    def test_24_privilege_cross_tenant_denied(self):
        self.seed_owners()
        self.expect_denied('TENANT_OR_ROLE_DENIED',lambda:set_staff(self.conn,OWNER_A,T2,'qa_owner_b','staff',False))
        self.expect_denied('TARGET_NOT_FOUND',lambda:set_staff(self.conn,OWNER_A,T1,'qa_owner_b','staff',False))

    def test_25_disposable_backup_independent_restore_and_corruption_detection(self):
        self.seed_owners()
        self.reserve()
        ident,_=quarantine_photo(self.conn,STAFF_A,T1,'qa_photo_abcdef1234','qa_objects/photo_a_123456','qa-photo-key-001')
        review_quarantine(self.conn,REVIEW_A,T1,ident,'ESCALATE_ONLY')
        backup=Path(self.temp.name)/'isolated_backup.sqlite3'
        dest=sqlite3.connect(str(backup))
        self.conn.backup(dest);dest.close()
        restored=Path(self.temp.name)/'independent_restored.sqlite3'
        restored.write_bytes(backup.read_bytes())
        counts=assert_restored_integrity(restored)
        self.assertEqual(counts,{'bookings':1,'photo_quarantine':1,'review_events':1,'staff_roles':4})
        corrupt=Path(self.temp.name)/'corrupted.sqlite3'
        corrupt.write_bytes(backup.read_bytes())
        with open(corrupt,'r+b') as handle:
            handle.seek(0);handle.write(b'BROKEN_HEADER_SAFETY_QA')
        self.expect_denied('SYNTHETIC_RESTORE_CORRUPT',lambda:assert_restored_integrity(corrupt))

    def test_26_recovered_triggers_remain_enabled(self):
        quarantine_photo(self.conn,STAFF_A,T1,'qa_photo_abcdef1234','qa_objects/photo_a_123456','qa-photo-key-001')
        restored=Path(self.temp.name)/'restored.sqlite3'
        dest=sqlite3.connect(str(restored));self.conn.backup(dest);dest.close()
        r=connect(restored)
        with self.assertRaises(sqlite3.IntegrityError):
            r.execute('DELETE FROM photo_quarantine')
        r.close()

    def test_27_no_external_secret_or_real_customer_fixture(self):
        tables=('bookings','photo_quarantine','review_events','staff_roles')
        for tbl in tables:
            self.assertEqual(self.conn.execute(f'SELECT count(*) FROM {tbl}').fetchone()[0],0)
        self.expect_denied('INVALID_TENANT',lambda:self.reserve(tenant='customer-shop',actor=STAFF_A))


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--json',default='')
    args=parser.parse_args()
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(SyntheticSafetyTest)
    runner=unittest.TextTestRunner(verbosity=2)
    result=runner.run(suite)
    record={'schema':'DPRO_CAR02_R118_SYNTHETIC_QA_V1',
            'mode':'DISPOSABLE_SQLITE_OFFLINE_ONLY',
            'testCount':result.testsRun,'failures':len(result.failures),
            'errors':len(result.errors),'skipped':len(result.skipped),
            'passed':result.wasSuccessful(),'productionReady':False,
            'releaseDecision':'NO_GO','migrationDecision':'HOLD',
            'notProven':['real Supabase/PostgreSQL concurrency',
                         'actual owner identity or RLS','Storage bucket write/delete semantics',
                         'live backup/restore','production reservation pipeline',
                         'customer consent or LINE linkage']}
    if args.json:
        out=Path(args.json)
        out.parent.mkdir(parents=True,exist_ok=True)
        out.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('R118_OFFLINE_SYNTHETIC_{}_{}TESTS'.format('PASS' if result.wasSuccessful() else 'FAIL',result.testsRun))
    return 0 if result.wasSuccessful() else 1


if __name__=='__main__':
    raise SystemExit(main())

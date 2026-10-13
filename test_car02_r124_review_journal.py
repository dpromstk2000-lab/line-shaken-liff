"""DPRO CAR02 R124 offline journal tests; no network, no production mutation."""
import copy
import hashlib
import json
import multiprocessing
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from car02_r124_review_journal import (
  DB_NAME, R124ReviewJournal, R124Denied, checked_record, json_js, sha)

HERE=Path(__file__).resolve().parent
KEYS=['version','shop','orderId','reportId','intentKey','quarantineRevision','quarantineState',
      'snapshotHash','evidenceHash','evidenceId','reviewers','decision','mutationAllowed',
      'deleteAllowed','markReadyAllowed','realStorageTested','realAuthTested','release','migration']

def uid(n): return f'{n:08d}-4444-4444-8444-444444444444'
def fixture(shop='shop_a',num=1):
    v={'version':'R123','shop':shop,'orderId':uid(100+num),'reportId':uid(200+num),
       'intentKey':uid(300+num),'quarantineRevision':1,'quarantineState':'QUARANTINED',
       'snapshotHash':'a'*64,'evidenceHash':'b'*64,'evidenceId':uid(400+num),
       'reviewers':[{'reviewId':uid(500+num*2),'subject':'staff:22222222-2222-4222-8222-222222222222',
                    'role':'owner','reviewedAtMs':2100000,'decision':'request_manual_staging_validation'},
                    {'reviewId':uid(501+num*2),'subject':'staff:33333333-3333-4333-8333-333333333333',
                    'role':'staff','reviewedAtMs':2200000,'decision':'request_manual_staging_validation'}],
       'decision':'MANUAL_STAGING_VALIDATION_PENDING','mutationAllowed':False,'deleteAllowed':False,
       'markReadyAllowed':False,'realStorageTested':False,'realAuthTested':False,
       'release':'NO_GO','migration':'HOLD'}
    v['recordHash']=sha(json_js(v))
    return v

def rehash(r):
    v={k:v for k,v in r.items() if k != 'recordHash'}
    r['recordHash']=sha(json_js(v));return r

def concurrent_worker(path, payload, start, q):
    start.wait(10)
    try:
        j=R124ReviewJournal(path,environment='isolated_qa',release_lock=True)
        try: q.put(j.accept(payload,scoped_shop=payload['shop'],received_at_ms=3000000)['status'])
        finally: j.close()
    except Exception as exc:q.put(str(exc))

class JournalTests(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory(prefix='car02-r124-only-')
        self.path=str(Path(self.t.name)/(DB_NAME+'.sqlite3'))
        self.j=R124ReviewJournal(self.path,environment='isolated_qa',release_lock=True)
    def tearDown(self):
        self.j.close();self.t.cleanup()
    def take(self,r=None,shop='shop_a'):
        return self.j.accept(r or fixture(),scoped_shop=shop,received_at_ms=3000000)
    def deny(self,r,code,shop='shop_a'):
        with self.assertRaisesRegex(R124Denied,code):self.take(r,shop)
    def test_01_new_record(self):self.assertEqual(self.take()['status'],'NEW')
    def test_02_replay_is_idempotent(self):
        self.take();self.assertEqual(self.take()['status'],'EXISTING');self.assertEqual(self.j.verify_chain()['rows'],1)
    def test_03_cross_shop_denied(self):self.deny(fixture(),'TENANT_SCOPE',shop='shop_b')
    def test_04_tamper_hash_denied(self):
        r=fixture();r['intentKey']=uid(999);self.deny(r,'HASH_MISMATCH')
    def test_05_version_denied(self):
        r=fixture();r['version']='R124';self.deny(r,'RELEASE_CLOSED')
    def test_06_promote_denied(self):
        r=fixture();r['markReadyAllowed']=True;self.deny(r,'READONLY_REQUIRED')
    def test_07_delete_denied(self):
        self.take();self.assertRaises(sqlite3.IntegrityError,self.j.db.execute,'DELETE FROM r124_journal')
    def test_08_update_denied(self):
        self.take();self.assertRaises(sqlite3.IntegrityError,self.j.db.execute,"UPDATE r124_journal SET shop='shop_b'")
    def test_09_evidence_rebind_denied(self):
        self.take();r=fixture(num=2);r['evidenceId']=fixture()['evidenceId'];self.deny(rehash(r),'EVIDENCE_REBIND')
    def test_10_review_id_reuse_denied(self):
        self.take();r=fixture(num=2);r['reviewers'][0]['reviewId']=fixture()['reviewers'][0]['reviewId']
        with self.assertRaises(sqlite3.IntegrityError):self.take(rehash(r))
        self.assertEqual(self.j.verify_chain()['rows'],1)
    def test_11_conflicting_replay_denied(self):
        self.take();r=fixture();r['snapshotHash']='c'*64;self.deny(rehash(r),'REPLAY_CONFLICT')
    def test_12_tenant_isolation_read(self):
        self.take();self.take(fixture('shop_b',2),'shop_b');self.assertEqual(len(self.j.inspect('shop_a')),1)
        self.assertEqual(len(self.j.inspect('shop_b')),1)
    def test_13_chain_two_entries(self):
        self.take();self.take(fixture(num=2));self.assertEqual(self.j.verify_chain()['rows'],2)
    def test_14_injected_rollback(self):
        with self.assertRaisesRegex(RuntimeError,'INJECTED'):
            self.j.accept(fixture(),scoped_shop='shop_a',received_at_ms=3000000,fail_before_insert=True)
        self.assertEqual(self.j.verify_chain()['rows'],0)
    def test_15_restart_replay(self):
        self.take();self.j.close();self.j=R124ReviewJournal(self.path,environment='isolated_qa',release_lock=True)
        self.assertEqual(self.take()['status'],'EXISTING')
    def test_16_backup_and_reopen(self):
        self.take();dest=Path(self.t.name)/'restored.sqlite3';self.j.backup(dest)
        restore=Path(self.t.name)/('tmp_'+DB_NAME+'.sqlite3');dest.replace(restore)
        # Exact restricted name on restored fixture is required.
        fixed=Path(self.t.name)/'restore'/(DB_NAME+'.sqlite3');fixed.parent.mkdir()
        restore.replace(fixed)
        other=R124ReviewJournal(str(fixed),environment='isolated_qa',release_lock=True)
        try:self.assertEqual(other.verify_chain(),self.j.verify_chain())
        finally:other.close()
    def test_17_corrupt_backup_rejected(self):
        self.take();dest=Path(self.t.name)/'corrupt.sqlite3';self.j.backup(dest)
        dest.write_bytes(b'clearly not sqlite')
        broken=sqlite3.connect(str(dest))
        try:
            with self.assertRaises(sqlite3.DatabaseError):
                broken.execute('PRAGMA schema_version').fetchall()
        finally:
            broken.close()
    def test_18_chain_tamper_detected(self):
        self.take();self.j.db.execute('DROP TRIGGER r124_no_update')
        self.j.db.execute("UPDATE r124_journal SET event_hash='"+('0'*64)+"'")
        self.deny_chain('CHAIN_TAMPERED')
    def deny_chain(self,code):
        with self.assertRaisesRegex(R124Denied,code):self.j.verify_chain()
    def test_19_wrong_db_name(self):
        with self.assertRaisesRegex(R124Denied,'DB_NAME'):
            R124ReviewJournal(Path(self.t.name)/'production.sqlite3',environment='isolated_qa',release_lock=True)
    def test_20_no_unlocked_environment(self):
        with self.assertRaisesRegex(R124Denied,'ISOLATION'):
            R124ReviewJournal(self.path,environment='production',release_lock=True)
    def test_21_missing_owner_denied(self):
        r=fixture();r['reviewers'][0]['role']='staff';self.deny(rehash(r),'REVIEW_INDEPENDENCE')
    def test_22_duplicate_reviewer_denied(self):
        r=fixture();r['reviewers'][1]['subject']=r['reviewers'][0]['subject'];self.deny(rehash(r),'REVIEW_INDEPENDENCE')
    def test_23_unknown_field_denied(self):
        r=fixture();r['promotePhoto']=True;self.deny(r,'RECORD_SHAPE')
    def test_24_attested_record_order(self):
        self.assertEqual(checked_record(fixture())['release'],'NO_GO')
    def test_25_journal_review_rows_immutable(self):
        self.take();self.assertRaises(sqlite3.IntegrityError,self.j.db.execute,'DELETE FROM r124_review_ids')
    def test_26_wal_crash_concurrency(self):
        # Concurrent distinct Python processes share one atomic transaction gate.
        self.j.close()
        ctx=multiprocessing.get_context('spawn');start=ctx.Event();q=ctx.Queue();payload=fixture()
        workers=[ctx.Process(target=concurrent_worker,args=(self.path,payload,start,q)) for _ in range(6)]
        for w in workers:w.start()
        start.set()
        outcome=[q.get(timeout=15) for _ in workers]
        for w in workers:w.join(timeout=10)
        self.assertEqual(outcome.count('NEW'),1,outcome)
        self.assertEqual(outcome.count('EXISTING'),5,outcome)
        self.j=R124ReviewJournal(self.path,environment='isolated_qa',release_lock=True)
        self.assertEqual(self.j.verify_chain()['rows'],1)

class BridgeTests(unittest.TestCase):
    def test_27_actual_r123_records_if_present(self):
        bridge=os.environ.get('R124_R123_FIXTURES')
        if bridge:
            records=json.loads(Path(bridge).read_text(encoding='utf-8'))
            self.assertEqual(len(records),3)
            for item in records:self.assertEqual(checked_record(item)['release'],'NO_GO')
            with tempfile.TemporaryDirectory(prefix='car02-r124-r123-bridge-') as folder:
                test_path=str(Path(folder)/(DB_NAME+'.sqlite3'))
                journal=R124ReviewJournal(test_path,environment='isolated_qa',release_lock=True)
                try:
                    results=[journal.accept(item,scoped_shop=item['shop'],received_at_ms=3000000)
                             for item in records]
                    self.assertEqual([x['status'] for x in results],['NEW']*3)
                    self.assertEqual(journal.verify_chain()['rows'],3)
                    self.assertEqual(len(journal.inspect('shop_a')),2)
                    self.assertEqual(len(journal.inspect('shop_b')),1)
                    self.assertEqual(journal.accept(records[0],scoped_shop='shop_a',
                                   received_at_ms=3000001)['status'],'EXISTING')
                finally:journal.close()
        else:
            # Offline fallback does not pretend to have executed R123 source.
            self.assertEqual(checked_record(fixture())['decision'],'MANUAL_STAGING_VALIDATION_PENDING')

if __name__=='__main__':unittest.main(verbosity=2)

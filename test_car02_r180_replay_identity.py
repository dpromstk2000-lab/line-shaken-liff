#!/usr/bin/env python3
"""R180 offline fail-closed proof tests and actual JSON disk roundtrip for R179."""
import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

import car02_r179_replay_identity_isolated as r

COMMIT = 'f'*40
EMPTY = hashlib.md5(b'[]').hexdigest()
FINAL = hashlib.md5(b'synthetic case data').hexdigest()


def sample():
    initial = dict.fromkeys(r.TABLES, EMPTY)
    final = dict.fromkeys(r.TABLES, FINAL)
    report = dict(r.LOCK, githubCommit=COMMIT,
        dates={'valid':'2026-11-02','upper':'2026-12-12'},
        rejected=dict(r.REASONS),
        denialSnapshots={k:{'before':dict(initial),'after':dict(initial)} for k in r.REASONS},
        snapshots={'initial':initial,'final':final},
        rebookResults=['CREATED']+['IDEMPOTENT']*7, audit=dict(r.AUDIT))
    report['sha256'] = r.sha256(report)
    return report


def reseal(doc):
    doc['sha256'] = r.sha256(doc)
    return doc


class R180Tests(unittest.TestCase):
    def reject(self, doc, *, reseal_first=True):
        if reseal_first: reseal(doc)
        with self.assertRaises(r.IdentityError):r.verify_report(doc)
    def test_valid_report(self):self.assertTrue(r.verify_report(sample()))
    def test_rebook_permutation_valid(self):
        d=sample(); d['rebookResults']=['IDEMPOTENT']*7+['CREATED']; self.assertTrue(r.verify_report(reseal(d)))
    def test_date_order(self):
        d=sample();d['dates']['upper']='2026-11-02';self.reject(d)
    def test_sunday_valid(self):
        d=sample();d['dates']['valid']='2026-11-01';self.reject(d)
    def test_sunday_upper(self):
        d=sample();d['dates']['upper']='2026-12-13';self.reject(d)
    def test_invalid_date(self):
        d=sample();d['dates']['valid']='no-date';self.reject(d)
    def test_missing_date(self):
        d=sample();del d['dates']['upper'];self.reject(d)
    def test_unknown_date(self):
        d=sample();d['dates']['other']='2026-11-05';self.reject(d)
    def test_wrong_commit(self):
        d=sample();d['githubCommit']='Z'*40;self.reject(d)
    def test_commit_missing(self):
        d=sample();d['githubCommit']='';self.reject(d)
    def test_extra_field(self):
        d=sample();d['productionGo']=True;self.reject(d)
    def test_missing_denial(self):
        d=sample();d['rejected'].pop('other_shop_changed_payload');self.reject(d)
    def test_wrong_denial(self):
        d=sample();d['rejected']['moved_original_slot_replay']='R138_ACCEPTED';self.reject(d)
    def test_missing_snapshot(self):
        d=sample();d['denialSnapshots'].pop('moved_other_date_replay');self.reject(d)
    def test_witness_missing_before(self):
        d=sample();del d['denialSnapshots']['other_tenant_owner']['before'];self.reject(d)
    def test_witness_missing_table(self):
        d=sample();d['denialSnapshots']['other_tenant_owner']['before'].pop('audit_events');self.reject(d)
    def test_witness_after_mutated(self):
        d=sample();d['denialSnapshots']['other_tenant_owner']['after']['bookings']='0'*32;self.reject(d)
    def test_witness_hash_wrong_length(self):
        d=sample();d['denialSnapshots']['other_tenant_owner']['after']['bookings']='b'*31;self.reject(d)
    def test_witness_hash_nonhex(self):
        d=sample();d['denialSnapshots']['other_tenant_owner']['after']['bookings']='z'*32;self.reject(d)
    def test_rebook_double_winner(self):
        d=sample();d['rebookResults']=['CREATED']*2+['IDEMPOTENT']*6
        with self.assertRaises(AssertionError):r.verify_report(reseal(d))
    def test_rebook_none_wins(self):
        d=sample();d['rebookResults']=['IDEMPOTENT']*8
        with self.assertRaises(AssertionError):r.verify_report(reseal(d))
    def test_no_business_changes(self):
        d=sample();d['snapshots']['final']=dict(d['snapshots']['initial']);self.reject(d)
    def test_wrong_audit(self):
        d=sample();d['audit']['shopABooked']=3;self.reject(d)
    def test_audit_boolean(self):
        d=sample();d['audit']['shopAMoved']=True;self.reject(d)
    def test_hash_missing(self):
        d=sample();del d['sha256'];self.reject(d,reseal_first=False)
    def test_hash_forged(self):
        d=sample();d['sha256']='0'*64;self.reject(d,reseal_first=False)
    def test_real_temp_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'proof.json';r.save(sample(),p)
            self.assertTrue(r.verify_report(json.loads(p.read_text(encoding='ascii'))))
    def test_existing_output_cannot_overwrite(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'proof.json';r.save(sample(),p)
            with self.assertRaises(r.IdentityError):r.save(sample(),p)
    def test_missing_parent_cannot_create(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.IdentityError):r.save(sample(),Path(td)/'none'/'proof.json')
    def test_symlink_is_refused(self):
        with tempfile.TemporaryDirectory() as td:
            original=Path(td)/'original.json';original.write_text('safe')
            link=Path(td)/'link.json';link.symlink_to(original)
            with self.assertRaises(r.IdentityError):r.save(sample(),link)
            self.assertEqual(original.read_text(),'safe')
    def test_wrong_output_blocked_before_db(self):
        with self.assertRaises(r.IdentityError):r.probe('a'*12,COMMIT,'/tmp/unsafe.json')
    def test_missing_hold_flag_before_db(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R179_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.IdentityError):r.probe('a'*12,COMMIT)
    def test_bad_container_before_db(self):
        with self.assertRaises(r.IdentityError):r.probe('production',COMMIT)
    def test_new_proof_has_exact_lock(self):
        self.assertEqual(sample()['realWorldGatesOpen'],12)
        self.assertEqual(sample()['release'],'NO_GO')
        self.assertEqual(sample()['migration'],'HOLD')
    def test_r138_helper_is_not_modified(self):
        text=Path('car02_r138_pg17_lifecycle_qa.py').read_text()
        self.assertIn("'BAD_LITERAL'",text)
    def test_reasons_are_explicit(self):
        self.assertEqual(set(sample()['denialSnapshots']),set(r.REASONS))


def bad_case(key,value):
    def check(self):
        d=sample();d[key]=value;self.reject(d)
    return check

BAD={
    'version':'R999', 'mode':'PRODUCTION', 'release':'GO', 'migration':'READY',
    'realWorldGatesOpen':0,'syntheticOnly':False,'productionTouched':True,
    'productionAuthorized':True,'realAuthenticationVerified':True,
    'realRLSVerified':True,'externalWitnessVerified':True,
    'externalSignatureVerified':True,'independentProductionTest':True,
    'sourceR138BUnchanged':False,'sourceR159Unchanged':False,
    'sourceR171Unchanged':False,'sourceR175Unchanged':False,
    'syntheticDb':'production','fixtureRoles':0,
    'originalRequestNeverRebound':False,'crossShopSameKeyIndependent':False,
    'releasedSlotConcurrentSingleBooking':False,'fiveTableDeniedMutationCheck':False,
    'auditExactlyOnce':False,
}
for key,value in BAD.items():
    setattr(R180Tests,'test_reject_lock_'+key,bad_case(key,value))

if __name__=='__main__':unittest.main()

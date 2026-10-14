#!/usr/bin/env python3
"""R176: offline negative contract, boundary date and real file I/O tests for R175."""
import copy
from datetime import date,timedelta
import hashlib,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import car02_r175_booking_boundary_isolated as r
COMMIT='b'*40

def sample():
    d=r.dates(date(2026,10,14));md5=hashlib.md5(b'[]').hexdigest()
    snap={t:md5 for t in r.TABLES}
    out=dict(r.LOCK,githubCommit=COMMIT,rejected=dict(r.EXPECTED),dates=d,
        snapshots={key:{'before':dict(snap),'after':dict(snap)} for key in r.EXPECTED},
        audit={'BOOKED':2,'MOVE':1,'CANCEL':1,'bookingOperations':2})
    out['sha256']=r.seal(out)
    return out

def reseal(d):d['sha256']=r.seal(d);return d

class R176(unittest.TestCase):
    def reject(self,d):
        with self.assertRaises(r.BoundaryError):r.verify_report(reseal(d))
    def test_valid(self):self.assertTrue(r.verify_report(sample()))
    def test_bad_commit(self):d=sample();d['githubCommit']='F'*40;self.reject(d)
    def test_invalid_snapshot_shape(self):d=sample();d['snapshots']['seconds']['before'].pop('audit_events');self.reject(d)
    def test_invalid_snapshot_digest(self):d=sample();d['snapshots']['seconds']['before']['bookings']='G'*32;self.reject(d)
    def test_snapshot_changed(self):d=sample();d['snapshots']['sunday']['after']['bookings']='0'*32;self.reject(d)
    def test_extra_witness(self):d=sample();d['snapshots']['FAKE']={};self.reject(d)
    def test_missing_witness(self):d=sample();d['snapshots'].pop('past_date');self.reject(d)
    def test_unknown_rejection(self):d=sample();d['rejected']['past_date']='OTHER';self.reject(d)
    def test_missing_rejection(self):d=sample();d['rejected'].pop('sunday');self.reject(d)
    def test_false_audit(self):d=sample();d['audit']['BOOKED']=3;self.reject(d)
    def test_missing_audit(self):d=sample();d['audit'].pop('MOVE');self.reject(d)
    def test_missing_hash(self):d=sample();d.pop('sha256');self.assertRaises(r.BoundaryError,r.verify_report,d)
    def test_corrupt_hash(self):d=sample();d['sha256']='0'*64;self.assertRaises(r.BoundaryError,r.verify_report,d)
    def test_bool_gate(self):d=sample();d['realWorldGatesOpen']=True;self.reject(d)
    def test_sunday_not_sunday(self):d=sample();d['dates']['sunday']='2026-10-19';self.reject(d)
    def test_upper_before_valid(self):d=sample();d['dates']['upper']=d['dates']['valid'];self.reject(d)
    def test_date_not_iso(self):d=sample();d['dates']['valid']='never';self.reject(d)
    def test_date_missing(self):d=sample();d['dates'].pop('past');self.reject(d)
    def test_date_non_string(self):d=sample();d['dates']['upper']=2026;self.reject(d)
    def test_boundary_date_generator(self):
        for today in (date(2026,10,14),date(2026,10,18),date(2027,1,1),date(2028,2,29)):
            d=r.dates(today)
            self.assertEqual(len(d),5)
            self.assertEqual(date.fromisoformat(d['sunday']).isoweekday(),7)
            self.assertTrue(14 <= (date.fromisoformat(d['valid'])-today).days < 30)
            self.assertTrue(58 <= (date.fromisoformat(d['upper'])-today).days <= 60)
            self.assertEqual((date.fromisoformat(d['too_late'])-today).days,61)
    def test_date_type_rejected(self):
        with self.assertRaises(r.BoundaryError):r.dates('today')
    def test_sql_builder_valid(self):
        q=r.query_create('r175_valid_token', 'car02_r138_a_one_ci', '2026-11-01','09:00')
        self.assertTrue(q.startswith('SELECT car02_r138_qa.claim_booking('))
        self.assertTrue(q.endswith(');'))
    def test_sql_builder_injection(self):
        with self.assertRaises(AssertionError):r.query_create('r175_inject', 'anything', '2026-11-01',"09:00'; DROP TABLE")
    def test_move_negative_ver(self):
        with self.assertRaises(r.BoundaryError):r.query_move('r175_move',1,'MOVE',0,'2026-11-01','10:00')
    def test_move_invalid_bid(self):
        with self.assertRaises(r.BoundaryError):r.query_move('r175_move',True,'MOVE',1,'2026-11-01','10:00')
    def test_cancel_null_payload(self):
        q=r.query_move('r175_cancel_valid',12,'CANCEL',3)
        self.assertTrue(q.endswith(',NULL,NULL);'))
    def test_snapshot_empty(self):
        with self.assertRaises(r.BoundaryError):r.strict_snapshot({})
    def test_real_output_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'result.json';r.save(sample(),p)
            self.assertEqual(json.loads(p.read_text()),sample())
            with self.assertRaises(r.BoundaryError):r.save(sample(),p)
    def test_output_missing_parent(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.BoundaryError):r.save(sample(),Path(td)/'missing'/'out.json')
    def test_output_symlink(self):
        with tempfile.TemporaryDirectory() as td:
            dest=Path(td)/'dest';dest.write_text('keep')
            ln=Path(td)/'link';ln.symlink_to(dest)
            with self.assertRaises(r.BoundaryError):r.save(sample(),ln)
            self.assertEqual(dest.read_text(),'keep')
    def test_no_prod_env(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R175_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.BoundaryError):r.probe('a'*12,COMMIT)
    def test_disallow_other_output(self):
        with self.assertRaises(r.BoundaryError):r.probe('a'*12,COMMIT,'/tmp/forbidden')
    def test_bad_container(self):
        with self.assertRaises(r.BoundaryError):r.probe('production',COMMIT)


def gate_test(field,bad):
    def run(self):
        d=sample();d[field]=bad;self.reject(d)
    return run

for k,v in {'version':'R999','mode':'PRODUCTION','release':'GO','migration':'READY',
            'realWorldGatesOpen':11,'syntheticOnly':False,'productionTouched':True,
            'productionAuthorized':True,'realAuthenticationVerified':True,
            'realRLSVerified':True,'externalWitnessVerified':True,
            'externalSignatureVerified':True,'independentProductionTest':True,
            'sourceR138BUnchanged':False,'sourceR171Unchanged':False,
            'syntheticDb':'real_db','fixtureRoles':4,'fiveTableNoMutationVerified':False,
            'jstDateWindowsVerified':False,'thirtyMinuteRuleVerified':False,
            'replayOwnershipVerified':False,'auditExactlyOnceVerified':False}.items():
    setattr(R176,'test_gate_'+k,gate_test(k,v))

for i,(k,expected) in enumerate(r.EXPECTED.items()):
    def wrong(self,k=k):
        d=sample();d['rejected'][k]='WRONG';self.reject(d)
    setattr(R176,f'test_rejection_{i:02d}_{k}',wrong)

if __name__=='__main__':unittest.main()

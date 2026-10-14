#!/usr/bin/env python3
"""CAR02 R141 independent audit/tamper tests, synthetic only."""
import copy
from datetime import datetime
import os
import unittest
from zoneinfo import ZoneInfo
from car02_r140_auth_boundary_isolated import SyntheticBoundary, mint_fixture, SCOPES
from car02_r141_independent_audit_isolated import attest, compare, AuditFailure
from test_car02_r140_auth_boundary import request, NOW, TENANT_A, TENANT_B

class Reconciliation(unittest.TestCase):
    def setUp(self):
        os.environ['CAR02_RELEASE_LOCK']='true';os.environ['R140_SYNTHETIC_QA']='yes'
        self.s=SyntheticBoundary(NOW)
        sc=sorted(SCOPES)
        self.staff=mint_fixture(sub='staff_AAA',tenant=TENANT_A,role='STAFF',scopes=sc,now_sec=NOW)
        self.customer=mint_fixture(sub='cust_AAA',tenant=TENANT_A,role='CUSTOMER',scopes=sc,now_sec=NOW)
        self.bstaff=mint_fixture(sub='staff_BBB',tenant=TENANT_B,role='STAFF',scopes=sc,now_sec=NOW)
        self._seed()

    def _seed(self):
        self.b=self.s.execute(self.staff,request('BOOK'))['bookingId']
        self.c=self.s.execute(self.staff,request('OPEN_CASE','command_open_001',1,booking=self.b))['caseId']
        self.s.execute(self.staff,request('REPORT','command_report_001',1,case=self.c))
        self.s.execute(self.staff,request('QUOTE','command_quote_001',2,case=self.c))
        self.s.execute(self.customer,request('DECIDE','command_decide_001',3,case=self.c))
        self.s.execute(self.staff,request('COMPLETE','command_complete_001',4,case=self.c))
        # Different shop / same 09:00 slot is allowed
        self.s.execute(self.bstaff,request('BOOK','command_book_002',tenant=TENANT_B,
                                data={'ownerId':'cust_BBB','date':'2026-10-19','time':'09:00'}))

    def attest(self):return attest(self.s.state_snapshot())
    def mutated(self,modify,reason):
        state=self.s.state_snapshot();modify(state)
        with self.assertRaises(AuditFailure) as e:attest(state)
        self.assertEqual(str(e.exception),'R141_'+reason)

    def test_01_two_shops_independent(self):
        p=self.attest();self.assertEqual(set(p['tenants']),{TENANT_A,TENANT_B})
        self.assertEqual(p['tenants'][TENANT_A]['counts']['operations'],6)
        self.assertEqual(p['tenants'][TENANT_B]['counts']['bookings'],1)
        self.assertEqual(p['release'],'NO_GO');self.assertEqual(p['migration'],'HOLD')
    def test_02_snapshot_parity(self):
        p=self.attest();self.assertTrue(compare(p,copy.deepcopy(p)))
    def test_03_parity_rejects_tamper(self):
        p=self.attest();q=copy.deepcopy(p);q['tenants'][TENANT_A]['sha256']='0'*64
        with self.assertRaises(AuditFailure) as e:compare(p,q)
        self.assertEqual(str(e.exception),'R141_INDEPENDENT_PARITY')
    def test_04_parity_rejects_release_override(self):
        p=self.attest();p['release']='GO'
        with self.assertRaises(AuditFailure) as e:compare(p,p)
        self.assertEqual(str(e.exception),'R141_SOURCE_GATE')
    def test_05_booking_owner_tamper(self):
        self.mutated(lambda s:s[TENANT_A]['bookings'][self.b].__setitem__('ownerId','cust_BBB'),'BOOK_ORIGINAL_OWNER')
    def test_06_case_owner_tamper(self):
        self.mutated(lambda s:s[TENANT_A]['cases'][self.c].__setitem__('ownerId','cust_BBB'),'CASE_OWNER_BOOKING')
    def test_07_case_tenant_tamper(self):
        self.mutated(lambda s:s[TENANT_A]['cases'][self.c].__setitem__('tenant',TENANT_B),'CASE_TENANT')
    def test_08_case_version_tamper(self):
        self.mutated(lambda s:s[TENANT_A]['cases'][self.c].__setitem__('version',9),'CASE_VERSION')
    def test_09_case_state_tamper(self):
        self.mutated(lambda s:s[TENANT_A]['cases'][self.c].__setitem__('state','REPORTED'),'CASE_CHAIN')
    def test_10_case_quote_tamper(self):
        self.mutated(lambda s:s[TENANT_A]['cases'][self.c]['quote'].__setitem__('totalYen',99),'QUOTE_SUM')
    def test_11_choice_tamper(self):
        self.mutated(lambda s:s[TENANT_A]['cases'][self.c].__setitem__('choice','DECLINE'),'APPROVAL_STATE')
    def test_12_duplicate_audit_item(self):
        self.mutated(lambda s:s[TENANT_A]['audit'].append(copy.deepcopy(s[TENANT_A]['audit'][-1])),'AUDIT_REPLAY_CARDINALITY')
    def test_13_removed_audit_event(self):
        self.mutated(lambda s:s[TENANT_A]['audit'].pop(),'AUDIT_REPLAY_CARDINALITY')
    def test_14_missing_replay(self):
        self.mutated(lambda s:s[TENANT_A]['replay'].pop('command_open_001'),'AUDIT_REPLAY_CARDINALITY')
    def test_15_fingerprint_tamper(self):
        self.mutated(lambda s:s[TENANT_A]['replay']['command_open_001'].__setitem__('fingerprint','0'*64),'REPLAY_FINGERPRINT')
    def test_16_release_tamper(self):
        self.mutated(lambda s:s[TENANT_A]['replay']['command_open_001']['response'].__setitem__('release','GO'),'REPLAY_RELEASE_GATE')
    def test_17_index_tamper(self):
        self.mutated(lambda s:s[TENANT_A]['audit'][1].__setitem__('index',30),'AUDIT_ORDER')
    def test_18_fake_actor_approval(self):
        self.mutated(lambda s:s[TENANT_A]['audit'][4].__setitem__('role','STAFF'),'CASE_DECIDER')
    def test_19_other_customer_approval(self):
        self.mutated(lambda s:s[TENANT_A]['audit'][4].__setitem__('subject','cust_BBB'),'CASE_DECIDER')
    def test_20_missing_booking(self):
        self.mutated(lambda s:s[TENANT_A]['bookings'].pop(self.b),'BOOK_EVENT_ORPHAN')
    def test_21_original_owner_changed(self):
        self.mutated(lambda s:s[TENANT_A]['bookings'][self.b]['original'].__setitem__('ownerId','cust_BBB'),'BOOK_ORIGINAL_OWNER')
    def test_22_closed_case_booking_cancelled(self):
        self.mutated(lambda s:s[TENANT_A]['bookings'][self.b].__setitem__('state','CANCELLED'),'BOOK_CANCEL_JOURNAL')
    def test_23_case_op_order_tamper(self):
        def mutate(s):
            q=s[TENANT_A]['audit'];q[2],q[3]=q[3],q[2]
            q[2]['index']=3;q[3]['index']=4
        self.mutated(mutate,'CASE_CHAIN')
    def test_24_extra_field(self):
        self.mutated(lambda s:s[TENANT_A]['cases'][self.c].__setitem__('isAdmin',True),'CASE_SHAPE')
    def test_25_wrong_tenant_id(self):
        self.mutated(lambda s:s[TENANT_A]['bookings'][self.b].__setitem__('tenant',TENANT_B),'BOOK_TENANT')
    def test_26_booking_version_tamper(self):
        self.mutated(lambda s:s[TENANT_A]['bookings'][self.b].__setitem__('version',42),'BOOK_VERSION')
    def test_27_operations_counter_regression(self):
        self.mutated(lambda s:s[TENANT_A].__setitem__('seqB',0),'COUNTERS')
    def test_28_bad_replay_result(self):
        self.mutated(lambda s:s[TENANT_A]['replay']['command_open_001']['response'].__setitem__('caseId','CS_999999'),'REPLAY_RESULT')
    def test_29_scope_wrong(self):
        p=self.attest();self.assertFalse(p['productionTouched']);self.assertTrue(p['syntheticOnly'])
    def test_30_empty_safe(self):
        p=attest({});self.assertEqual(p['tenants'],{})

if __name__=='__main__':unittest.main()

#!/usr/bin/env python3
"""Offline unit tests for the independent, evidence-derived R139 reconciliation."""
import copy
import unittest
from car02_r139_pg17_reconciliation_qa import attest_shop,attest_snapshot,ReconciliationError,TABLE_COLUMNS


def fixture():
    book={'id':1,'shop_code':'street_house_demo','owner_login':'car02_r138_a_one_ci',
          'request_key':'synthetic_book_001','booking_day':'2026-10-19','begins_at':'09:00:00',
          'original_booking_day':'2026-10-19','original_begins_at':'09:00:00','state':'ACTIVE','version':1}
    c={'id':12,'booking_id':1,'shop_code':book['shop_code'],'owner_login':book['owner_login'],
       'request_key':'synthetic_case_001','state':'COMPLETED','version':5,
       'report':'Brake pads inspected', 'part_yen':9800,'labor_yen':6600,'total_yen':18040}
    ops=[]
    for i,(kind,actor) in enumerate([('REPORT','car02_r138_a_staff_ci'),('QUOTE','car02_r138_a_staff_ci'),
                 ('DECIDE','car02_r138_a_one_ci'),('COMPLETE','car02_r138_a_staff_ci')],1):
        ops.append({'id':i,'case_id':12,'shop_code':c['shop_code'],'owner_login':c['owner_login'],
                    'actor_login':actor,'request_key':f'synthetic_operation_{i:02d}',
                    'request_hash':'a'*32,'op':kind})
    aud=[(1,'BOOKED',1),(2,'CASE_OPENED',12),(3,'REPORT',12),(4,'QUOTE',12),(5,'DECIDE',12),(6,'COMPLETE',12)]
    audits=[{'id':i,'shop_code':book['shop_code'],'owner_login':book['owner_login'],'entity_id':entity,'action':action}
            for i,action,entity in aud]
    return {'bookings':[book],'service_cases':[c],'case_operations':ops,'booking_operations':[],'audit_events':audits}


class R139Tests(unittest.TestCase):
    def good(self,p):
        return attest_shop('street_house_demo',('car02_r138_a_one_ci','car02_r138_a_two_ci'),p)
    def bad(self,modify,reason):
        f=fixture();modify(f)
        with self.assertRaisesRegex(ReconciliationError,reason):self.good(f)
    def test_valid_complete_case(self):
        p=self.good(fixture());self.assertEqual(p['eventsReconciled'],6)
        self.assertEqual(p['counts']['service_cases'],1)
    def test_valid_cancelled_booking(self):
        f=fixture();f['service_cases']=[];f['case_operations']=[]
        f['bookings'][0]['state']='CANCELLED';f['bookings'][0]['version']=2
        f['booking_operations']=[dict(id=9,booking_id=1,shop_code='street_house_demo',owner_login='car02_r138_a_one_ci',actor_login='car02_r138_a_one_ci',request_key='synthetic_cancel_01',request_hash='b'*32,op='CANCEL')]
        f['audit_events']=[f['audit_events'][0],dict(id=99,shop_code='street_house_demo',owner_login='car02_r138_a_one_ci',entity_id=1,action='CANCEL')]
        self.assertEqual(self.good(f)['eventsReconciled'],2)
    def test_valid_empty_shop(self):self.assertEqual(self.good({k:[] for k in TABLE_COLUMNS})['eventsReconciled'],0)
    def test_orphan_case(self):self.bad(lambda f:f['bookings'].clear(),'CASE_MISSING_BOOKING')
    def test_mismatched_case_owner(self):self.bad(lambda f:f['service_cases'][0].update(owner_login='car02_r138_a_two_ci'),'CASE_BOOKING_OWNER')
    def test_cross_tenant(self):self.bad(lambda f:f['bookings'][0].update(shop_code='other_demo'),'TENANT_OR_OWNER_bookings')
    def test_unknown_actor(self):self.bad(lambda f:f['case_operations'][0].update(actor_login='car02_r138_a_one_ci'),'CASE_ACTOR_PRIVILEGE')
    def test_foreign_customer_decision(self):self.bad(lambda f:f['case_operations'][2].update(actor_login='car02_r138_a_two_ci'),'CASE_APPROVAL_OWNER')
    def test_wrong_quote(self):self.bad(lambda f:f['service_cases'][0].update(total_yen=18041),'TAX_OR_TOTAL_DRIFT')
    def test_missing_report(self):self.bad(lambda f:f['service_cases'][0].update(report=None),'REPORT_INVALID')
    def test_wrong_case_state(self):self.bad(lambda f:f['service_cases'][0].update(state='QUOTED'),'CASE_TRANSITION_CHAIN')
    def test_case_version(self):self.bad(lambda f:f['service_cases'][0].update(version=3),'CASE_VERSION_DRIFT')
    def test_lost_audit(self):self.bad(lambda f:f['audit_events'].pop(),'AUDIT_RECONCILIATION_MISMATCH')
    def test_extra_audit(self):self.bad(lambda f:f['audit_events'].append(copy.deepcopy(f['audit_events'][-1])),'DUPLICATE_IDS_audit_events')
    def test_audit_action_tamper(self):self.bad(lambda f:f['audit_events'][-1].update(action='REPORT'),'AUDIT_RECONCILIATION_MISMATCH')
    def test_orphan_case_op(self):self.bad(lambda f:f['case_operations'][0].update(case_id=99),'ORPHAN_CASE_OPERATION')
    def test_duplicate_op_key(self):self.bad(lambda f:f['case_operations'][0].update(request_key=f['case_operations'][1]['request_key']),'CASE_OP_REUSE')
    def test_invalid_hash(self):self.bad(lambda f:f['case_operations'][0].update(request_hash='wrong'),'CASE_OP_HASH')
    def test_cancelled_case(self):
        def modify(f):
            f['bookings'][0]['state']='CANCELLED'
            f['bookings'][0]['version']=2
            f['booking_operations'].append(dict(id=9,booking_id=1,shop_code='street_house_demo',owner_login='car02_r138_a_one_ci',actor_login='car02_r138_a_one_ci',request_key='synthetic_cancel_01',request_hash='b'*32,op='CANCEL'))
            f['audit_events'].append(dict(id=99,shop_code='street_house_demo',owner_login='car02_r138_a_one_ci',entity_id=1,action='CANCEL'))
        self.bad(modify,'CASE_LINKS_CANCELLED_BOOKING')
    def test_missing_booking_op(self):self.bad(lambda f:f['bookings'][0].update(version=2),'BOOKING_VERSION_DRIFT')
    def test_immutable_initial(self):self.bad(lambda f:f['bookings'][0].update(original_begins_at='09:30:00'),'ORIGINAL_PAYLOAD_CHANGED')
    def test_bad_slot(self):self.bad(lambda f:f['bookings'][0].update(begins_at='09:15:00'),'SLOT_GRID')
    def test_no_other_tables(self):self.bad(lambda f:f.update(extra=[]),'TABLE_SET')
    def test_wrong_owner(self):self.bad(lambda f:f['audit_events'][0].update(owner_login='car02_r138_a_two_ci'),'AUDIT_RECONCILIATION_MISMATCH')
    def test_duplicate_active_slot(self):
        def modify(f):
            b=copy.deepcopy(f['bookings'][0]);b['id']=2;b['request_key']='synthetic_book_002';f['bookings'].append(b)
        self.bad(modify,'SLOT_DUPLICATED')
    def test_cancel_without_op(self):self.bad(lambda f:f['bookings'][0].update(state='CANCELLED'),'CANCEL_JOURNAL_DRIFT')
    def test_valid_source_restore(self):
        shop={'shop':'street_house_demo','digest':'a'*64,'counts':{'audit_events':5},'eventsReconciled':5}
        other={'shop':'other_demo','digest':'b'*64,'counts':{'audit_events':2},'eventsReconciled':2}
        a={'release':'NO_GO','migration':'HOLD','syntheticOnly':True,'productionTouched':False,'shops':{'street_house_demo':shop,'other_demo':other}}
        b=copy.deepcopy(a);self.assertTrue(attest_snapshot(a,b))
    def test_restore_mismatch(self):
        p=self.good(fixture())
        a={'release':'NO_GO','migration':'HOLD','syntheticOnly':True,'productionTouched':False,'shops':{'street_house_demo':p,'other_demo':{'shop':'other_demo','digest':'b'*64,'eventsReconciled':0,'counts':{'audit_events':0}}}}
        b=copy.deepcopy(a);b['shops']['street_house_demo']['digest']='c'*64
        with self.assertRaisesRegex(ReconciliationError,'RESTORE_PARITY'):attest_snapshot(a,b)
    def test_fail_open_forbidden(self):
        a={'release':'GO','migration':'HOLD','syntheticOnly':True,'productionTouched':False,'shops':{}}
        with self.assertRaisesRegex(ReconciliationError,'source_LOCK'):attest_snapshot(a,a)
    def test_production_contact_forbidden(self):
        a={'release':'NO_GO','migration':'HOLD','syntheticOnly':True,'productionTouched':True,'shops':{}}
        with self.assertRaisesRegex(ReconciliationError,'source_ISOLATION'):attest_snapshot(a,a)

if __name__=='__main__':unittest.main(verbosity=2)

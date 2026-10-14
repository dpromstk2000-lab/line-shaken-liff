#!/usr/bin/env python3
"""R140/R141 synthetic-only security negative tests, no real credentials or network."""
import base64
import copy
from datetime import datetime
import json
import os
import random
import unittest
from zoneinfo import ZoneInfo
from car02_r140_auth_boundary_isolated import (SyntheticBoundary, GuardError, POLICY,
    ISSUER, AUDIENCE,KEY,KEY_ID, SCOPES, mint_fixture, sign_fixture_payload,
    verify_fixture_token, _b64, canonical, valid_slot)

NOW=int(datetime(2026,10,14,10,0,0,tzinfo=ZoneInfo('Asia/Tokyo')).timestamp())
TENANT_A='street_house_demo';TENANT_B='other_demo'
BASE_SCOPES=sorted(SCOPES)

def token(sub='cust_AAA',tenant=TENANT_A,role='CUSTOMER',scopes=None,**kwargs):
    return mint_fixture(sub=sub,tenant=tenant,role=role,
                        scopes=BASE_SCOPES if scopes is None else scopes,
                        now_sec=NOW,**kwargs)

def request(op,key='command_key_001',version=0,tenant=TENANT_A,
            booking=None,case=None,data=None):
    defaults={'BOOK':{'ownerId':'cust_AAA','date':'2026-10-19','time':'09:00'},
      'MOVE':{'date':'2026-10-19','time':'09:30'},'CANCEL':{},'OPEN_CASE':{},
      'REPORT':{'note':'Detailed synthetic vehicle inspection report'},
      'QUOTE':{'partYen':1000,'laborYen':2000},'DECIDE':{'choice':'APPROVE'},
      'COMPLETE':{},'READ_BOOKING':{},'READ_CASE':{}}
    return {'tenant':tenant,'op':op,'key':key,'expectedVersion':version,
            'bookingId':booking,'caseId':case,'data':defaults[op] if data is None else data}

class Flow(unittest.TestCase):
    def setUp(self):
        os.environ['CAR02_RELEASE_LOCK']='true';os.environ['R140_SYNTHETIC_QA']='yes'
        self.s=SyntheticBoundary(NOW)
        self.staff=token('staff_AAA',role='STAFF')
        self.owner=token('owner_AAA',role='OWNER')
        self.cust=token()
        self.other=token('cust_BBB')
        self.otherstaff=token('staff_BBB',TENANT_B,'STAFF')

    def fail_unchanged(self, auth, req, code):
        before=self.s.state_snapshot()
        with self.assertRaises(GuardError) as e:self.s.execute(auth,req)
        self.assertEqual(e.exception.code,'R140_'+code)
        self.assertEqual(self.s.state_snapshot(),before)

    def booked(self, key='command_book_001'):
        return self.s.execute(self.staff,request('BOOK',key))['bookingId']

    def opened(self):
        b=self.booked()
        c=self.s.execute(self.staff,request('OPEN_CASE','command_open_001',1,booking=b))['caseId']
        return b,c

    def quoted(self):
        b,c=self.opened()
        self.s.execute(self.staff,request('REPORT','command_report_001',1,case=c))
        self.s.execute(self.staff,request('QUOTE','command_quote_001',2,case=c))
        return b,c

    def test_01_full_workflow_approve_and_complete(self):
        b,c=self.quoted()
        response=self.s.execute(self.cust,request('DECIDE','command_decide_001',3,case=c))
        self.assertEqual(response['state'],'APPROVED')
        response=self.s.execute(self.staff,request('COMPLETE','command_finish_001',4,case=c))
        self.assertEqual(response['state'],'COMPLETED')
        self.assertEqual(len(self.s.tenants[TENANT_A]['audit']),6)
        self.assertEqual(response['release'],'NO_GO');self.assertEqual(response['migration'],'HOLD')

    def test_02_other_customer_denied_decision(self):
        _,c=self.quoted();self.fail_unchanged(self.other,request('DECIDE','command_decide_002',3,case=c),'CUSTOMER_OWNERSHIP')

    def test_03_cross_tenant_target_hidden(self):
        b=self.booked();req=request('MOVE','command_move_003',1,TENANT_B,booking=b)
        self.fail_unchanged(self.otherstaff,req,'BOOKING_NOT_FOUND')

    def test_04_tenant_swapping_claims_denied(self):
        b=self.booked();self.fail_unchanged(self.otherstaff,request('MOVE','command_move_004',1,booking=b),'TENANT_SCOPE')

    def test_05_customer_cannot_quote(self):
        _,c=self.opened();self.fail_unchanged(self.cust,request('QUOTE','command_quote_005',1,case=c),'ROLE_DENIED')

    def test_06_staff_cannot_approve(self):
        _,c=self.quoted();self.fail_unchanged(self.staff,request('DECIDE','command_decide_006',3,case=c),'ROLE_DENIED')

    def test_07_owner_cannot_approve_for_customer(self):
        _,c=self.quoted();self.fail_unchanged(self.owner,request('DECIDE','command_decide_007',3,case=c),'ROLE_DENIED')

    def test_08_unapproved_completion_denied(self):
        _,c=self.quoted();self.fail_unchanged(self.staff,request('COMPLETE','command_finish_008',3,case=c),'APPROVAL_REQUIRED')

    def test_09_declined_cannot_complete(self):
        _,c=self.quoted();self.s.execute(self.cust,request('DECIDE','command_decide_009',3,case=c,data={'choice':'DECLINE'}))
        self.fail_unchanged(self.staff,request('COMPLETE','command_finish_009',4,case=c),'APPROVAL_REQUIRED')

    def test_10_case_open_blocks_cancel(self):
        b,c=self.opened();self.fail_unchanged(self.cust,request('CANCEL','command_cancel_010',1,booking=b),'CASE_ALREADY_OPEN')

    def test_11_case_open_blocks_move(self):
        b,c=self.opened();self.fail_unchanged(self.cust,request('MOVE','command_move_011',1,booking=b),'CASE_ALREADY_OPEN')

    def test_12_cancelled_cannot_move(self):
        b=self.booked();self.s.execute(self.cust,request('CANCEL','command_cancel_012',1,booking=b))
        self.fail_unchanged(self.cust,request('MOVE','command_move_012',2,booking=b),'CANCELLED_IMMUTABLE')

    def test_13_cancelled_cannot_open_case(self):
        b=self.booked();self.s.execute(self.cust,request('CANCEL','command_cancel_013',1,booking=b))
        self.fail_unchanged(self.staff,request('OPEN_CASE','command_open_013',2,booking=b),'CANCELLED_IMMUTABLE')

    def test_14_duplicate_slot_denied(self):
        self.booked();self.fail_unchanged(self.staff,request('BOOK','command_book_014',data={'ownerId':'cust_BBB','date':'2026-10-19','time':'09:00'}),'SLOT_TAKEN')

    def test_15_cancel_frees_slot(self):
        b=self.booked();self.s.execute(self.cust,request('CANCEL','command_cancel_015',1,booking=b))
        self.assertNotEqual(self.s.execute(self.staff,request('BOOK','command_book_015'))['bookingId'],b)

    def test_16_move_preserves_original(self):
        b=self.booked();self.s.execute(self.cust,request('MOVE','command_move_016',1,booking=b))
        q=self.s.execute(self.cust,request('READ_BOOKING',None,None,booking=b))['record']
        self.assertEqual(q['original'],{'ownerId':'cust_AAA','day':'2026-10-19','time':'09:00'})
        self.assertEqual(q['time'],'09:30')

    def test_17_valid_replay_without_mutation(self):
        b=self.booked();req=request('MOVE','command_move_017',1,booking=b)
        response=self.s.execute(self.cust,req);before=self.s.state_snapshot()
        retry=self.s.execute(self.cust,req)
        self.assertEqual(retry['version'],response['version']);self.assertTrue(retry['replayed'])
        self.assertEqual(before,self.s.state_snapshot())

    def test_18_changed_replay_denied(self):
        b=self.booked();self.s.execute(self.cust,request('MOVE','command_move_018',1,booking=b))
        self.fail_unchanged(self.cust,request('MOVE','command_move_018',1,booking=b,data={'date':'2026-10-19','time':'10:00'}),'REPLAY_MISMATCH')

    def test_19_different_actor_replay_denied(self):
        b=self.booked();req=request('MOVE','command_move_019',1,booking=b);self.s.execute(self.cust,req)
        self.fail_unchanged(self.staff,req,'REPLAY_MISMATCH')

    def test_20_stale_version_denied(self):
        b=self.booked();self.fail_unchanged(self.cust,request('CANCEL','command_cancel_020',4,booking=b),'STALE_BOOKING')

    def test_21_case_stale_version_denied(self):
        _,c=self.opened();self.fail_unchanged(self.staff,request('REPORT','command_report_021',6,case=c),'STALE_CASE')

    def test_22_customer_cannot_read_other(self):
        b=self.booked();self.fail_unchanged(self.other,request('READ_BOOKING',None,None,booking=b),'CUSTOMER_OWNERSHIP')

    def test_23_customer_cannot_read_other_case(self):
        _,c=self.opened();self.fail_unchanged(self.other,request('READ_CASE',None,None,case=c),'CUSTOMER_OWNERSHIP')

    def test_24_staff_read_in_shop(self):
        b=self.booked();self.assertEqual(self.s.execute(self.staff,request('READ_BOOKING',None,None,booking=b))['record']['id'],b)

    def test_25_scope_missing(self):
        b=self.booked();small=token(scopes=['booking:read'])
        self.fail_unchanged(small,request('CANCEL','command_cancel_025',1,booking=b),'SCOPE_DENIED')

    def test_26_extra_actor_field_rejected(self):
        q=request('BOOK');q['actor']={'role':'OWNER'}
        self.fail_unchanged(self.staff,q,'REQUEST_SHAPE')

    def test_27_extra_payload_field_rejected(self):
        q=request('BOOK');q['data']['tenant']='other_demo'
        self.fail_unchanged(self.staff,q,'DATA_SHAPE')

    def test_28_customer_cannot_book(self):self.fail_unchanged(self.cust,request('BOOK'),'ROLE_DENIED')
    def test_29_read_cannot_have_idempotency_key(self):
        b=self.booked();self.fail_unchanged(self.cust,request('READ_BOOKING','command_read_029',0,booking=b),'READ_ONLY_FIELDS')
    def test_30_invalid_key(self):self.fail_unchanged(self.staff,request('BOOK',key='short'),'REQUEST_KEY')
    def test_31_case_report_short(self):
        _,c=self.opened();self.fail_unchanged(self.staff,request('REPORT','command_report_031',1,case=c,data={'note':'short'}),'REPORT_RULE')
    def test_32_quote_negative(self):
        _,c=self.opened();self.s.execute(self.staff,request('REPORT','command_report_032',1,case=c))
        self.fail_unchanged(self.staff,request('QUOTE','command_quote_032',2,case=c,data={'partYen':-1,'laborYen':1}),'QUOTE_RULE')
    def test_33_quote_math(self):
        _,c=self.opened();self.s.execute(self.staff,request('REPORT','command_report_033',1,case=c))
        self.s.execute(self.staff,request('QUOTE','command_quote_033',2,case=c,data={'partYen':11,'laborYen':10}))
        rec=self.s.execute(self.staff,request('READ_CASE',None,None,case=c))['record'];self.assertEqual(rec['quote']['totalYen'],23)
    def test_34_cross_shop_same_slot_allowed(self):
        self.booked();result=self.s.execute(self.otherstaff,request('BOOK','command_book_034',tenant=TENANT_B,data={'ownerId':'cust_CCC','date':'2026-10-19','time':'09:00'}))
        self.assertEqual(result['state'],'ACTIVE')

class Token(unittest.TestCase):
    def setUp(self):
        os.environ['CAR02_RELEASE_LOCK']='true';os.environ['R140_SYNTHETIC_QA']='yes'
        self.ok=token()
    def reject(self, t, code):
        with self.assertRaises(GuardError) as e:verify_fixture_token(t,NOW)
        self.assertEqual(e.exception.code,'R140_'+code)
    def payload(self):
        return {'iss':ISSUER,'aud':AUDIENCE,'sub':'cust_AAA','tenant':TENANT_A,'role':'CUSTOMER',
                'scope':BASE_SCOPES,'iat':NOW,'nbf':NOW,'exp':NOW+600,'jti':'synthetic-jti-001'}
    def test_35_valid_token(self):self.assertEqual(verify_fixture_token(self.ok,NOW)['sub'],'cust_AAA')
    def test_36_signature_tamper(self):
        a,b,c=self.ok.split('.');self.reject(a+'.'+b+'.'+('A' if c[0]!='A' else 'B')+c[1:],'BAD_SIGNATURE')
    def test_37_alg_none_denied(self):self.reject(sign_fixture_payload(self.payload(),{'typ':'JWT','alg':'none','kid':KEY_ID}),'TOKEN_HEADER')
    def test_38_wrong_kid(self):self.reject(sign_fixture_payload(self.payload(),{'typ':'JWT','alg':'HS256','kid':'other'}),'TOKEN_HEADER')
    def test_39_wrong_audience(self):
        p=self.payload();p['aud']='production';self.reject(sign_fixture_payload(p),'TOKEN_AUDIENCE')
    def test_40_wrong_issuer(self):
        p=self.payload();p['iss']='attacker';self.reject(sign_fixture_payload(p),'TOKEN_AUDIENCE')
    def test_41_expired(self):self.reject(token(lifetime=0),'TOKEN_EXPIRED_OR_NOT_YET_VALID')
    def test_42_future_not_before(self):self.reject(token(nbf_offset=60),'TOKEN_EXPIRED_OR_NOT_YET_VALID')
    def test_43_future_issued(self):
        p=self.payload();p['iat']=NOW+5;p['nbf']=NOW+5;p['exp']=NOW+605
        self.reject(sign_fixture_payload(p),'TOKEN_EXPIRED_OR_NOT_YET_VALID')
    def test_44_overlong_lifetime(self):self.reject(token(lifetime=3601),'TOKEN_LIFETIME')
    def test_45_revoked(self):
        with self.assertRaises(GuardError) as e:verify_fixture_token(self.ok,NOW,{'synthetic-jti-001'})
        self.assertEqual(e.exception.code,'R140_TOKEN_REVOKED')
    def test_46_reissue_revoked_existing_request_denied(self):
        s=SyntheticBoundary(NOW);staff=token('staff_AAA',role='STAFF')
        req=request('BOOK');s.execute(staff,req);before=s.state_snapshot()
        s.revoke_fixture('synthetic-jti-001')
        with self.assertRaises(GuardError):s.execute(staff,req)
        self.assertEqual(s.state_snapshot(),before)
    def test_47_extra_claim(self):
        p=self.payload();p['admin']=True;self.reject(sign_fixture_payload(p),'CLAIMS_SHAPE')
    def test_48_empty_scopes(self):
        p=self.payload();p['scope']=[]
        self.assertEqual(verify_fixture_token(sign_fixture_payload(p),NOW)['scope'],[])
    def test_49_scopes_malformed(self):
        p=self.payload();p['scope']=['booking:read','booking:read'];self.reject(sign_fixture_payload(p),'SCOPES')
    def test_50_role_injected(self):
        p=self.payload();p['role']='ADMIN';self.reject(sign_fixture_payload(p),'ROLE')
    def test_51_missing_claim(self):
        p=self.payload();p.pop('aud');self.reject(sign_fixture_payload(p),'CLAIMS_SHAPE')
    def test_52_bool_as_clock(self):
        p=self.payload();p['exp']=True;self.reject(sign_fixture_payload(p),'TOKEN_CLOCK')
    def test_53_json_duplicate_field(self):
        a=_b64(b'{"typ":"JWT","alg":"HS256","kid":"r140-fixture-only","kid":"r140-fixture-only"}')
        b=self.ok.split('.')[1];self.reject(a+'.'+b+'.AAA','DUPLICATE_JSON_FIELD')
    def test_54_noncanonical_encoding(self):
        a,b,c=self.ok.split('.');self.reject('='+a+'.'+b+'.'+c,'BAD_ENCODING')
    def test_55_not_three_segments(self):self.reject('not.a.token.extra','TOKEN_SEGMENTS')
    def test_56_missing_isolation_lock(self):
        old=os.environ.pop('R140_SYNTHETIC_QA')
        try:
            with self.assertRaises(GuardError) as e:verify_fixture_token(self.ok,NOW)
            self.assertEqual(e.exception.code,'R140_ISOLATION_REQUIRED')
        finally:os.environ['R140_SYNTHETIC_QA']=old
    def test_57_token_expiry_blocks_replay(self):
        s=SyntheticBoundary(NOW);staff=token('staff_AAA',role='STAFF')
        q=request('BOOK');s.execute(staff,q);before=s.state_snapshot()
        s.now_sec=NOW+601
        with self.assertRaises(GuardError) as e:s.execute(staff,q)
        self.assertEqual(e.exception.code,'R140_TOKEN_EXPIRED_OR_NOT_YET_VALID');self.assertEqual(s.state_snapshot(),before)
    def test_58_subject_change_signed_does_not_authorize(self):
        s=SyntheticBoundary(NOW);staff=token('staff_AAA',role='STAFF')
        b=s.execute(staff,request('BOOK'))['bookingId']
        with self.assertRaises(GuardError) as e:s.execute(token('cust_BBB'),request('CANCEL','command_cancel_058',1,booking=b))
        self.assertEqual(e.exception.code,'R140_CUSTOMER_OWNERSHIP')

class Adversarial(unittest.TestCase):
    def setUp(self):
        os.environ['CAR02_RELEASE_LOCK']='true';os.environ['R140_SYNTHETIC_QA']='yes'
    def test_59_deterministic_bad_slot_matrix(self):
        bad=[('2026-10-19','09:15'),('2026-10-19','18:00'),('2026-10-19','08:30'),
             ('2026-10-18','10:00'),('2026-10-14','09:00'),('2026-12-30','09:00'),
             ('2026-13-01','10:00'),('2026-10-19','9:00'),('2026-10-19','10:00:00')]
        for day,t in bad:
            with self.subTest(day=day,time=t),self.assertRaises(GuardError):valid_slot(day,t,NOW)
    def test_60_mutation_rejected_request_matrix(self):
        s=SyntheticBoundary(NOW);staff=token('staff_AAA',role='STAFF')
        base=request('BOOK');rng=random.Random(140)
        for i in range(250):
            q=copy.deepcopy(base)
            k=rng.randrange(8)
            if k==0:q['tenant']=TENANT_B
            if k==1:q['op']='DELETE_ALL'
            if k==2:q['key']='x'
            if k==3:q['data']['date']='2000-01-01'
            if k==4:q['data']['time']='08:00'
            if k==5:q['data']['ownerId']=''
            if k==6:q['extra']='actor-spoof'
            if k==7:q['expectedVersion']=True
            before=s.state_snapshot()
            with self.subTest(i=i),self.assertRaises(GuardError):s.execute(staff,q)
            self.assertEqual(s.state_snapshot(),before)
    def test_61_replay_mutation_matrix(self):
        s=SyntheticBoundary(NOW);staff=token('staff_AAA',role='STAFF');cus=token()
        b=s.execute(staff,request('BOOK'))['bookingId']
        orig=request('MOVE','command_move_061',1,booking=b)
        s.execute(cus,orig);rng=random.Random(141)
        for i in range(250):
            q=copy.deepcopy(orig);q['data']['time']=rng.choice(['10:00','11:30','16:00'])
            before=s.state_snapshot()
            with self.assertRaises(GuardError) as e:s.execute(cus,q)
            self.assertEqual(e.exception.code,'R140_REPLAY_MISMATCH')
            self.assertEqual(s.state_snapshot(),before)
    def test_62_isolation_flag_is_invariant(self):
        self.assertEqual(POLICY['release'],'NO_GO');self.assertEqual(POLICY['migration'],'HOLD')
        self.assertFalse(POLICY['productionTouched']);self.assertFalse(POLICY['realAuthentication'])

if __name__=='__main__':unittest.main()

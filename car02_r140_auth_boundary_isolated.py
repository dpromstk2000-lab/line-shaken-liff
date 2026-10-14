#!/usr/bin/env python3
"""CAR02 R140 synthetic boundary model (NOT an authenticator or deployable API).

Only in-memory fictional data. No remote I/O, web server, SQL, LINE, Supabase,
real identity, service-role access, credential loading, or production code hooks.
A fixed fixture signing key represents a *mock* token issuer, not real security.
R138B-inspired booking/case state machine, with strict identity provenance.
"""
from __future__ import annotations
import base64
import copy
from datetime import datetime, date, time, timedelta
import hashlib
import hmac
import json
import os
import re
from zoneinfo import ZoneInfo

POLICY = dict(modelVersion='R140', release='NO_GO', migration='HOLD',
              syntheticOnly=True, productionTouched=False,
              realAuthentication=False, realRLS=False, realDatabase=False,
              realApi=False, customerApprovalVerified=False)
ISSUER = 'car02-r140-synthetic-issuer'
AUDIENCE = 'car02-r140-isolated-qa'
KEY_ID = 'r140-fixture-only'
KEY = b'CAR02_R140_NOT_A_REAL_SIGNING_SECRET_fixture_v1'
CLOCK_TOLERANCE_SEC = 0
IDENT = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{2,31}\Z')
REQ_KEY = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{11,63}\Z')
JTI = re.compile(r'[A-Za-z0-9_-]{12,64}\Z')
B64 = re.compile(r'[A-Za-z0-9_-]+\Z')
ROLES = {'CUSTOMER', 'STAFF', 'OWNER'}
OPS = {'BOOK','MOVE','CANCEL','OPEN_CASE','REPORT','QUOTE','DECIDE','COMPLETE','READ_BOOKING','READ_CASE'}
REQUIRED_SCOPES = {
 'BOOK': 'booking:create', 'MOVE': 'booking:change', 'CANCEL':'booking:change',
 'OPEN_CASE':'case:write', 'REPORT':'case:write', 'QUOTE':'case:write',
 'DECIDE':'case:decide', 'COMPLETE':'case:write',
 'READ_BOOKING':'booking:read', 'READ_CASE':'case:read',
}
SCOPES = frozenset(REQUIRED_SCOPES.values())
FIELDS = {'tenant','op','key','expectedVersion','bookingId','caseId','data'}
DATA = {
 'BOOK': {'ownerId','date','time'},'MOVE':{'date','time'},'CANCEL':set(),
 'OPEN_CASE':set(), 'REPORT':{'note'}, 'QUOTE':{'partYen','laborYen'},
 'DECIDE':{'choice'},'COMPLETE':set(), 'READ_BOOKING':set(),'READ_CASE':set()
}
MUTATIONS = OPS - {'READ_BOOKING','READ_CASE'}
ALLOWED_ROLES = {
 'BOOK': {'STAFF','OWNER'}, 'MOVE': ROLES, 'CANCEL':ROLES,
 'OPEN_CASE':{'STAFF','OWNER'}, 'REPORT':{'STAFF','OWNER'}, 'QUOTE':{'STAFF','OWNER'},
 'DECIDE':{'CUSTOMER'}, 'COMPLETE':{'STAFF','OWNER'},
 'READ_BOOKING':ROLES, 'READ_CASE':ROLES
}

class GuardError(Exception):
    def __init__(self, code):
        self.code='R140_'+code
        super().__init__(self.code)

def require(condition,code):
    if not condition: raise GuardError(code)

def plain_dict(value, names):
    return type(value) is dict and set(value)==set(names)

def safe_int(value):
    return type(value) is int and 0 <= value < 2**53

def canonical(value):
    return json.dumps(value,ensure_ascii=True,sort_keys=True,separators=(',',':'),allow_nan=False).encode('ascii')

def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')

def _decode(txt):
    require(type(txt) is str and 0<len(txt)<=4096 and B64.fullmatch(txt) is not None,'BAD_ENCODING')
    try: raw=base64.urlsafe_b64decode(txt+'='*((-len(txt))%4))
    except Exception: raise GuardError('BAD_ENCODING')
    require(_b64(raw)==txt,'NONCANONICAL_ENCODING')
    return raw

def _unique_pairs(pairs):
    data={}
    for key,val in pairs:
        require(key not in data,'DUPLICATE_JSON_FIELD')
        data[key]=val
    return data

def _json(bytes_):
    require(len(bytes_) <= 4096, 'JSON_SIZE')
    try: return json.loads(bytes_.decode('utf8'),object_pairs_hook=_unique_pairs,
                           parse_constant=lambda _: (_ for _ in ()).throw(ValueError('constant')))
    except GuardError: raise
    except (ValueError, UnicodeError,TypeError): raise GuardError('BAD_JSON')

def enforce_isolation():
    require(os.environ.get('CAR02_RELEASE_LOCK')=='true' and
            os.environ.get('R140_SYNTHETIC_QA')=='yes','ISOLATION_REQUIRED')

def mint_fixture(*, sub, tenant, role, scopes, now_sec, lifetime=600, jti='synthetic-jti-001', nbf_offset=0):
    """Only test fixtures call this. NEVER use for customer/production credentials."""
    enforce_isolation()
    payload={'iss':ISSUER,'aud':AUDIENCE,'sub':sub,'tenant':tenant,'role':role,
             'scope':scopes,'iat':now_sec,'nbf':now_sec+nbf_offset,
             'exp':now_sec+lifetime,'jti':jti}
    return sign_fixture_payload(payload)

def sign_fixture_payload(payload, header=None):
    enforce_isolation()
    header=header if header is not None else {'typ':'JWT','alg':'HS256','kid':KEY_ID}
    a=_b64(canonical(header)); b=_b64(canonical(payload))
    sig=_b64(hmac.new(KEY, f'{a}.{b}'.encode('ascii'),hashlib.sha256).digest())
    return f'{a}.{b}.{sig}'

def verify_fixture_token(token, now_sec, revoked=frozenset()):
    enforce_isolation()
    require(type(token) is str and len(token)<4096,'TOKEN_SIZE')
    parts=token.split('.')
    require(len(parts)==3,'TOKEN_SEGMENTS')
    header=_json(_decode(parts[0]));payload=_json(_decode(parts[1]))
    require(plain_dict(header,{'typ','alg','kid'}) and header=={'typ':'JWT','alg':'HS256','kid':KEY_ID},'TOKEN_HEADER')
    expected=_b64(hmac.new(KEY,'.'.join(parts[:2]).encode('ascii'),hashlib.sha256).digest())
    require(hmac.compare_digest(parts[2],expected),'BAD_SIGNATURE')
    require(plain_dict(payload,{'iss','aud','sub','tenant','role','scope','iat','nbf','exp','jti'}),'CLAIMS_SHAPE')
    require(payload['iss']==ISSUER and payload['aud']==AUDIENCE,'TOKEN_AUDIENCE')
    require(type(payload['sub']) is str and IDENT.fullmatch(payload['sub']) is not None,'SUBJECT')
    require(type(payload['tenant']) is str and IDENT.fullmatch(payload['tenant']) is not None,'TENANT')
    require(type(payload['role']) is str and payload['role'] in ROLES,'ROLE')
    require(type(payload['scope']) is list and len(set(map(str,payload['scope'])))==len(payload['scope']) and
            all(type(x) is str and x in SCOPES for x in payload['scope']),'SCOPES')
    require(all(safe_int(payload[f]) for f in ('iat','nbf','exp')) and safe_int(now_sec),'TOKEN_CLOCK')
    require(payload['iat']<=payload['nbf']<payload['exp'] and
            payload['iat']<=now_sec+CLOCK_TOLERANCE_SEC and
            payload['nbf']<=now_sec+CLOCK_TOLERANCE_SEC and
            now_sec<payload['exp'],'TOKEN_EXPIRED_OR_NOT_YET_VALID')
    require(payload['exp']-payload['iat']<=3600,'TOKEN_LIFETIME')
    require(type(payload['jti']) is str and JTI.fullmatch(payload['jti']) is not None,'JTI')
    require(payload['jti'] not in revoked,'TOKEN_REVOKED')
    return payload

def valid_slot(day, hhmm, now_sec):
    require(type(day) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}',day) and
            type(hhmm) is str and re.fullmatch(r'(?:09|1[0-7]):(?:00|30)',hhmm),'SLOT_FORMAT')
    try: d=date.fromisoformat(day); t=time.fromisoformat(hhmm)
    except ValueError: raise GuardError('SLOT_DATE')
    require(time(9,0)<=t<=time(17,30) and d.isoweekday()!=7,'SLOT_CLOSED')
    now=datetime.fromtimestamp(now_sec,ZoneInfo('Asia/Tokyo'))
    slot=datetime.combine(d,t,ZoneInfo('Asia/Tokyo'))
    require(slot>now and d<=now.date()+timedelta(days=60),'SLOT_OUT_OF_RANGE')
    return day,hhmm

class SyntheticBoundary:
    def __init__(self, now_sec, revoked=None):
        enforce_isolation()
        require(safe_int(now_sec),'CLOCK')
        self.now_sec=now_sec
        self.revoked=set() if revoked is None else set(revoked)
        self.tenants={}

    def state_snapshot(self):
        enforce_isolation()
        return copy.deepcopy(self.tenants)

    def revoke_fixture(self,jti):
        enforce_isolation()
        require(type(jti) is str and JTI.fullmatch(jti) is not None,'JTI')
        self.revoked.add(jti)

    def execute(self,token,req):
        enforce_isolation()
        # Identity ALWAYS derives from the verified mock token, never client payload.
        identity=verify_fixture_token(token,self.now_sec,self.revoked)
        require(plain_dict(req,FIELDS),'REQUEST_SHAPE')
        op=req['op']; tenant=req['tenant']
        require(type(op) is str and op in OPS,'OP')
        require(type(tenant) is str and tenant==identity['tenant'],'TENANT_SCOPE')
        require(identity['role'] in ALLOWED_ROLES[op],'ROLE_DENIED')
        require(REQUIRED_SCOPES[op] in identity['scope'],'SCOPE_DENIED')
        data=req['data']
        require(plain_dict(data,DATA[op]),'DATA_SHAPE')
        require(req['bookingId'] is None or
                (type(req['bookingId']) is str and IDENT.fullmatch(req['bookingId']) is not None),'BOOKING_ID')
        require(req['caseId'] is None or
                (type(req['caseId']) is str and IDENT.fullmatch(req['caseId']) is not None),'CASE_ID')
        if op in {'BOOK'}:
            require(req['bookingId'] is None and req['caseId'] is None,'TARGET_FIELDS')
        elif op in {'MOVE','CANCEL','OPEN_CASE','READ_BOOKING'}:
            require(req['bookingId'] is not None and req['caseId'] is None,'TARGET_FIELDS')
        else:
            require(req['caseId'] is not None and req['bookingId'] is None,'TARGET_FIELDS')
        if op in MUTATIONS:
            require(type(req['key']) is str and REQ_KEY.fullmatch(req['key']) is not None,'REQUEST_KEY')
            require(safe_int(req['expectedVersion']) and req['expectedVersion']>=0,'EXPECTED_VERSION')
        else:
            require(req['key'] is None and req['expectedVersion'] is None,'READ_ONLY_FIELDS')
        # Deep-copy and commit only after all checks, so rejected requests never mutate anything.
        t=copy.deepcopy(self.tenants.get(tenant, {'seqB':0,'seqC':0,'bookings':{},'cases':{},'replay':{},'audit':[]}))
        bookings=t['bookings']; cases=t['cases']
        booking=None; case=None
        if op not in {'BOOK'}:
            if req['bookingId'] is not None:
                booking=bookings.get(req['bookingId'])
                require(booking is not None,'BOOKING_NOT_FOUND')
            else:
                case=cases.get(req['caseId'])
                require(case is not None,'CASE_NOT_FOUND')
                booking=bookings.get(case['bookingId'])
                require(booking is not None,'CASE_BOOKING_MISSING')
            require(booking['tenant']==tenant,'TENANT_SCOPE')
            if identity['role']=='CUSTOMER':require(booking['ownerId']==identity['sub'],'CUSTOMER_OWNERSHIP')
        if op in {'READ_BOOKING','READ_CASE'}:
            return copy.deepcopy({'record':booking if op=='READ_BOOKING' else case,**POLICY})
        fingerprint=hashlib.sha256(canonical({'tenant':tenant,'subject':identity['sub'],
              'role':identity['role'],'op':op,'bookingId':req['bookingId'],'caseId':req['caseId'],
              'expectedVersion':req['expectedVersion'],'data':data})).hexdigest()
        # Collision detection before stale-version check; replay after authorization and token verification.
        prior=t['replay'].get(req['key'])
        if prior is not None:
            require(prior['fingerprint']==fingerprint,'REPLAY_MISMATCH')
            return copy.deepcopy({**prior['response'],'replayed':True})
        if op=='BOOK':
            require(req['expectedVersion']==0,'EXPECTED_VERSION')
            owner=data['ownerId'];require(type(owner) is str and IDENT.fullmatch(owner) is not None,'OWNER_ID')
            day,tm=valid_slot(data['date'],data['time'],self.now_sec)
            require(not any(b['state']=='ACTIVE' and (b['day'],b['time'])==(day,tm) for b in bookings.values()),'SLOT_TAKEN')
            t['seqB']+=1; bid=f'BK_{t["seqB"]:06d}'
            booking={'id':bid,'tenant':tenant,'ownerId':owner,'state':'ACTIVE','version':1,
                     'day':day,'time':tm,'original':{'ownerId':owner,'day':day,'time':tm}}
            bookings[bid]=booking
            result={'bookingId':bid,'state':'ACTIVE','version':1}
        elif op in {'MOVE','CANCEL'}:
            require(req['expectedVersion']==booking['version'],'STALE_BOOKING')
            require(booking['state']=='ACTIVE','CANCELLED_IMMUTABLE')
            require(not any(c['bookingId']==booking['id'] for c in cases.values()),'CASE_ALREADY_OPEN')
            if op=='MOVE':
                day,tm=valid_slot(data['date'],data['time'],self.now_sec)
                require((day,tm)!=(booking['day'],booking['time']),'NOOP_MOVE')
                require(not any(b['id']!=booking['id'] and b['state']=='ACTIVE' and (b['day'],b['time'])==(day,tm) for b in bookings.values()),'SLOT_TAKEN')
                booking.update(day=day,time=tm)
            else: booking['state']='CANCELLED'
            booking['version']+=1
            result={'bookingId':booking['id'],'state':booking['state'],'version':booking['version']}
        elif op=='OPEN_CASE':
            require(booking['state']=='ACTIVE','CANCELLED_IMMUTABLE')
            require(req['expectedVersion']==booking['version'],'STALE_BOOKING')
            require(not any(c['bookingId']==booking['id'] for c in cases.values()),'CASE_ALREADY_OPEN')
            t['seqC']+=1;cid=f'CS_{t["seqC"]:06d}'
            case={'id':cid,'bookingId':booking['id'],'tenant':tenant,'ownerId':booking['ownerId'],
                  'state':'OPEN','version':1,'report':None,'quote':None,'choice':None}
            cases[cid]=case
            result={'caseId':cid,'state':'OPEN','version':1}
        else:
            require(req['expectedVersion']==case['version'],'STALE_CASE')
            require(booking['state']=='ACTIVE','CASE_BOOKING_INVALID')
            if op=='REPORT':
                note=data['note'];require(case['state']=='OPEN' and type(note) is str and 8<=len(note)<=512,'REPORT_RULE')
                case.update(state='REPORTED',report=note)
            elif op=='QUOTE':
                part=data['partYen'];labor=data['laborYen']
                require(case['state']=='REPORTED' and all(type(x) is int and x>=0 for x in (part,labor)) and
                        0<part+labor<=100000000,'QUOTE_RULE')
                subtotal=part+labor
                case.update(state='QUOTED',quote={'partYen':part,'laborYen':labor,'totalYen':subtotal+(subtotal+5)//10})
            elif op=='DECIDE':
                require(case['state']=='QUOTED' and data['choice'] in ('APPROVE','DECLINE'),'DECISION_RULE')
                case.update(state='APPROVED' if data['choice']=='APPROVE' else 'DECLINED',choice=data['choice'])
            elif op=='COMPLETE':
                require(case['state']=='APPROVED','APPROVAL_REQUIRED')
                case.update(state='COMPLETED')
            case['version']+=1
            result={'caseId':case['id'],'state':case['state'],'version':case['version']}
        response={**result, **POLICY, 'replayed':False}
        t['audit'].append({'index':len(t['audit'])+1,'tenant':tenant,'op':op,
                           'subject':identity['sub'],'role':identity['role'],'requestKey':req['key'],
                           'fingerprint':fingerprint,'result':result})
        t['replay'][req['key']]={'fingerprint':fingerprint,'response':copy.deepcopy(response)}
        self.tenants[tenant]=t
        return copy.deepcopy(response)

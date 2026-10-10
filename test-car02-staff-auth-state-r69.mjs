// R69: Staff Auth account state regression. Synthetic tokens and responses only.
// No real Supabase credentials, DB or HTTP calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSupabaseStaffTokenVerifierR46,
  createStaffAccessResolverR46,
  createDbStaffMembershipLookupR46,
} from './car02-auth-providers-r46.mjs';
import {createCar02Authenticator} from './car02-identity-r44.mjs';

const SHOP='street_house_kitsuki';
const OTHER='other_shop';
const SUB='11111111-1111-4111-8111-111111111111';
const NOW=1_800_000_000;
const claims={sub:SUB,iss:'https://example.supabase.co/auth/v1',aud:'authenticated',role:'authenticated',exp:NOW+3600};
const token=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify(claims)).toString('base64url'),'c2lnbmF0dXJl'].join('.');
const profile={id:SUB,aud:'authenticated',is_anonymous:false};
function makeVerifier(user, handler){
  let calls=0;
  const verify=createSupabaseStaffTokenVerifierR46({
    supabaseUrl:'https://example.supabase.co',
    anonKey:'public_anon_test_key_12345',nowSeconds:()=>NOW,
    fetchImpl:async (url,options)=>{
      calls++;
      assert.equal(url,'https://example.supabase.co/auth/v1/user');
      assert.equal(options.method,'GET');
      assert.equal(options.headers.Authorization,'Bearer '+token);
      if(handler)return handler(url,options);
      return {ok:true,json:async()=>user};
    },
  });
  return {verify,calls:()=>calls};
}
async function mustReject(user){
  const x=makeVerifier(user);
  await assert.rejects(x.verify({accessToken:token}),/^Error: CAR02_IDENTITY_REJECTED$/);
  assert.equal(x.calls(),1);
}

test('R69 ordinary verified staff account remains eligible',async()=>{
  const x=makeVerifier(profile);
  assert.deepEqual(await x.verify({accessToken:token}),{verified:true,sub:SUB,exp:claims.exp});
  assert.equal(x.calls(),1);
});
test('R69 anonymous Supabase user cannot become staff even when JWT is valid',async()=>{
  await mustReject({...profile,is_anonymous:true});
});
test('R69 unexpected is_anonymous type fails closed',async()=>{
  for(const value of ['false','true',0,null]) await mustReject({...profile,is_anonymous:value});
});
test('R69 deleted staff Auth record cannot be used',async()=>{
  await mustReject({...profile,deleted_at:'2026-01-01T00:00:00Z'});
});
test('R69 future banned_until cannot be used',async()=>{
  await mustReject({...profile,banned_until:new Date((NOW+60)*1000).toISOString()});
});
test('R69 invalid banned_until cannot silently bypass the check',async()=>{
  for(const value of ['garbled',123,{},true]) await mustReject({...profile,banned_until:value});
});
test('R69 expired ban allows further authorization checks',async()=>{
  const x=makeVerifier({...profile,banned_until:new Date((NOW-60)*1000).toISOString()});
  assert.equal((await x.verify({accessToken:token})).sub,SUB);
});
test('R69 no optional fields maintains older Auth response compatibility',async()=>{
  const x=makeVerifier({id:SUB,aud:'authenticated'});
  assert.equal((await x.verify({accessToken:token})).sub,SUB);
});
test('R69 banned profile rejected before membership lookup or DB query',async()=>{
  let db=0;
  const x=makeVerifier({...profile,is_anonymous:true});
  const auth=createCar02Authenticator({shopCode:SHOP,lineClientId:'fake-line-client-id',
    verifyLineIdToken:async()=>{throw Error('LINE should not be used');},
    verifyStaffJwt:x.verify,resolveLineCustomer:async()=>{throw Error('customer should not be used');},
    resolveStaffAccess:async()=>{db++;return {active:true,role:'owner',userSub:SUB,shopCode:SHOP};},
    nowSeconds:()=>NOW});
  await assert.rejects(auth(new Request('https://local.test/api/car02',{headers:{Authorization:'Bearer '+token}})),/CAR02_UNAUTHORIZED/);
  assert.equal(db,0);
});
test('R69 authenticated non-anonymous staff still requires exact active tenant membership',async()=>{
  const x=makeVerifier(profile);
  const pool={query:async(sql,params)=>{
    assert.deepEqual(params,[SHOP,SUB]);
    assert.match(sql,/FROM public\.ksh_car02_staff_access/);
    return {rows:[{shop_code:OTHER,user_sub:SUB,staff_role:'owner',active:true}]};
  }};
  const auth=createCar02Authenticator({shopCode:SHOP,lineClientId:'fake-line-client-id',
    verifyLineIdToken:async()=>{throw Error('LINE not expected')},verifyStaffJwt:x.verify,
    resolveLineCustomer:async()=>{throw Error('LINE not expected')},
    resolveStaffAccess:createStaffAccessResolverR46({lookupMembership:createDbStaffMembershipLookupR46({pool})}),
    nowSeconds:()=>NOW});
  await assert.rejects(auth(new Request('https://local.test/api/car02',{headers:{Authorization:'Bearer '+token}})),/CAR02_UNAUTHORIZED/);
});

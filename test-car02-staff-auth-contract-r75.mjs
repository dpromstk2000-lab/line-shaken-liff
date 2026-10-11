// DPRO CAR02 R75: fail closed when Supabase's anonymous-state evidence is missing.
// Synthetic JWT and mocked Auth responses. No credentials, network or production DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseStaffTokenVerifierR46} from './car02-auth-providers-r46.mjs';
import {createCar02Authenticator} from './car02-identity-r44.mjs';

const SUB='11111111-1111-4111-8111-111111111111';
const SHOP='street_house_kitsuki';
const NOW=1800000000;
const claims={sub:SUB,iss:'https://example.supabase.co/auth/v1',aud:'authenticated',role:'authenticated',exp:NOW+3600};
const jwt=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify(claims)).toString('base64url'),'c2lnbmF0dXJl'].join('.');
const base={id:SUB,aud:'authenticated',is_anonymous:false};
const verifier=(profile,onCall=()=>{})=>createSupabaseStaffTokenVerifierR46({
  supabaseUrl:'https://example.supabase.co', anonKey:'test_public_anon_key_1234567890', nowSeconds:()=>NOW,
  fetchImpl:async (url,options)=>{
    onCall();
    assert.equal(url,'https://example.supabase.co/auth/v1/user');
    assert.equal(options.method,'GET');
    assert.equal(options.headers.Authorization,'Bearer '+jwt);
    return {ok:true,json:async()=>profile};
  }
});
const rejected=x=>assert.rejects(x,/^Error: CAR02_IDENTITY_REJECTED$/);

test('R75 explicit non-anonymous false remains eligible for authoritative membership lookup',async()=>{
  let calls=0;
  const verified=await verifier({...base},()=>calls++)({accessToken:jwt});
  assert.deepEqual(verified,{verified:true,sub:SUB,exp:claims.exp});
  assert.equal(calls,1);
});

test('R75 missing anonymity flag fails closed',async()=>{
  await rejected(verifier({id:SUB,aud:'authenticated'})({accessToken:jwt}));
});

test('R75 explicitly undefined anonymity flag fails closed',async()=>{
  await rejected(verifier({...base,is_anonymous:undefined})({accessToken:jwt}));
});

test('R75 null anonymity flag fails closed',async()=>{
  await rejected(verifier({...base,is_anonymous:null})({accessToken:jwt}));
});

test('R75 string false anonymity flag fails closed',async()=>{
  await rejected(verifier({...base,is_anonymous:'false'})({accessToken:jwt}));
});

test('R75 anonymous true and numeric false flags fail closed',async()=>{
  for (const value of [true,0,1,[],{},'true']) {
    await rejected(verifier({...base,is_anonymous:value})({accessToken:jwt}));
  }
});

test('R75 rejected staff cannot reach tenant membership or database lookup',async()=>{
  for (const profile of [{id:SUB,aud:'authenticated'},{...base,is_anonymous:null},{...base,is_anonymous:true}]) {
    let providerCalls=0, staffAccessCalls=0, dbQueries=0;
    const auth=createCar02Authenticator({
      shopCode:SHOP,lineClientId:'fake-line-client-id', nowSeconds:()=>NOW,
      verifyLineIdToken:async()=>{throw Error('LINE not used');},
      verifyStaffJwt:verifier(profile,()=>providerCalls++),
      resolveLineCustomer:async()=>{throw Error('customer not used');},
      resolveStaffAccess:async()=>{staffAccessCalls++;dbQueries++;return {active:true,shopCode:SHOP,userSub:SUB,role:'owner'};}
    });
    await assert.rejects(
      auth(new Request('https://qa.invalid/api/car02',{headers:{authorization:'Bearer '+jwt}})),
      /CAR02_UNAUTHORIZED/
    );
    assert.equal(providerCalls,1);
    assert.equal(staffAccessCalls,0);
    assert.equal(dbQueries,0);
  }
});

test('R75 valid non-anonymous staff still requires shop-matched active membership',async()=>{
  const auth=createCar02Authenticator({
    shopCode:SHOP,lineClientId:'fake-line-client-id', nowSeconds:()=>NOW,
    verifyLineIdToken:async()=>{throw Error('LINE not used');},
    verifyStaffJwt:verifier(base),
    resolveLineCustomer:async()=>{throw Error('LINE not used');},
    resolveStaffAccess:async()=>({active:true,shopCode:'other_shop',userSub:SUB,role:'owner'})
  });
  await assert.rejects(auth(new Request('https://qa.invalid/api/car02',{headers:{authorization:'Bearer '+jwt}})),/CAR02_UNAUTHORIZED/);
});

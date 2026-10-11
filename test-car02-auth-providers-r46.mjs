import test from 'node:test';
import assert from 'node:assert/strict';
import {createLineIdTokenVerifierR46,createSupabaseStaffTokenVerifierR46,createLineCustomerResolverR46,createStaffAccessResolverR46} from './car02-auth-providers-r46.mjs';
const SHOP='street_house_kitsuki',SUB='11111111-1111-4111-8111-111111111111',CID='2010239091';
const fakeJWT=(payload)=>['eyJhbGciOiJIUzI1NiJ9',btoa(JSON.stringify(payload)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'),'c2lnbmF0dXJl'].join('.');
const claims={sub:SUB,iss:'https://example.supabase.co/auth/v1',aud:'authenticated',role:'authenticated',exp:3000};
const reply=(d,ok=true)=>({ok,json:async()=>d});
const line={sub:'Ufoo123',aud:CID,iss:'https://access.line.me',exp:3000};
const lineVerifier=(handler)=>createLineIdTokenVerifierR46({channelId:CID,fetchImpl:handler,nowSeconds:()=>1000});
const staffVerifier=(handler)=>createSupabaseStaffTokenVerifierR46({supabaseUrl:'https://example.supabase.co',anonKey:'test_anon_key_0123456789',fetchImpl:handler,nowSeconds:()=>1000});
test('LINE verifies through provider and validates issuer audience expiry',async()=>{
 let calls=0;const verifier=lineVerifier(async(url,options)=>{calls++;assert.equal(url,'https://api.line.me/oauth2/v2.1/verify');assert.equal(options.body.get('client_id'),CID);return reply(line)});
 assert.equal((await verifier({idToken:'fake-line-token',clientId:CID})).sub,line.sub);assert.equal(calls,1);
});
test('LINE mismatch client is rejected before network request',async()=>{
 const verifier=lineVerifier(()=>{throw Error('unexpected network')});
 await assert.rejects(verifier({idToken:'fake-line-token',clientId:'another'}),/CAR02_IDENTITY_REJECTED/);
});
test('LINE spoofed sub, issuer and expired token rejected',async()=>{
 for(const d of [{...line,sub:''},{...line,iss:'https://evil.test'},{...line,exp:999},{...line,aud:'other'}]){
  await assert.rejects(lineVerifier(async()=>reply(d))({idToken:'fake-line-token',clientId:CID}),/CAR02_IDENTITY_REJECTED/);
 }
});
test('LINE verifier rejects network errors and bad HTTP status without leaking',async()=>{
 for(const h of [async()=>{throw Error('secret credentials')},async()=>reply(line,false)])
  await assert.rejects(lineVerifier(h)({idToken:'fake-line-token',clientId:CID}),/CAR02_IDENTITY_REJECTED/);
});
test('Supabase Auth verifies session using provider, not JWT payload alone',async()=>{
 const token=fakeJWT(claims);let n=0;const verify=staffVerifier(async(url,opts)=>{n++;assert.equal(url,'https://example.supabase.co/auth/v1/user');assert.equal(opts.headers.Authorization,'Bearer '+token);return reply({id:SUB,aud:'authenticated',is_anonymous:false})});
 assert.deepEqual(await verify({accessToken:token}),{verified:true,sub:SUB,exp:3000});assert.equal(n,1);
});
test('Supabase Auth denies mismatched user ID even if provider returned 200',async()=>{
 const verify=staffVerifier(async()=>reply({id:'22222222-2222-4222-8222-222222222222',aud:'authenticated'}));await assert.rejects(verify({accessToken:fakeJWT(claims)}),/CAR02_IDENTITY_REJECTED/);
});
test('Supabase Auth denies invalid, expired or wrong issuer claims BEFORE provider call',async()=>{
 for(const data of [{...claims,exp:999},{...claims,iss:'https://evil.test/auth/v1'},{...claims,role:'service_role'}]){
  const verify=staffVerifier(()=>{throw Error('not called')});await assert.rejects(verify({accessToken:fakeJWT(data)}),/CAR02_IDENTITY_REJECTED/);
 }
});
test('Supabase Auth denies provider 401 even with well-shaped claims',async()=>{
 const verify=staffVerifier(async()=>reply({id:SUB,aud:'authenticated'},false));await assert.rejects(verify({accessToken:fakeJWT(claims)}),/CAR02_IDENTITY_REJECTED/);
});
test('line customer resolver only accepts exact single shop-identity row',async()=>{
 const queries=[];let rows=[{id:SUB,shop_code:SHOP,line_user_id:'Ufoo123',status:'LINE連携済み'}];const r=createLineCustomerResolverR46({pool:{query:async(sql,params)=>{queries.push({sql,params});return {rows}}}});
 assert.deepEqual(await r({shopCode:SHOP,lineSub:'Ufoo123'}),{active:true,customerId:SUB,shopCode:SHOP,lineSub:'Ufoo123'});
 assert.deepEqual(queries[0].params,[SHOP,'Ufoo123']);assert.match(queries[0].sql,/LIMIT 2/);
 rows=[];await assert.rejects(r({shopCode:SHOP,lineSub:'Ufoo123'}),/CAR02_IDENTITY_REJECTED/);
 rows=[{id:SUB,shop_code:SHOP,line_user_id:'Ufoo123'},{id:SUB,shop_code:SHOP,line_user_id:'Ufoo123'}];await assert.rejects(r({shopCode:SHOP,lineSub:'Ufoo123'}),/CAR02_IDENTITY_REJECTED/);
});
test('line customer resolver denies shop mismatch and uses no client-supplied id',async()=>{
 const r=createLineCustomerResolverR46({pool:{query:async()=>({rows:[{id:SUB,shop_code:'other_shop',line_user_id:'Ufoo123'}]})}});
 await assert.rejects(r({shopCode:SHOP,lineSub:'Ufoo123'}),/CAR02_IDENTITY_REJECTED/);
});
test('staff membership fails closed when no lookup configured',async()=>{
 const resolve=createStaffAccessResolverR46();await assert.rejects(resolve({userSub:SUB,shopCode:SHOP}),/CAR02_IDENTITY_REJECTED/);
});
test('staff membership only accepts exact active owner/staff for requested shop',async()=>{
 const r=createStaffAccessResolverR46({lookupMembership:async({shopCode})=>({active:true,userSub:SUB,shopCode,role:'staff'})});
 assert.equal((await r({userSub:SUB,shopCode:SHOP})).role,'staff');
 const bad=createStaffAccessResolverR46({lookupMembership:async()=>({active:true,userSub:SUB,shopCode:'other_shop',role:'owner'})});
 await assert.rejects(bad({userSub:SUB,shopCode:SHOP}),/CAR02_IDENTITY_REJECTED/);
});
test('R46 LINE verifier and customer resolver integrate into R44 authenticator',async()=>{
 const {createCar02Authenticator}=await import('./car02-identity-r44.mjs');
 const verify=createLineIdTokenVerifierR46({channelId:CID,fetchImpl:async()=>reply(line),nowSeconds:()=>1000});
 const resolve=createLineCustomerResolverR46({pool:{query:async()=>({rows:[{id:SUB,shop_code:SHOP,line_user_id:line.sub,status:'LINE連携済み'}]})}});
 const auth=createCar02Authenticator({shopCode:SHOP,lineClientId:CID,verifyLineIdToken:verify,verifyStaffJwt:async()=>{throw Error('unused')},resolveLineCustomer:resolve,resolveStaffAccess:createStaffAccessResolverR46(),nowSeconds:()=>1000});
 const identity=await auth(new Request('https://local.example/api/car02/1',{headers:{'X-Line-ID-Token':'fake-line-token'}}));
 assert.deepEqual({...identity},{verified:true,role:'customer',subject:'line:Ufoo123',shopCode:SHOP,customerId:SUB});
});
test('R46 verified staff Auth session without authoritative membership fails closed in R44 boundary',async()=>{
 const {createCar02Authenticator}=await import('./car02-identity-r44.mjs');
 const verify=staffVerifier(async()=>reply({id:SUB,aud:'authenticated'}));
 const auth=createCar02Authenticator({shopCode:SHOP,lineClientId:CID,verifyLineIdToken:async()=>{throw Error('unused')},verifyStaffJwt:verify,resolveLineCustomer:async()=>{throw Error('unused')},resolveStaffAccess:createStaffAccessResolverR46(),nowSeconds:()=>1000});
 await assert.rejects(auth(new Request('https://local.example/api/car02',{headers:{Authorization:'Bearer '+fakeJWT(claims)}})),/CAR02_UNAUTHORIZED/);
});
test('R46 DB staff membership read is shop-scoped, exact, and parameterized',async()=>{
 const {createDbStaffMembershipLookupR46}=await import('./car02-auth-providers-r46.mjs');
 const seen=[]; const lookup=createDbStaffMembershipLookupR46({pool:{query:async(sql,params)=>{seen.push({sql,params});return {rows:[{shop_code:SHOP,user_sub:SUB,staff_role:'owner',active:true}]}}}});
 const result=await lookup({shopCode:SHOP,userSub:SUB});assert.equal(result.role,'owner');assert.deepEqual(seen[0].params,[SHOP,SUB]);assert.match(seen[0].sql,/WHERE shop_code=\$1 AND user_sub=\$2/);
});
test('R46 DB staff rejects unknown, disabled, and cross-tenant grants',async()=>{
 const {createDbStaffMembershipLookupR46}=await import('./car02-auth-providers-r46.mjs');
 for(const rows of [[],[{shop_code:SHOP,user_sub:SUB,staff_role:'owner',active:false}],[{shop_code:'other_shop',user_sub:SUB,staff_role:'owner',active:true}]]){
   const f=createDbStaffMembershipLookupR46({pool:{query:async()=>({rows})}});
   await assert.rejects(f({shopCode:SHOP,userSub:SUB}),/CAR02_IDENTITY_REJECTED/);
 }
});
test('R46 assembled runtime requires explicit server release state',async()=>{
 const {createCar02VerifiedRuntimeR46}=await import('./car02-runtime-verified-r46.mjs');
 const args={pool:{connect:async()=>{throw Error('must not connect')},query:async()=>{throw Error('must not query')}},shopCode:SHOP,lineChannelId:CID,supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'test_anon_key_0123456789'};
 assert.throws(()=>createCar02VerifiedRuntimeR46(args),/CAR02_RELEASE_GATE_REQUIRED/);
 const runtime=createCar02VerifiedRuntimeR46({...args,releaseState:{systemCode:'CAR02',contracted:false},allowedOrigins:['https://dpromstk2000-lab.github.io'],fetchImpl:async()=>{throw Error('must not fetch')}});
 const response=await runtime(new Request('https://qa.example/api/car02',{method:'POST',headers:{Origin:'https://dpromstk2000-lab.github.io','Content-Type':'application/json'},body:JSON.stringify({customerId:SUB,vehicleId:SUB})}));
 assert.equal(response.status,503);assert.equal((await response.json()).code,'CAR02_NOT_RELEASED');
});

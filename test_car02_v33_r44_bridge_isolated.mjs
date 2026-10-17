/** Real checked-out R44 invocation using injected FAKE signed-verifier.
 * Only in node:test. Neither LINE nor Supabase nor Worker is contacted.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCar02Authenticator,createCar02ReleaseGate} from './car02-identity-r44.mjs';
import {createV33QaStaffClaimsGuard,V33_MODE} from './car02-v33-staff-jwt-claims-isolated.mjs';
const NOW=1800000000,SHOP='street_house_kitsuki',ISS='https://auth.qa.invalid',AUD='car02-staff-qa',ALG='RS256';
const C='11111111-1111-4111-8111-111111111111';
const good={verified:true,iss:ISS,aud:AUD,alg:ALG,sub:'staff-qa-1',iat:NOW-5,nbf:NOW-5,exp:NOW+120};
const build=({claims=good,staff={},fakeSignedVerifier,config={}}={})=>{
 const guard=createV33QaStaffClaimsGuard({environment:'isolated_qa',allowIsolatedQa:true,
  verifySignedJwt:fakeSignedVerifier??(async()=>claims),trustedIssuer:ISS,trustedAudience:AUD,
  expectedAlgorithm:ALG,nowSeconds:()=>NOW,...config});
 return createCar02Authenticator({shopCode:SHOP,lineClientId:'line-qa-client',verifyStaffJwt:guard,
  verifyLineIdToken:async()=>{throw Error('No LINE calls in this test')},
  resolveLineCustomer:async()=>{throw Error('No LINE member lookups in this test')},
  resolveStaffAccess:async({userSub,shopCode})=>({active:true,userSub,shopCode,role:'staff',...staff}),
  nowSeconds:()=>NOW});
};
const req=(headers={'authorization':'Bearer qaStaffTokenVeryLong123'})=>new Request('https://qa.invalid/api/car02',{headers});
const fails=async opts=>assert.rejects(()=>build(opts)(req()),/CAR02_UNAUTHORIZED/);
const cases=[];const add=(n,fn)=>cases.push([n,fn]);
add('strict guard returns server-derived verified R44 staff',async()=>{
 const a=await build()(req());assert.equal(a.role,'staff');assert.equal(a.shopCode,SHOP);
 assert.equal(a.subject,'staff:staff-qa-1');assert.equal(a.verified,true);
});
add('R44 accepts trusted owner resolver for same shop',async()=>{
 const a=await build({staff:{role:'owner'}})(req());assert.equal(a.role,'owner');
});
add('issuer mismatch denied through R44',async()=>fails({claims:{...good,iss:'https://other.invalid'}}));
add('audience mismatch denied through R44',async()=>fails({claims:{...good,aud:'foreign-audience'}}));
add('JWT algorithm mismatch denied through R44',async()=>fails({claims:{...good,alg:'none'}}));
add('future nbf denied through R44',async()=>fails({claims:{...good,nbf:NOW+1}}));
add('future iat denied through R44',async()=>fails({claims:{...good,iat:NOW+1}}));
add('expired JWT denied through R44',async()=>fails({claims:{...good,exp:NOW}}));
add('long lifetime denied through R44',async()=>fails({claims:{...good,exp:NOW+4000}}));
add('failed signature callback denied through R44',async()=>fails({fakeSignedVerifier:async()=>{throw Error('bad signature')}}));
add('unverified signature callback denied through R44',async()=>fails({claims:{...good,verified:false}}));
add('wrong-shop resolver denied through R44',async()=>fails({staff:{shopCode:'other_shop'}}));
add('disabled staff resolver denied through R44',async()=>fails({staff:{active:false}}));
add('forged role denied through R44',async()=>fails({staff:{role:'customer'}}));
add('staff identity mismatch denied through R44',async()=>fails({staff:{userSub:'other'}}));
add('duplicate credentials denied through R44',async()=>{
 const h={'authorization':'Bearer qaStaffTokenVeryLong123','x-line-id-token':'lineTokenVeryLong123'};
 await assert.rejects(()=>build()(req(h)),/CAR02_UNAUTHORIZED/);
});
add('no credential denied through R44',async()=>assert.rejects(()=>build()(req({})),/CAR02_UNAUTHORIZED/));
add('QA guard can never approve production regardless of valid staff JWT',async()=>{
 const a=await build()(req());assert.equal(a.verified,true);assert.equal(V33_MODE.productionReady,false);
 assert.equal(V33_MODE.release,'NO_GO');
 const gated=createCar02ReleaseGate({systemCode:'CAR02',contracted:true,goLiveApproved:false,
  migrationVerified:true,verifiedIdentityBound:true,workerBackendReady:true,externalNotificationsReviewed:true});
 assert.equal(await gated(),false);
});
for(const [n,fn] of cases)test(n,fn);

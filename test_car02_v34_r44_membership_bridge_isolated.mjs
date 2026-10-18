/** DPRO CAR02 V3.4 — R44 bridge integration, in-memory QA ONLY. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCar02Authenticator,createCar02ReleaseGate} from './car02-identity-r44.mjs';
import {createV33QaStaffClaimsGuard} from './car02-v33-staff-jwt-claims-isolated.mjs';
import {createV34QaStaffMembershipResolver,V34_MODE} from './car02-v34-staff-membership-isolated.mjs';
const NOW=1800000000,SHOP='qa-shop-a',ISS='https://auth.qa.invalid';
const SUB='staff-qa',AUD='car02-qa-aud',MID='11111111-1111-4111-8111-111111111111';
const base={membershipId:MID,shopCode:SHOP,userSub:SUB,role:'staff',active:true,
 suspended:false,revokedAt:null,authVersion:1,validFrom:NOW-10,validUntil:NOW+600};
const claims={verified:true,iss:ISS,aud:AUD,alg:'RS256',sub:SUB,
 iat:NOW-3,nbf:NOW-3,exp:NOW+300};
const request=(h={authorization:'Bearer syntheticStaffToken_1234'})=>new Request('https://qa.invalid/api/car02',{headers:h});
function make({records=[base],signedClaims=claims,shopCode=SHOP,reader,verifySignedJwt}={}){
 let readCount=0;
 const read=async ctx=>{readCount++;return reader?reader(ctx):records;};
 const resolver=createV34QaStaffMembershipResolver({environment:'isolated_qa',allowIsolatedQa:true,
  readMembership:read,nowSeconds:()=>NOW});
 const guard=createV33QaStaffClaimsGuard({environment:'isolated_qa',allowIsolatedQa:true,
  verifySignedJwt:verifySignedJwt??(async()=>signedClaims),trustedIssuer:ISS,
  trustedAudience:AUD,expectedAlgorithm:'RS256',nowSeconds:()=>NOW});
 const authenticate=createCar02Authenticator({shopCode,lineClientId:'line-qa-client',
  verifyStaffJwt:guard,resolveStaffAccess:resolver,
  verifyLineIdToken:async()=>{throw Error('NEVER_CALL_LINE')},
  resolveLineCustomer:async()=>{throw Error('NEVER_CALL_CUSTOMER')},nowSeconds:()=>NOW});
 return {authenticate,get readCount(){return readCount}};
}
const denied=async(m,h)=>assert.rejects(()=>m.authenticate(request(h)),e=>e.code==='CAR02_UNAUTHORIZED');
test('same shop verified staff accepted with minimal R44 principal',async()=>{
 const m=make(),a=await m.authenticate(request());
 assert.deepEqual(a,{verified:true,role:'staff',subject:'staff:'+SUB,shopCode:SHOP});
 assert(Object.isFrozen(a));assert.equal(m.readCount,1);
});
test('same shop owner derives role from DB, not client',async()=>{
 const m=make({records:[{...base,role:'owner'}]});
 assert.equal((await m.authenticate(request({authorization:'Bearer syntheticStaffToken_1234',
  'x-client-role':'staff'}))).role,'owner');
});
test('client role header cannot upgrade stored staff',async()=>{
 const m=make();assert.equal((await m.authenticate(request({authorization:'Bearer syntheticStaffToken_1234',
  'x-client-role':'owner'}))).role,'staff');
});
test('revoked membership denies valid signed claims',async()=>denied(make({records:[{...base,revokedAt:NOW}]})));
test('suspended membership denies valid signed claims',async()=>denied(make({records:[{...base,suspended:true}]})));
test('inactive membership denies valid signed claims',async()=>denied(make({records:[{...base,active:false}]})));
test('foreign shop membership denies valid signed claims',async()=>denied(make({records:[{...base,shopCode:'qa-shop-other'}]})));
test('foreign subject membership denies valid signed claims',async()=>denied(make({records:[{...base,userSub:'another'}]})));
test('owner cannot cross-tenant just by selecting a shop',async()=>{
 const m=make({shopCode:'qa-shop-other',records:[{...base,role:'owner'}]});await denied(m);
});
test('duplicate records fail closed even when individually active',async()=>denied(make({records:[base,base]})));
test('missing record fails closed',async()=>denied(make({records:[]})));
test('read failure never reveals database exception',async()=>{
 const m=make({reader:async()=>{throw Error('secret DB string')}});
 await assert.rejects(()=>m.authenticate(request()),e=>e.message==='CAR02_UNAUTHORIZED');
});
test('read-through revocation prevents cached positive authorization',async()=>{
 let row={...base};const m=make({reader:async()=>[row]});
 await m.authenticate(request());row={...row,revokedAt:NOW};await denied(m);
 assert.equal(m.readCount,2);
});
test('staff role downgrade becomes effective next request',async()=>{
 let row={...base,role:'owner'};const m=make({reader:async()=>[row]});
 assert.equal((await m.authenticate(request())).role,'owner');
 row={...row,role:'staff'};
 assert.equal((await m.authenticate(request())).role,'staff');assert.equal(m.readCount,2);
});
test('expired membership denies even when JWT has not expired',async()=>denied(make({records:[{...base,validUntil:NOW}]})));
test('failed synthetic signature stops before membership DB lookup',async()=>{
 const m=make({verifySignedJwt:async()=>{throw Error('wrong signature')}});
 await denied(m);assert.equal(m.readCount,0);
});
test('simultaneous LINE id token and staff bearer rejected',async()=>{
 const m=make();await denied(m,{authorization:'Bearer syntheticStaffToken_1234',
  'x-line-id-token':'syntheticLineToken123'});assert.equal(m.readCount,0);
});
test('V3.4 QA never approves live release, regardless of staff authorization',async()=>{
 const m=make();await m.authenticate(request());assert.equal(V34_MODE.productionReady,false);
 const gate=createCar02ReleaseGate({systemCode:'CAR02',contracted:true,goLiveApproved:false,
  migrationVerified:true,verifiedIdentityBound:true,workerBackendReady:true,externalNotificationsReviewed:true});
 assert.equal(await gate(),false);
});

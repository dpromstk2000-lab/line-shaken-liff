/**
 * DPRO CAR02 R256 — synthetic identity-to-HTTP-to-domain contract QA.
 * Uses the ORIGINAL R41, R43, R44 source files, checked by Git blob SHA.
 * WARNING: all token verification and persistence are fixture-only.
 * This file is NOT an authentication provider, server, deployable Worker,
 * Supabase project, real booking service, or permission to release CAR02.
 */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {test} from 'node:test';
import {Car02Error,createCar02Service} from './car02-core.mjs';
import {createCar02Api} from './car02-api.mjs';
import {createCar02Authenticator,createCar02ReleaseGate} from './car02-identity-r44.mjs';

assert.equal(process.env.CAR02_RELEASE_LOCK,'true','R256 global production release remains locked');
assert.equal(process.env.CAR02_R256_ISOLATED,'yes','R256 only in offline synthetic QA');
assert.notEqual(process.env.NODE_ENV,'production','R256 must never run in production');
const SHOP='shop_alpha',CHANNEL='qa-client-id';
const NOW=1790000000;
const CUSTOMER='11111111-1111-4111-8111-111111111111';
const FOREIGN_CUSTOMER='22222222-2222-4222-8222-222222222222';
const VEHICLE='33333333-3333-4333-8333-333333333333';
const ORIGIN='https://preview.invalid';
const clone=x=>structuredClone(x);
const owner='fixture-owner-jwt', staff='fixture-staff-jwt', stranger='fixture-foreign-jwt';
const lineOwned='fixture-line-token-owned',lineOther='fixture-line-token-other';
const yes={systemCode:'CAR02',contracted:true,goLiveApproved:true,migrationVerified:true,
  verifiedIdentityBound:true,workerBackendReady:true,externalNotificationsReviewed:true};
function storeFixture(){
 let orders=new Map(),receipts=new Map(),mutations=0;
 return {
   async lookup(shop,id){const r=orders.get(id);return r?.shop===shop?clone(r):null;},
   async history(shop,id){const r=orders.get(id);return r?.shop===shop?clone(r.events):[];},
   async transaction({actor,shop,key,intent},fn){
     const identity=`${shop}/${key}`;
     const hash=createHash('sha256').update(JSON.stringify({actor,shop,intent})).digest('hex');
     const old=receipts.get(identity);
     if(old){if(old.hash!==hash)throw new Car02Error('CAR02_IDEMPOTENCY_CONFLICT',409);return clone(old.value);}
     let staged=new Map([...orders].map(([k,v])=>[k,clone(v)]));
     const tx={
       now:()=>new Date('2026-10-15T01:00:00Z').toISOString(),
       async assertLinks({shop:s,customerId,vehicleId,reservationId}){
         if(s!==shop||customerId!==CUSTOMER||vehicleId!==VEHICLE||reservationId!==null)
           throw new Car02Error('CAR02_SYNTHETIC_LINK_DENIED',403);
       },
       async getForUpdate(id){const r=staged.get(id);return r?.shop===shop?clone(r):null;},
       async assertReadyPhotos({ids}){if(ids.length)throw new Car02Error('CAR02_PHOTOS_UNVERIFIED',409);},
       async create(value){const r={id:randomUUID(),...clone(value)};staged.set(r.id,clone(r));return clone(r);},
       async save(value){staged.set(value.id,clone(value));return clone(value)}
     };
     const value=await fn(tx);orders=staged;mutations++;receipts.set(identity,{hash,value:clone(value)});
     return clone(value);
   },
   stats:()=>({orders:orders.size,mutations,receipts:receipts.size})
 };
}
function fixture(){
 const db=storeFixture();const state={...yes,goLiveApproved:false};
 let authInvocations=0,providerInvocations=0;
 const staffAccess=new Map([
  ['user-owner',{active:true,userSub:'user-owner',shopCode:SHOP,role:'owner'}],
  ['user-staff',{active:true,userSub:'user-staff',shopCode:SHOP,role:'staff'}],
  ['user-foreign',{active:true,userSub:'user-foreign',shopCode:'shop_beta',role:'owner'}]
 ]);
 const linked=new Map([
  ['synthetic-line-owned',{active:true,shopCode:SHOP,lineSub:'synthetic-line-owned',customerId:CUSTOMER}],
  ['synthetic-line-other',{active:true,shopCode:SHOP,lineSub:'synthetic-line-other',customerId:FOREIGN_CUSTOMER}]
 ]);
 const validJwt=new Map([[owner,'user-owner'],[staff,'user-staff'],[stranger,'user-foreign']]);
 const validLine=new Map([[lineOwned,'synthetic-line-owned'],[lineOther,'synthetic-line-other']]);
 const authenticate=createCar02Authenticator({shopCode:SHOP,lineClientId:CHANNEL,nowSeconds:()=>NOW,
  verifyStaffJwt:async({accessToken})=>{providerInvocations++;const sub=validJwt.get(accessToken);return sub?{verified:true,sub,exp:NOW+3600}:null;},
  resolveStaffAccess:async({userSub})=>staffAccess.get(userSub)||null,
  verifyLineIdToken:async({idToken,clientId})=>{providerInvocations++;const sub=validLine.get(idToken);
    if(idToken==='fixture-line-wrong-audience')return {sub:'synthetic-line-owned',aud:'wrong',iss:'https://access.line.me',exp:NOW+100};
    if(idToken==='fixture-line-wrong-issuer')return {sub:'synthetic-line-owned',aud:CHANNEL,iss:'https://attacker.invalid',exp:NOW+100};
    if(idToken==='fixture-line-expired')return {sub:'synthetic-line-owned',aud:CHANNEL,iss:'https://access.line.me',exp:NOW-1};
    return sub?{sub,aud:clientId,iss:'https://access.line.me',exp:NOW+3600}:null;
  },
  resolveLineCustomer:async({lineSub})=>linked.get(lineSub)||null
 });
 const wrapped=async(req)=>{authInvocations++;return authenticate(req)};
 const service=createCar02Service(db);
 const releaseEnabled=createCar02ReleaseGate(()=>state);
 const handle=createCar02Api({service,authenticate:wrapped,releaseEnabled,allowedOrigins:[ORIGIN]});
 async function call({token=owner,lineToken='',method='GET',path='/api/car02',body=null,key='',headers={},requestOrigin=ORIGIN}={}){
  const h={...headers};if(requestOrigin)h.origin=requestOrigin;
  if(token)h.authorization='Bearer '+token;
  if(lineToken)h['x-line-id-token']=lineToken;
  if(key)h['idempotency-key']=key;
  if(body!==null)h['content-type']='application/json';
  const req=new Request(ORIGIN+path,{method,headers:h,...(body!==null?{body:JSON.stringify(body)}:{})});
  const response=await handle(req);return {status:response.status,body:await response.json()};
 }
 return {call,db,state,linked,staffAccess,authInvocations:()=>authInvocations,
  providerInvocations:()=>providerInvocations,openSyntheticGate(){Object.assign(state,yes)},closeGate(){state.goLiveApproved=false}};
}
const key=n=>`isolated-request-idempotency-${n}-000000`;
const createBody={customerId:CUSTOMER,vehicleId:VEHICLE,reservationId:null};
const idPath=id=>'/api/car02/'+id;

// Tests deliberately use only synthetic tokens and an isolated in-memory store.
test('server release gate blocks requests BEFORE authentication, no DB mutation',async()=>{
 const f=fixture();const result=await f.call({method:'POST',body:createBody,key:key(1)});
 assert.equal(result.status,503);assert.equal(result.body.code,'CAR02_NOT_RELEASED');
 assert.equal(f.authInvocations(),0);assert.equal(f.providerInvocations(),0);assert.equal(f.db.stats().mutations,0);
});

test('server-verified owner and server-linked LINE customer complete a photo-free journey',async()=>{
 const f=fixture();f.openSyntheticGate();
 const created=await f.call({method:'POST',body:createBody,key:key(2)});
 assert.equal(created.status,200);assert.equal(created.body.data.status,'draft');
 const id=created.body.data.id;
 const report=await f.call({method:'POST',path:idPath(id)+'/report',body:{observation:'Synthetic inspection finished',photos:[],expectedVersion:1},key:key(3)});
 assert.equal(report.status,200);
 const quote=await f.call({method:'POST',path:idPath(id)+'/quote',body:{items:[{name:'Synthetic part',price:10000}],expectedVersion:2},key:key(4)});
 assert.equal(quote.status,200);assert.equal(quote.body.data.quote.total,11000);
 const detail=await f.call({token:'',lineToken:lineOwned,path:idPath(id)});
 assert.equal(detail.status,200);assert.equal(detail.body.data.customerId,CUSTOMER);
 const choice=await f.call({token:'',lineToken:lineOwned,method:'POST',path:idPath(id)+'/decision',body:{decision:'approved',reason:'',expectedVersion:3},key:key(5)});
 assert.equal(choice.status,200);
 const completed=await f.call({method:'POST',path:idPath(id)+'/complete',body:{expectedVersion:4},key:key(6)});
 assert.equal(completed.status,200);assert.equal(completed.body.data.status,'completed');
 assert.deepEqual(f.db.stats(),{orders:1,mutations:5,receipts:5});
});

test('LINE customer cannot create work orders or access other customer records',async()=>{
 const f=fixture();f.openSyntheticGate();
 const created=await f.call({method:'POST',body:createBody,key:key(7)}),id=created.body.data.id;
 const unauthorized=await f.call({token:'',lineToken:lineOther,path:idPath(id)});
 assert.equal(unauthorized.status,403);
 const attemptedCreate=await f.call({token:'',lineToken:lineOwned,method:'POST',body:createBody,key:key(8)});
 assert.equal(attemptedCreate.status,403);
 assert.deepEqual(f.db.stats(),{orders:1,mutations:1,receipts:1});
});

test('unverified, expired, incorrect-audience and incorrect-issuer tokens fail closed',async()=>{
 const f=fixture();f.openSyntheticGate();
 for(const credentials of [
  {token:'fixture-forged-owner'},
  {token:''},
  {token:'Bearer broken'},
  {token:'',lineToken:'fixture-line-wrong-audience'},
  {token:'',lineToken:'fixture-line-wrong-issuer'},
  {token:'',lineToken:'fixture-line-expired'}
 ]){
  const result=await f.call({...credentials,path:'/api/car02/11111111-1111-4111-8111-111111111111'});
  assert.equal(result.status,401,JSON.stringify(credentials));
  assert.equal(result.body.code,'CAR02_UNAUTHORIZED');
 }
 assert.equal(f.db.stats().mutations,0);
});

test('both credential types are rejected and client-side role/shop headers never grant access',async()=>{
 const f=fixture();f.openSyntheticGate();
 const both=await f.call({token:owner,lineToken:lineOwned});assert.equal(both.status,401);
 const fake=await f.call({token:'fixture-forged-owner',method:'POST',body:createBody,key:key(9),headers:{'x-role':'owner','x-shop-code':SHOP}});
 assert.equal(fake.status,401);
 const clientBody=await f.call({method:'POST',body:{...createBody,role:'owner',shopCode:SHOP},key:key(10)});
 assert.equal(clientBody.status,422);
 assert.equal(f.db.stats().mutations,0);
});

test('foreign-shop staff membership cannot impersonate a local owner',async()=>{
 const f=fixture();f.openSyntheticGate();
 const result=await f.call({token:stranger,method:'POST',body:createBody,key:key(11)});
 assert.equal(result.status,401);assert.equal(f.db.stats().mutations,0);
});

test('revoke staff or LINE membership => access stops at the next request',async()=>{
 const f=fixture();f.openSyntheticGate();
 const created=await f.call({method:'POST',body:createBody,key:key(12)});const id=created.body.data.id;
 assert.equal((await f.call({token:staff,path:idPath(id)})).status,200);
 f.staffAccess.set('user-staff',{active:false,userSub:'user-staff',shopCode:SHOP,role:'staff'});
 assert.equal((await f.call({token:staff,path:idPath(id)})).status,401);
 assert.equal((await f.call({token:'',lineToken:lineOwned,path:idPath(id)})).status,200);
 f.linked.set('synthetic-line-owned',{active:false,lineSub:'synthetic-line-owned',shopCode:SHOP,customerId:CUSTOMER});
 assert.equal((await f.call({token:'',lineToken:lineOwned,path:idPath(id)})).status,401);
 assert.deepEqual(f.db.stats(),{orders:1,mutations:1,receipts:1});
});

test('staff cannot approve a quote as the customer; relock blocks subsequent reads',async()=>{
 const f=fixture();f.openSyntheticGate();
 const created=await f.call({method:'POST',body:createBody,key:key(13)});const id=created.body.data.id;
 await f.call({method:'POST',path:idPath(id)+'/report',body:{observation:'Synthetic inspected',photos:[],expectedVersion:1},key:key(14)});
 await f.call({method:'POST',path:idPath(id)+'/quote',body:{items:[{name:'Synthetic item',price:5000}],expectedVersion:2},key:key(15)});
 const denied=await f.call({token:staff,method:'POST',path:idPath(id)+'/decision',body:{decision:'approved',reason:'',expectedVersion:3},key:key(16)});
 assert.equal(denied.status,403);
 f.closeGate();const before=f.authInvocations();
 const locked=await f.call({token:owner,path:idPath(id)});
 assert.equal(locked.status,503);assert.equal(f.authInvocations(),before);assert.equal(f.db.stats().mutations,3);
});

test('unapproved origin, URL query, and unknown route are denied without leaking tokens',async()=>{
 const f=fixture();f.openSyntheticGate();
 const a=await f.call({path:'/api/car02',requestOrigin:'https://attacker.invalid'});
 const b=await f.call({path:'/api/car02?approve=true'});
 const c=await f.call({path:'/api/not-car02'});
 assert.deepEqual([a.status,b.status,c.status],[403,400,404]);
 for(const r of [a,b,c]){
  const serialized=JSON.stringify(r.body);
  assert.equal(serialized.includes(owner),false);assert.equal(serialized.includes('fixture-line-token'),false);
 }
});
console.log('R256_SYNTHETIC_IDENTITY_HTTP_CORE_CONTRACT_ONLY_NO_GO_HOLD');

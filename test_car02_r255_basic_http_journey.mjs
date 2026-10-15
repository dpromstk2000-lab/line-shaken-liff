/**
 * DPRO CAR02 R255 — SYNTHETIC, IN-PROCESS HTTP/DOMAIN INTEGRATION QA ONLY.
 * Imports the unmodified R41 domain and R43 HTTP router. No production server,
 * provider identity, storage, Worker deploy, SQL, LINE, or real customer data.
 * Test-only fake credentials MUST NEVER be exposed as a runtime or deployed.
 */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {test} from 'node:test';
import {createCar02Api} from './car02-api.mjs';
import {createCar02Service,Car02Error} from './car02-core.mjs';

assert.equal(process.env.CAR02_RELEASE_LOCK,'true','R255 requires release lock');
assert.equal(process.env.CAR02_R255_ISOLATED,'yes','R255 isolated QA only');
if(process.env.NODE_ENV==='production')throw Error('R255_PRODUCTION_DENIED');

const shop='shop_alpha';
const customerId='11111111-1111-4111-8111-111111111111';
const otherCustomerId='22222222-2222-4222-8222-222222222222';
const vehicleId='33333333-3333-4333-8333-333333333333';
const origin='https://qa.example.invalid';
const actors=Object.freeze({
 'fixture-owner':Object.freeze({verified:true,role:'owner',subject:'qa:owner',shopCode:shop}),
 'fixture-staff':Object.freeze({verified:true,role:'staff',subject:'qa:staff',shopCode:shop}),
 'fixture-customer':Object.freeze({verified:true,role:'customer',subject:'qa:customer',shopCode:shop,customerId}),
 'fixture-other-customer':Object.freeze({verified:true,role:'customer',subject:'qa:other',shopCode:shop,customerId:otherCustomerId}),
 'fixture-foreign-owner':Object.freeze({verified:true,role:'owner',subject:'qa:foreign',shopCode:'shop_beta'})
});
const clone=x=>structuredClone(x);
function dbFixture(){
 let rows=new Map(),receipts=new Map(),mutations=0;
 return {
  async lookup(s,id){const o=rows.get(id);return o?.shop===s?clone(o):null;},
  async history(s,id){const o=rows.get(id);return o?.shop===s?clone(o.events):[];},
  async transaction({actor,shop:s,key,intent},f){
   const replayKey=`${s}|${key}`;
   const hash=createHash('sha256').update(JSON.stringify({shop:s,subject:actor.subject,role:actor.role,intent})).digest('hex');
   const prior=receipts.get(replayKey);
   if(prior){if(prior.hash!==hash)throw new Car02Error('CAR02_IDEMPOTENCY_CONFLICT',409);return clone(prior.value);}
   const staged=new Map([...rows].map(([k,v])=>[k,clone(v)]));
   const tx={
    now:()=>new Date('2026-10-15T00:00:00Z').toISOString(),
    async assertLinks({shop:scope,customerId:cid,vehicleId:vid,reservationId:rid}){
     if(scope!==s||cid!==customerId||vid!==vehicleId||rid!==null)
      throw new Car02Error('CAR02_SCOPE_DENIED',403);
    },
    async getForUpdate(id){const v=staged.get(id);return v?.shop===s?clone(v):null;},
    async assertReadyPhotos({ids}){if(ids.length)throw new Car02Error('CAR02_PHOTO_UNAVAILABLE',409);},
    async create(input){const value={id:randomUUID(),...clone(input)};staged.set(value.id,clone(value));return clone(value);},
    async save(value){staged.set(value.id,clone(value));return clone(value)}
   };
   const value=await f(tx);
   rows=staged;receipts.set(replayKey,{hash,value:clone(value)});mutations++;
   return clone(value);
  },
  stats:()=>({rows:rows.size,receipts:receipts.size,mutations}),
 };
}
function fixture(){
 const db=dbFixture();let open=false,authCalls=0;
 const service=createCar02Service(db);
 const handle=createCar02Api({service,allowedOrigins:[origin],
  releaseEnabled:async()=>open,
  authenticate:async req=>{authCalls++;return actors[req.headers.get('x-qa-actor')]||null;}
 });
 async function call({actor='fixture-owner',method='GET',path='/api/car02',key='',body=null,requestOrigin=origin,headers={}}={}){
  const h={'x-qa-actor':actor,...headers};
  if(requestOrigin)h.origin=requestOrigin;
  if(key)h['idempotency-key']=key;
  if(body!==null)h['content-type']='application/json';
  const req=new Request('https://qa.example.invalid'+path,{method,headers:h,...(body!==null?{body:JSON.stringify(body)}:{})});
  const res=await handle(req);const data=await res.json();return {status:res.status,...data};
 }
 return {call,db,open:()=>{open=true},close:()=>{open=false},authCalls:()=>authCalls};
}
const k=n=>`synthetic-idempotency-key-${n}-0001`;
const rpath=id=>`/api/car02/${id}`;
const createBody={customerId,vehicleId,reservationId:null};

test('locked gate rejects before authentication and leaves storage empty',async()=>{
 const h=fixture();const before=h.authCalls();
 const r=await h.call({method:'POST',key:k(1),body:createBody});
 assert.equal(r.status,503);assert.equal(r.code,'CAR02_NOT_RELEASED');
 assert.equal(h.authCalls(),before);assert.equal(h.db.stats().rows,0);
});

test('full business HTTP journey: create, report, quote, customer approve, complete, history',async()=>{
 const h=fixture();h.open();
 const create=await h.call({method:'POST',key:k(2),body:createBody});
 assert.equal(create.status,200);assert.equal(create.data.status,'draft');assert.equal(create.data.version,1);
 const id=create.data.id;
 const report=await h.call({method:'POST',path:rpath(id)+'/report',key:k(3),body:{observation:'Synthetic brake inspection complete',photos:[],expectedVersion:1}});
 assert.equal(report.status,200);assert.equal(report.data.version,2);
 const quote=await h.call({method:'POST',path:rpath(id)+'/quote',key:k(4),body:{items:[{name:'synthetic pad',price:10000}],expectedVersion:2}});
 assert.equal(quote.status,200);assert.equal(quote.data.status,'pending');assert.equal(quote.data.quote.total,11000);
 const get=await h.call({actor:'fixture-customer',path:rpath(id)});
 assert.equal(get.status,200);assert.equal(get.data.quote.total,11000);
 const decide=await h.call({actor:'fixture-customer',method:'POST',path:rpath(id)+'/decision',key:k(5),body:{decision:'approved',reason:'',expectedVersion:3}});
 assert.equal(decide.status,200);assert.equal(decide.data.status,'approved');
 const complete=await h.call({method:'POST',path:rpath(id)+'/complete',key:k(6),body:{expectedVersion:4}});
 assert.equal(complete.status,200);assert.equal(complete.data.status,'completed');
 const history=await h.call({path:rpath(id)+'/history'});
 assert.equal(history.status,200);assert.deepEqual(history.data.map(e=>e.type),['created','report_saved','quote_presented','quote_approved','completed']);
 assert.deepEqual(h.db.stats(),{rows:1,receipts:5,mutations:5});
});

test('declined quote remains non-completable and needs reviewed re-quote design',async()=>{
 const h=fixture();h.open();
 const create=await h.call({method:'POST',key:k(15),body:createBody});const id=create.data.id;
 await h.call({method:'POST',path:rpath(id)+'/report',key:k(16),body:{observation:'Synthetic service observation',photos:[],expectedVersion:1}});
 await h.call({method:'POST',path:rpath(id)+'/quote',key:k(17),body:{items:[{name:'synthetic item',price:5000}],expectedVersion:2}});
 const no=await h.call({actor:'fixture-customer',method:'POST',path:rpath(id)+'/decision',key:k(18),body:{decision:'declined',reason:'Synthetic price concern',expectedVersion:3}});
 assert.equal(no.status,200);assert.equal(no.data.status,'declined');
 const cannotComplete=await h.call({method:'POST',path:rpath(id)+'/complete',key:k(19),body:{expectedVersion:4}});
 assert.equal(cannotComplete.status,409);assert.equal(cannotComplete.code,'CAR02_STATE_CONFLICT');
 const reQuote=await h.call({method:'POST',path:rpath(id)+'/quote',key:k(20),body:{items:[{name:'revised item',price:4000}],expectedVersion:4}});
 assert.equal(reQuote.status,409);assert.equal(reQuote.code,'CAR02_STATE_CONFLICT');
 assert.equal(h.db.stats().mutations,4);
});

test('replay same idempotency key is read-only; altered intent fails',async()=>{
 const h=fixture();h.open();
 const one=await h.call({method:'POST',key:k(7),body:createBody});
 const two=await h.call({method:'POST',key:k(7),body:createBody});
 assert.deepEqual(one,two);assert.equal(h.db.stats().mutations,1);
 const collision=await h.call({method:'POST',key:k(7),body:{...createBody,vehicleId:'44444444-4444-4444-8444-444444444444'}});
 assert.equal(collision.status,409);assert.equal(collision.code,'CAR02_IDEMPOTENCY_CONFLICT');
 assert.equal(h.db.stats().mutations,1);
});

test('wrong customer, foreign tenant, and unverified identity are denied',async()=>{
 const h=fixture();h.open();const created=await h.call({method:'POST',key:k(8),body:createBody});const id=created.data.id;
 for(const actor of ['fixture-other-customer','fixture-foreign-owner','not-a-fixture']){
  const read=await h.call({actor,path:rpath(id)});
  assert.equal(read.status,actor==='not-a-fixture'?401:actor==='fixture-foreign-owner'?404:403);
 }
 const act=await h.call({actor:'fixture-other-customer',method:'POST',path:rpath(id)+'/decision',key:k(9),body:{decision:'approved',reason:'',expectedVersion:1}});
 assert.notEqual(act.status,200);
 assert.deepEqual(h.db.stats(),{rows:1,receipts:1,mutations:1});
});

test('stale version, forbidden photo, missing key, client role injection all fail closed',async()=>{
 const h=fixture();h.open();const created=await h.call({method:'POST',key:k(10),body:createBody});const id=created.data.id;
 const stale=await h.call({method:'POST',path:rpath(id)+'/report',key:k(11),body:{observation:'Synthetic check',photos:[],expectedVersion:22}});
 assert.equal(stale.status,409);assert.equal(stale.code,'CAR02_VERSION_CONFLICT');
 const photo=await h.call({method:'POST',path:rpath(id)+'/report',key:k(12),body:{observation:'Synthetic check',photos:['55555555-5555-4555-8555-555555555555'],expectedVersion:1}});
 assert.equal(photo.status,409);assert.equal(photo.code,'CAR02_PHOTO_UNAVAILABLE');
 const missing=await h.call({method:'POST',path:rpath(id)+'/report',body:{observation:'Synthetic check',photos:[],expectedVersion:1}});
 assert.equal(missing.status,422);
 const injection=await h.call({method:'POST',key:k(13),body:{...createBody,role:'owner'}});
 assert.equal(injection.status,422);
 const originDenied=await h.call({path:rpath(id),requestOrigin:'https://invalid.example'});
 assert.equal(originDenied.status,403);
 assert.deepEqual(h.db.stats(),{rows:1,receipts:1,mutations:1});
});

test('release gate immediately relocks API without changing data',async()=>{
 const h=fixture();h.open();const created=await h.call({method:'POST',key:k(14),body:createBody});h.close();
 const rejected=await h.call({path:rpath(created.data.id)});assert.equal(rejected.status,503);
 assert.equal(h.db.stats().rows,1);
});

console.log('R255_SYNTHETIC_API_DOMAIN_E2E_QA_ONLY_NO_GO_HOLD');

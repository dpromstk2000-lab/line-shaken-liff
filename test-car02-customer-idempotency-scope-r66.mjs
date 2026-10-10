// R66: Customer-aware idempotency scope. Offline review only; no Supabase connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCar02Service, Car02Error} from './car02-core.mjs';
import {createCar02PgAdapter} from './car02-pg-adapter.mjs';
import {createCar02EdgeBoundaryR51} from './car02-edge-boundary-r51.mjs';

const shop='street_house_kitsuki';
const orderId='11111111-1111-4111-8111-111111111111';
const customerA='22222222-2222-4222-8222-222222222222';
const customerB='33333333-3333-4333-8333-333333333333';
const actor=id=>({role:'customer',subject:'line-shared-subject',verified:true,shopCode:shop,customerId:id});
const decisionArgs=(customerId,key='car02-r66-customer-shared-idempotency')=>({
 actor:actor(customerId),shop,id:orderId,decision:'approved',reason:'',expectedVersion:2,key
});
async function captureIntent(customerId){
 let metadata=null;
 const db={lookup:async()=>null,history:async()=>[],transaction:async(meta)=>{metadata=meta;return {ok:true}}};
 const service=createCar02Service(db);
 assert.deepEqual(await service.decide(decisionArgs(customerId)),{ok:true});
 return metadata;
}
const hash=metadata=>createHash('sha256').update(JSON.stringify({shop:metadata.shop,actorRole:metadata.actor.role,actorSubject:metadata.actor.subject,intent:metadata.intent})).digest('hex');

// Minimal in-memory executor for the PostgreSQL idempotency adapter's BEGIN/COMMIT and operation ledger.
// SQL is parsed only for these two operations; no remote DB is reachable.
function fakePool(){
 const operations=new Map();const calls=[];let callbackCount=0;
 const client={
  async query(sql,params=[]){
   calls.push(String(sql).trim().split(' ')[0]);
   if(/SELECT request_digest,response_snapshot,completed_at/.test(sql)){
    const [s,role,key]=params;const found=operations.get(`${s}|${role}|${key}`);
    return {rows:found?[found]:[],rowCount:found?1:0};
   }
   if(/INSERT INTO public\.ksh_car02_operations/.test(sql)){
    const [s,role,key,request_digest,response_snapshot]=params;
    operations.set(`${s}|${role}|${key}`,{request_digest,response_snapshot,completed_at:'2026-10-10T00:00:00Z'});
    return {rows:[],rowCount:1};
   }
   return {rows:[],rowCount:0};
  },
  release(){}
 };
 return {pool:{async connect(){return client}},operations,calls,get callbackCount(){return callbackCount},increment(){callbackCount++}};
}

test('R66 customer decision intent includes current authoritative customerId',async()=>{
 const m=await captureIntent(customerA);
 assert.equal(m.intent.op,'decide');
 assert.equal(m.intent.customerId,customerA);
 assert.equal(m.actor.customerId,customerA);
});

test('R66 same LINE subject and key, but a different customer identity changes intent digest',async()=>{
 const a=await captureIntent(customerA),b=await captureIntent(customerB);
 assert.equal(a.actor.subject,b.actor.subject);
 assert.equal(a.key,b.key);
 assert.notEqual(hash(a),hash(b));
});

test('R66 identical customer, role, key, version and decision yield stable replay digest',async()=>{
 const a=await captureIntent(customerA),b=await captureIntent(customerA);
 assert.equal(hash(a),hash(b));
});

test('R66 actual PG adapter blocks cross-customer idempotency replay before callback or DB write',async()=>{
 const mock=fakePool(),adapter=createCar02PgAdapter(mock.pool);
 const first=await captureIntent(customerA),changed=await captureIntent(customerB);
 const saved={mockOrder:true,id:orderId};
 const one=await adapter.transaction(first,async()=>{mock.increment();return saved});
 assert.deepEqual(one,saved);
 const replay=await adapter.transaction(first,async()=>{mock.increment();throw Error('must not execute')});
 assert.deepEqual(replay,saved);
 assert.equal(mock.callbackCount,1);
 await assert.rejects(adapter.transaction(changed,async()=>{mock.increment();return saved}),e=>e instanceof Car02Error&&e.code==='CAR02_IDEMPOTENCY_KEY_REUSED'&&e.status===409);
 assert.equal(mock.callbackCount,1);
 assert.ok(mock.calls.includes('ROLLBACK'));
});

test('R66 wrong shop/role are still rejected before transaction',async()=>{
 let called=false;
 const db={lookup:async()=>null,history:async()=>[],transaction:async()=>{called=true;}};
 const service=createCar02Service(db);
 await assert.rejects(service.decide({...decisionArgs(customerA),actor:{...actor(customerA),shopCode:'wrong'}}),e=>e.code==='CAR02_UNAUTHORIZED');
 await assert.rejects(service.decide({...decisionArgs(customerA),actor:{...actor(customerA),role:'staff'}}),e=>e.code==='CAR02_UNAUTHORIZED');
 assert.equal(called,false);
});

test('R66 old R65 malformed reason remains rejected before any transaction',async()=>{
 let called=false;
 const db={lookup:async()=>null,history:async()=>[],transaction:async()=>{called=true;}};
 const service=createCar02Service(db);
 await assert.rejects(service.decide({...decisionArgs(customerA),decision:'declined',reason:['not a string']}),e=>e.code==='CAR02_REASON_INVALID'&&e.status===422);
 assert.equal(called,false);
});

test('R66 staging HTTP boundary remains locked without initializing storage or DB',async()=>{
 let instantiated=0;
 const route=createCar02EdgeBoundaryR51({isServerReleased:()=>false,createRuntime:()=>{instantiated++;throw Error('release bypass')}});
 const resp=await route(new Request('https://example.invalid/functions/v1/dpro-car02-stage/api/car02',{method:'POST',body:'{"decision":"approved"}'}));
 assert.equal(resp.status,503);
 assert.deepEqual(await resp.json(),{ok:false,code:'CAR02_NOT_RELEASED'});
 assert.equal(instantiated,0);
});

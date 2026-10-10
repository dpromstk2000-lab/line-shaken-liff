import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02Service} from './car02-core.mjs';
import {createCar02Api} from './car02-api.mjs';

const shop='street_house_kitsuki';
const orderId='11111111-1111-4111-8111-111111111111';
const customerId='22222222-2222-4222-8222-222222222222';
const actor={verified:true,role:'customer',subject:'verified-line-test',shopCode:shop,customerId};
const key='r65-qa-safe-key-0000001';
const initial=()=>({id:orderId,shop,customerId,status:'pending',version:3,revision:1,quote:{revision:1},events:[]});
function fixture(){
  let transactions=0,saves=0;
  const db={
    lookup:async()=>initial(),history:async()=>[],
    transaction:async(_meta,fn)=>{
      transactions++;
      const scope={getForUpdate:async()=>initial(),now:()=>new Date('2026-10-10T00:00:00Z').toISOString(),save:async o=>{saves++;return structuredClone(o)}};
      return fn(scope);
    }
  };
  return {service:createCar02Service(db),get transactions(){return transactions},get saves(){return saves}};
}
const args=(decision,reason)=>({actor,shop,id:orderId,decision,reason,key,expectedVersion:3});
async function expectCode(f,code='CAR02_REASON_INVALID'){
  await assert.rejects(f,(err)=>err?.code===code&&err?.status===422,`expected ${code} (422)`);
}

test('R65 declined malformed reasons return explicit 422 before DB transaction',async()=>{
  const f=fixture();
  for(const reason of [null,123,true,{},[],['test'],{trim:'fake'}]){
    await expectCode(()=>f.service.decide(args('declined',reason)));
  }
  assert.equal(f.transactions,0);assert.equal(f.saves,0);
});
test('R65 declined blank and whitespace reasons return required error before DB',async()=>{
  const f=fixture();
  for(const reason of ['', ' ', '\n　\t'])await expectCode(()=>f.service.decide(args('declined',reason)),'CAR02_REASON_REQUIRED');
  assert.equal(f.transactions,0);
});
test('R65 rejects excessive reason length on either decision, without DB',async()=>{
  const f=fixture();
  for(const decision of ['approved','declined'])await expectCode(()=>f.service.decide(args(decision,'x'.repeat(2001))));
  assert.equal(f.transactions,0);
});
test('R65 approved malformed optional reasons are also denied before DB',async()=>{
  const f=fixture();
  for(const reason of [null,5,false,[],{}])await expectCode(()=>f.service.decide(args('approved',reason)));
  assert.equal(f.transactions,0);
});
test('R65 approved omission uses empty string and persists authorized decision',async()=>{
  const f=fixture();
  const {reason:_,...data}=args('approved','');
  const out=await f.service.decide(data);
  assert.equal(out.status,'approved');assert.equal(out.decision.reason,'');assert.equal(out.decision.revision,1);
  assert.equal(f.transactions,1);assert.equal(f.saves,1);
});
test('R65 valid Japanese decline reason still persists',async()=>{
  const f=fixture();const out=await f.service.decide(args('declined','今回は修理を見送ります'));
  assert.equal(out.status,'declined');assert.equal(out.decision.reason,'今回は修理を見送ります');assert.equal(f.transactions,1);
});
test('R65 missing or incorrect customer authorization fails without transaction',async()=>{
  const f=fixture();
  await assert.rejects(()=>f.service.decide({...args('approved',''),actor:{...actor,verified:false}}),(e)=>e.code==='CAR02_UNAUTHORIZED');
  assert.equal(f.transactions,0);
});
test('R65 API returns 422 rather than internal 500 for malformed decline reason',async()=>{
  const f=fixture();
  const handle=createCar02Api({service:f.service,releaseEnabled:async()=>true,authenticate:async()=>actor,allowedOrigins:['https://dpromstk2000-lab.github.io']});
  const req=new Request(`https://example.test/api/car02/${orderId}/decision`,{
    method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},
    body:JSON.stringify({decision:'declined',reason:12,expectedVersion:3})
  });
  const r=await handle(req);
  assert.equal(r.status,422);assert.deepEqual(await r.json(),{ok:false,code:'CAR02_REASON_INVALID'});
  assert.equal(f.transactions,0);
});
test('R65 release gate still overrides malformed input and never connects DB',async()=>{
  const f=fixture();
  const handle=createCar02Api({service:f.service,releaseEnabled:async()=>false,authenticate:async()=>{throw Error('auth must not run')},allowedOrigins:[]});
  const req=new Request(`https://example.test/api/car02/${orderId}/decision`,{
    method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},
    body:JSON.stringify({decision:'declined',reason:{},expectedVersion:3})
  });
  const r=await handle(req);
  assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,code:'CAR02_NOT_RELEASED'});
  assert.equal(f.transactions,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {bindCar02StageReservationToPgR504,CAR02_V504_MODE} from './car02-stage-reservation-pg-bridge-v504-isolated.mjs';

const R='11111111-1111-4111-8111-111111111111';
const C='22222222-2222-4222-8222-222222222222';
const V='33333333-3333-4333-8333-333333333333';
const row={id:R,shop_code:'street_house_kitsuki',customer_id:C,vehicle_id:V,
  reservation_date:'2026-10-30',reservation_time:'10:30:00',status:'入庫済み'};
const actor={verified:true,role:'owner',subject:'verified-qa-subject',shopCode:row.shop_code};
const input={actor,shop:row.shop_code,reservationId:R,key:'v504-staged-key-00001'};
class Car02Error extends Error {constructor(code,status){super(code);this.code=code;this.status=status;}}

function rig({released=true,unique=true,reservation=row,existing=null}={}){
  const calls=[];
  const pool={
    query:()=>{throw Error('pool.query-direct-denied');},
    connect:async()=>({
      async query(sql,args){
        calls.push(['sql',sql,args]);
        if(sql.includes('pg_catalog.pg_index'))return {rows:[{enforced:unique}]};
        if(sql.includes('FROM public.ksh_demo_reservations'))
          return {rows:reservation?[reservation]:[]};
        if(sql.includes('FROM public.ksh_car02_work_orders'))
          return {rows:existing?[existing]:[]};
        throw Error('unexpected_sql');
      },
      release(){calls.push(['release-client']);},
    }),
  };
  const service={
    get:()=>42,
    async create(payload){calls.push(['create',payload]);return payload;},
  };
  const wrapped=bindCar02StageReservationToPgR504({pool,service,
    releaseEnabled:async()=>released,Car02ErrorClass:Car02Error});
  return {wrapped,calls};
}

test('01: review-only mode and locked runtime do not touch database',async()=>{
  assert.equal(CAR02_V504_MODE.releaseLock,true);
  const {wrapped,calls}=rig({released:false});
  await assert.rejects(()=>wrapped.create(input),e=>e.code==='CAR02_NOT_RELEASED'&&e.status===503);
  assert.deepEqual(calls,[]);
});

test('02: R13 non-unique reservation index never permits a case write',async()=>{
  const {wrapped,calls}=rig({unique:false});
  await assert.rejects(()=>wrapped.create(input),e=>e.code==='CAR02_V501_ATOMIC_UNIQUE_LINK_NOT_VERIFIED');
  assert.equal(calls.some(x=>x[0]==='create'),false);
  assert.equal(calls.filter(x=>x[0]==='sql').length,1);
  assert.match(calls[0][1],/indisunique/);
  assert.match(calls[0][1],/indisvalid/);
  assert.match(calls[0][1],/indpred IS NULL/);
});

test('03: verified actor + unique proof + authoritative 入庫済み booking bind to original R43 create',async()=>{
  const {wrapped,calls}=rig();
  const out=await wrapped.create(input);
  assert.equal(out.shop,row.shop_code);
  assert.equal(out.customerId,C);
  assert.equal(out.vehicleId,V);
  assert.equal(out.reservationId,R);
  assert.deepEqual(calls.filter(x=>x[0]==='sql'&&Array.isArray(x[2])&&x[2].length>0).map(x=>x[2]),
    [[row.shop_code,R],[row.shop_code,R]]);
  assert.equal(calls.filter(x=>x[0]==='release-client').length,3);
  assert.equal(wrapped.get(),42);
});

test('04: cross-tenant response fails closed and does not create',async()=>{
  const {wrapped,calls}=rig({reservation:{...row,shop_code:'other_shop'}});
  await assert.rejects(()=>wrapped.create(input),e=>e.code==='CAR02_V501_RESERVATION_LOOKUP_FAILED');
  assert.equal(calls.some(x=>x[0]==='create'),false);
});

test('05: incomplete booking, provisional booking or existing link never duplicates',async()=>{
  for(const [options,code] of [
    [{reservation:{...row,vehicle_id:null}},'CAR02_V501_REFERENCES_INCOMPLETE'],
    [{reservation:{...row,status:'仮入庫'}},'CAR02_V501_RESERVATION_NOT_CONFIRMED'],
    [{existing:{id:'existing-case'}},'CAR02_V501_CASE_ALREADY_LINKED'],
  ]){
    const {wrapped,calls}=rig(options);
    await assert.rejects(()=>wrapped.create(input),e=>e.code===code);
    assert.equal(calls.some(x=>x[0]==='create'),false);
  }
});

import test from 'node:test';import assert from 'node:assert/strict';
import {makeCar02Demo,DELIVERY_MODE} from './car02-basic-flow-isolated.mjs';
const clock=()=>new Date('2026-10-15T00:00:00.000Z');
const make=()=>makeCar02Demo({now:clock});
const owner={shop:'shop-a',role:'owner'},staff={shop:'shop-a',role:'staff'},customer={shop:'shop-a',role:'customer',customer:'架空顧客A'};
const data={customer:'架空顧客A',vehicle:'デモ車両A',start:'2026-10-16T10:30'};
function created(d=make()){return [d,d.create(owner,data)]}
const rejects=(fn,code)=>assert.throws(fn,{message:code});
test('release remains NO_GO, staging-only',()=>{assert.equal(DELIVERY_MODE.release,'NO_GO');assert.equal(DELIVERY_MODE.migration,'HOLD')});
test('booking creates synthetic customer and vehicle reference',()=>{const[d,c]=created();assert.equal(c.status,'booked');assert.equal(d.view(customer,c.id).vehicle,'デモ車両A')});
test('past dates and off-grid minutes denied',()=>{const d=make();rejects(()=>d.create(owner,{...data,start:'2026-10-14T10:30'}),'BOOKING_INVALID');rejects(()=>d.create(owner,{...data,start:'2026-10-16T10:15'}),'BOOKING_INVALID')});
test('other tenant cannot access case',()=>{const[d,c]=created();rejects(()=>d.view({shop:'shop-b',role:'owner'},c.id),'TENANT_DENIED')});
test('other customer cannot access case',()=>{const[d,c]=created();rejects(()=>d.view({...customer,customer:'別人'},c.id),'CUSTOMER_DENIED')});
test('customer cannot create report',()=>{const[d,c]=created();rejects(()=>d.act(customer,c.id,'report',{expectedVersion:1,observation:'異常'}),'ROLE_DENIED')});
test('complete lifecycle',()=>{const[d,c]=created();let x=d.act(staff,c.id,'report',{expectedVersion:1,observation:'ブレーキの摩耗'});x=d.act(staff,c.id,'quote',{expectedVersion:x.version,items:[{name:'点検',price:3000}]});x=d.act(customer,c.id,'decision',{expectedVersion:x.version,decision:'approved'});x=d.act(staff,c.id,'complete',{expectedVersion:x.version});assert.equal(x.status,'completed');assert.equal(x.history.length,5)});
test('stale version rejected',()=>{const[d,c]=created();d.act(staff,c.id,'report',{expectedVersion:1,observation:'検査'});rejects(()=>d.act(staff,c.id,'quote',{expectedVersion:1,items:[{name:'点検',price:2000}]}),'VERSION_CONFLICT')});
test('declined estimate prevents completion',()=>{const[d,c]=created();let x=d.act(staff,c.id,'report',{expectedVersion:1,observation:'検査'});x=d.act(staff,c.id,'quote',{expectedVersion:x.version,items:[{name:'点検',price:2000}]});x=d.act(customer,c.id,'decision',{expectedVersion:x.version,decision:'declined'});rejects(()=>d.act(staff,c.id,'complete',{expectedVersion:x.version}),'TRANSITION_DENIED')});
test('negative estimate amount rejected',()=>{const[d,c]=created();const x=d.act(staff,c.id,'report',{expectedVersion:1,observation:'検査'});rejects(()=>d.act(staff,c.id,'quote',{expectedVersion:x.version,items:[{name:'点検',price:-1}]}),'TRANSITION_DENIED')});

test('impossible calendar dates rejected',()=>{const d=make();rejects(()=>d.create(owner,{...data,start:'2026-02-30T10:30'}),'BOOKING_INVALID');rejects(()=>d.create(owner,{...data,start:'2026-13-16T10:30'}),'BOOKING_INVALID')});
test('duplicate slot same shop rejected',()=>{const d=make();d.create(owner,data);rejects(()=>d.create(owner,{...data,customer:'架空顧客B'}),'BOOKING_SLOT_OCCUPIED')});
test('same slot across shops remains isolated',()=>{const d=make();d.create(owner,data);const other=d.create({shop:'shop-b',role:'owner'},data);assert.equal(other.shop,'shop-b')});

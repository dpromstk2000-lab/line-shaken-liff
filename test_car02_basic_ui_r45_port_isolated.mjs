import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR02_BASIC_UI_PORT_MODE,createCar02BasicUiR45Port,projectCar02R45Order} from './car02-basic-ui-r45-port-isolated.mjs';
const CUSTOMER='11111111-1111-4111-8111-111111111111';
const VEHICLE='22222222-2222-4222-8222-222222222222';
const BOOKING='66666666-6666-4666-8666-666666666666';
const ORDER='99999999-9999-4999-8999-999999999999';
const case0={id:ORDER,shop:'qa-shop',customerId:CUSTOMER,vehicleId:VEHICLE,reservationId:BOOKING,status:'draft',version:1,observation:'',quote:null};
const key='qa-only-ui-key-000001';
const args={customerId:CUSTOMER,vehicleId:VEHICLE,reservationId:BOOKING,idempotencyKey:key};
const observed=[];
function fake(value=case0){return {create:async (...v)=>(observed.push(['create',...v]),value),get:async(...v)=>(observed.push(['get',...v]),value),
 history:async(...v)=>(observed.push(['history',...v]),[{type:'created',actorRole:'staff',actorFingerprint:'synthetic-internal-fingerprint',createdAt:'2026-10-16T01:00:00Z'}]),
 saveReport:async(...v)=>(observed.push(['report',...v]),value),presentQuote:async(...v)=>(observed.push(['quote',...v]),value),
 decision:async(...v)=>(observed.push(['decision',...v]),value),complete:async(...v)=>(observed.push(['complete',...v]),value)};}
const port=(client=fake())=>createCar02BasicUiR45Port({environment:'disposable_qa',allowIsolatedQa:true,client});
const bad=(fn,code)=>assert.throws(fn,{message:code});
test('NO_GO, HOLD, no booking write and no real identity claims',()=>{assert.equal(CAR02_BASIC_UI_PORT_MODE.release,'NO_GO');assert.equal(CAR02_BASIC_UI_PORT_MODE.migration,'HOLD');assert.equal(CAR02_BASIC_UI_PORT_MODE.bookingWrite,false);assert.equal(CAR02_BASIC_UI_PORT_MODE.realAuth,false)});
test('requires explicitly isolated QA and full transport interface',()=>{bad(()=>createCar02BasicUiR45Port({environment:'production',allowIsolatedQa:true,client:fake()}),'CAR02_UI_ISOLATION_REQUIRED');bad(()=>createCar02BasicUiR45Port({environment:'disposable_qa',client:fake()}),'CAR02_UI_ISOLATION_REQUIRED');bad(()=>createCar02BasicUiR45Port({environment:'disposable_qa',allowIsolatedQa:true,client:{}}),'CAR02_UI_ISOLATION_REQUIRED')});
test('create sends UUIDs only, not labels, shop, role or authentication',async()=>{observed.length=0;const value=await port().createFromResolvedReferences(args);assert.equal(value.state,'draft');assert.deepEqual(observed[0],['create',{customerId:CUSTOMER,vehicleId:VEHICLE,reservationId:BOOKING},key]);assert.equal(value.reservationLinked,true);assert.ok(!('shop' in value));assert.ok(!('customerId' in value))});
test('missing/label-only UUID and forged role fields rejected before dispatch',async()=>{observed.length=0;await assert.rejects(port().createFromResolvedReferences({...args,customerId:'架空顧客'}),/CAR02_CONTRACT_REFERENCE_REQUIRED/);await assert.rejects(port().createFromResolvedReferences({...args,role:'owner'}),/CAR02_CONTRACT_FIELDS_INVALID/);assert.equal(observed.length,0)});
test('report requires exact version and excludes photos pending Storage QA',async()=>{observed.length=0;const p=port();await p.saveReport({id:ORDER,expectedVersion:1,requestId:key,observation:'   点検済み  '});assert.deepEqual(observed[0],['report',ORDER,{observation:'点検済み',photos:[],expectedVersion:1},key]);await assert.rejects(p.saveReport({id:ORDER,expectedVersion:1,requestId:key,observation:'点検',photos:[BOOKING]}),/CAR02_UI_REPORT_INVALID/)});
test('quote strictly validates items and forwards server-compatible version',async()=>{observed.length=0;await port().presentQuote({id:ORDER,expectedVersion:2,requestId:key,items:[{name:' 点検 ',price:2500}]});assert.deepEqual(observed[0],['quote',ORDER,{items:[{name:'点検',price:2500}],expectedVersion:2},key])});
test('negative and extra fields in quote rejected',async()=>{await assert.rejects(port().presentQuote({id:ORDER,expectedVersion:2,requestId:key,items:[{name:'点検',price:-1}]}),/CAR02_UI_QUOTE_INVALID/);await assert.rejects(port().presentQuote({id:ORDER,expectedVersion:2,requestId:key,items:[{name:'点検',price:10,role:'owner'}]}),/CAR02_UI_QUOTE_INVALID/)});
test('decision decline requires reason, approve may omit reason',async()=>{observed.length=0;await port().decide({id:ORDER,decision:'approved',expectedVersion:3,requestId:key});assert.deepEqual(observed[0],['decision',ORDER,{decision:'approved',reason:'',expectedVersion:3},key]);await assert.rejects(port().decide({id:ORDER,decision:'declined',expectedVersion:3,requestId:key}),/CAR02_UI_DECISION_INVALID/)});
test('completion validates id and version',async()=>{observed.length=0;await port().complete({id:ORDER,expectedVersion:4,requestId:key});assert.deepEqual(observed[0],['complete',ORDER,{expectedVersion:4},key]);await assert.rejects(port().complete({id:'a',expectedVersion:4,requestId:key}),/CAR02_UI_CASE_ID_REQUIRED/)});
test('draft with report maps to 見積作成待ち, otherwise 整備報告待ち',()=>{assert.equal(projectCar02R45Order(case0).statusLabel,'整備報告待ち');assert.equal(projectCar02R45Order({...case0,observation:'点検内容'}).statusLabel,'見積作成待ち')});
test('pending/approved/completed labels and allowed actions',()=>{const quote={revision:1,subtotal:2500,tax:250,total:2750};const pending=projectCar02R45Order({...case0,status:'pending',version:3,quote});assert.equal(pending.statusLabel,'お客様承認待ち');assert.equal(pending.totalYen,2750);assert.equal(pending.canDecide,true);const approved=projectCar02R45Order({...case0,status:'approved',version:4,quote});assert.equal(approved.canComplete,true);assert.equal(projectCar02R45Order({...case0,status:'completed',version:5,quote}).statusLabel,'作業完了')});
test('reject malformed status, version, quote totals and non-UUID records',()=>{for(const r of [{...case0,status:'awaiting_approval'},{...case0,version:0},{...case0,id:'DEMO-0001'},{...case0,quote:{subtotal:10,tax:1,total:12}}])assert.throws(()=>projectCar02R45Order(r),/CAR02_UI_(RESPONSE|QUOTE)_INVALID/)});
test('read and history do not leak auth, shop or actor fingerprints',async()=>{const p=port();const x=await p.read(ORDER);assert.ok(!('customerId' in x));const hist=await p.history(ORDER);assert.deepEqual(hist,[{event:'created',role:'staff',createdAt:'2026-10-16T01:00:00Z'}]);assert.ok(!('actorFingerprint' in hist[0]))});
test('cannot create booking or upload photos or send/deploy',()=>{const p=port();for(const name of ['createBooking','uploadPhoto','send','deploy'])assert.equal(typeof p[name],'undefined')});
test('history rejects non-array/unrecognized event data',async()=>{
 const invalid=[
   {bad:true},
   [{event_type:'created',actor_role:'staff',created_at:'2026-10-16T01:00:00Z'}], // SQL row != R45 HTTP DTO
   [{type:'created',actorRole:'staff',createdAt:'not-a-time'}],
   [{type:'',actorRole:'staff',createdAt:'2026-10-16T01:00:00Z'}],
   Array.from({length:1001},()=>({type:'created',actorRole:'staff',createdAt:'2026-10-16T01:00:00Z'}))
 ];
 for(const sample of invalid){
   const p=port({...fake(),history:async()=>sample});
   await assert.rejects(p.history(ORDER),/CAR02_UI_HISTORY_INVALID/);
 }
});

/** CAR02 V2.1: real disposable PG17 R13 fixture -> shape-only legacy list
 * -> browser-untrusted selection -> V2.0 two-stage server DB recheck.
 * QA-ONLY: no public legacy API, no business writes, no secrets, no deploy.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {projectCar02LegacyReservationInbox,createCar02LegacyInboxSelectionQa} from './car02-legacy-reservation-inbox-readonly-isolated.mjs';
import {createCar02LegacyReservationHandoffReadOnly} from './car02-legacy-reservation-handoff-readonly-isolated.mjs';
const e=process.env;
for(const [k,v] of Object.entries({GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',
 CAR02_BASIC_PG17_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',
 PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'}))if(e[k]!==v)throw Error('CAR02_LEGACY_INBOX_PG17_DISPOSABLE_ONLY');
const edge=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
if(!/const CAR02_RELEASE_LOCK=true;/.test(edge))throw Error('CAR02_LEGACY_INBOX_R52_UNLOCKED');
const SHOP='street_house_kitsuki',OTHER='other_shop';
const ID='66666666-6666-4666-8666-666666666666';
const FOREIGN='77777777-7777-4777-8777-777777777777';
const CUSTOMER='11111111-1111-4111-8111-111111111111';
const VEHICLE='22222222-2222-4222-8222-222222222222';
const actor={verified:true,role:'staff',subject:'synthetic-r44-staff-inbox',shopCode:SHOP};
const root=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa',max:3});
let count=0,reads=0;
const pass=async(label,fn)=>{await fn();console.log(`PASS LEGACY-INBOX-PG17 ${++count}: ${label}`)};
const queryOnly={options:root.options,connect:()=>root.connect(),query:async(sql,args)=>{
 if(typeof sql!=='string'||!/\s*SELECT\b/i.test(sql)||/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|CALL)\b/i.test(sql))throw Error('CAR02_LEGACY_INBOX_SQL_WRITE_DENIED');
 reads++;return root.query(sql,args);
}};
const handoff=createCar02LegacyReservationHandoffReadOnly({pool:queryOnly,env:e,environment:'disposable_qa',allowDisposableQa:true});
const picker=createCar02LegacyInboxSelectionQa({handoff,actor,environment:'isolated_qa',allowIsolatedQa:true});
const key='qa-legacy-inbox-pg17-001';
const req={reservationId:ID,idempotencyKey:key};
const counts=async()=>{
 const r=await root.query('SELECT (SELECT count(*)::int FROM public.ksh_demo_reservations) AS bookings,(SELECT count(*)::int FROM public.ksh_car02_work_orders) AS orders');
 return r.rows[0];
};
const row=(id,status='入庫予定')=>({id,reservation_date:'2026-10-20',reservation_time:'10:30:00',status,
 customer_id:'client-customer-FAKE',vehicle_id:'client-vehicle-FAKE',
 customer:{name:'PRIVATE_NAME'},vehicle:{plate_last4:'9999'},phone:'PRIVATE_PHONE',
 shop_code:'FAKE_CLIENT_SHOP',memo:'PRIVATE_MEMO'});
try{
 let before, snapshot, prepared;
 await pass('disposable PG17 has synthetic R13 bookings',async()=>{
  const v=await root.query('SHOW server_version_num');assert.ok(Number(v.rows[0].server_version_num)>=170000);
  const x=await root.query('SELECT id FROM public.ksh_demo_reservations WHERE id=$1::uuid AND shop_code=$2',[ID,SHOP]);
  assert.equal(x.rows.length,1);before=await counts();
 });
 await pass('legacy-shaped reservations list accepts only UUID and safe status/date/time',async()=>{
  snapshot=projectCar02LegacyReservationInbox({reservations:[row(ID)]});assert.equal(snapshot.items[0].reservationId,ID);
  assert.deepEqual(Object.keys(snapshot.items[0]),['reservationId','day','time','status','reviewable','needsServerVerification','sendable','readOnly']);
 });
 await pass('display data cannot leak customer info or tenant claims',async()=>{
  const s=JSON.stringify(snapshot);for(const str of ['PRIVATE_NAME','PRIVATE_PHONE','PRIVATE_MEMO','9999','FAKE_CLIENT_SHOP','client-customer-FAKE'])assert.ok(!s.includes(str));
 });
 await pass('list alone never grants permission to create an order',async()=>{
  assert.equal(snapshot.clientVerified,false);assert.equal(snapshot.sendable,false);assert.equal(snapshot.items[0].needsServerVerification,true);
 });
 await pass('server recheck resolves exact R13 shop/customer/vehicle ID',async()=>{
  prepared=await picker.prepareSelected(snapshot,req);assert.deepEqual(prepared.body,{customerId:CUSTOMER,vehicleId:VEHICLE,reservationId:ID});
 });
 await pass('descriptor keeps R45 service gate and is not sendable',async()=>{
  assert.equal(prepared.sendable,false);assert.equal(prepared.readOnly,true);assert.equal(prepared.authorization,'SERVER_VERIFICATION_REQUIRED');assert.equal(prepared.release,'NO_GO');assert.equal(prepared.migration,'HOLD');
 });
 await pass('client forged shop and customer cannot cross the verified R13 boundary',async()=>{
  assert.ok(!('shopCode' in prepared.body));assert.ok(!('role' in prepared.body));assert.ok(!('accessToken' in prepared.body));
  assert.ok(!('customerName' in prepared.body));
 });
 await pass('retry reads same R13 record and does not duplicate a work order',async()=>{
  const repeated=await picker.prepareSelected(snapshot,req);assert.deepEqual(repeated,prepared);
 });
 await pass('foreign tenant R13 reservation rejected by server after list selection',async()=>{
  const s=projectCar02LegacyReservationInbox({reservations:[row(FOREIGN)]});
  await assert.rejects(()=>picker.prepareSelected(s,{...req,reservationId:FOREIGN}),/REFERENCE_NOT_FOUND/);
 });
 await pass('nonexistent R13 UUID cannot be elevated by display list',async()=>{
  const uuid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const s=projectCar02LegacyReservationInbox({reservations:[row(uuid)]});
  await assert.rejects(()=>picker.prepareSelected(s,{...req,reservationId:uuid}),/REFERENCE_NOT_FOUND/);
 });
 await pass('display-only DEMO id cannot reach database bridge',async()=>{
  const s=projectCar02LegacyReservationInbox({reservations:[row('DEMO-0001')]});
  assert.equal(s.items.length,0);await assert.rejects(()=>picker.prepareSelected(s,{...req,reservationId:'DEMO-0001'}),/UUID_REQUIRED/);
 });
 await pass('cancelled/display-finished booking excluded before database lookup',async()=>{
  for(const status of ['キャンセル','引渡し完了']){
   const s=projectCar02LegacyReservationInbox({reservations:[row(ID,status)]});
   await assert.rejects(()=>picker.prepareSelected(s,req),/NOT_REVIEWABLE/);
  }
 });
 await pass('conflicting duplicated list IDs fail closed',async()=>{
  assert.throws(()=>projectCar02LegacyReservationInbox({reservations:[row(ID),row(ID)]}),/DUPLICATE_ID/);
 });
 await pass('browser cannot supply tenant or identity through selection payload',async()=>{
  await assert.rejects(()=>picker.prepareSelected(snapshot,{...req,shopCode:OTHER}),/SELECTION_INVALID/);
  await assert.rejects(()=>picker.prepareSelected(snapshot,{...req,customerId:CUSTOMER}),/SELECTION_INVALID/);
 });
 await pass('all R13 handoff SQL calls are read-only and snapshots do not modify DB',async()=>{
  assert.ok(reads>=4);assert.deepEqual(await counts(),before);
 });
 await pass('R52 hard lock and no callable deploy or send API remain',async()=>{
  assert.match(edge,/const CAR02_RELEASE_LOCK=true;/);assert.equal(typeof picker.send,'undefined');assert.equal(typeof picker.deploy,'undefined');
 });
 console.log(`CAR02_LEGACY_INBOX_R13_R45_READONLY_PG17_PASS ${count}/${count} SYNTHETIC_ONLY NO_GO HOLD`);
}finally{await root.end()}

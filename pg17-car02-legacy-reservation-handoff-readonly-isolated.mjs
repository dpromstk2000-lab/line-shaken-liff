/** CAR02 V2.0: read-only R13 reservation reference -> R45 descriptor, PostgreSQL 17.
 * Runs only AFTER existing disposable R13 fixture and booking integration tests in CI.
 * NEVER makes a write query, HTTP request, production connection or business mutation.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createCar02LegacyReservationHandoffReadOnly} from './car02-legacy-reservation-handoff-readonly-isolated.mjs';

const e=process.env;
for(const [k,v] of Object.entries({GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',
 CAR02_BASIC_PG17_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',
 PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'}))if(e[k]!==v)throw Error('CAR02_LEGACY_HANDOFF_PG17_DISPOSABLE_ONLY');
const entry=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
if(!/const CAR02_RELEASE_LOCK=true;/.test(entry))throw Error('CAR02_LEGACY_HANDOFF_R52_RELEASE_LOCK_MISSING');
const SHOP='street_house_kitsuki', OTHER='other_shop';
const RES='66666666-6666-4666-8666-666666666666';
const OTHER_RES='77777777-7777-4777-8777-777777777777';
const CUSTOMER='11111111-1111-4111-8111-111111111111';
const VEHICLE='22222222-2222-4222-8222-222222222222';
const actor={verified:true,role:'staff',subject:'synthetic-r44-staff',shopCode:SHOP};
const root=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa',max:3});
let count=0,reads=0;
const pass=async(label,fn)=>{await fn();console.log(`PASS LEGACY-HANDOFF-PG17 ${++count}: ${label}`)};
const onlyReads={options:root.options,connect:()=>root.connect(),query:async(sql,values)=>{
 if(typeof sql!=='string'||!/^\s*SELECT\b/i.test(sql)||/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|CALL)\b/i.test(sql))
  throw Error('CAR02_LEGACY_HANDOFF_WRITE_ATTEMPT');
 reads++;return root.query(sql,values);
}};
const handoff=createCar02LegacyReservationHandoffReadOnly({pool:onlyReads,env:e,environment:'disposable_qa',allowDisposableQa:true});
const input={actor,reservationId:RES,idempotencyKey:'qa-legacy-pg17-handoff-001'};
const countRows=async table=>Number((await root.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n);
const counts=async()=>[await countRows('public.ksh_demo_reservations'),await countRows('public.ksh_car02_work_orders')];
try{
 let before;
 await pass('running on real disposable PostgreSQL 17 after existing R13 fixture',async()=>{
  const x=await root.query('SHOW server_version_num');assert.ok(Number(x.rows[0].server_version_num)>=170000);
  const r=await root.query('SELECT id FROM public.ksh_demo_reservations WHERE id=$1::uuid AND shop_code=$2',[RES,SHOP]);
  assert.equal(r.rows.length,1);before=await counts();
 });
 let result;
 await pass('read-only R13 reservation joins customer and vehicle by actual UUID',async()=>{
  result=await handoff.prepare(input);assert.deepEqual(result.body,{customerId:CUSTOMER,vehicleId:VEHICLE,reservationId:RES});
  assert.equal(result.path,'/api/car02');assert.equal(result.method,'POST');
 });
 await pass('prepared payload is never sendable and cannot replace R44 authorization',async()=>{
  assert.equal(result.sendable,false);assert.equal(result.authorization,'SERVER_VERIFICATION_REQUIRED');
  assert.equal(result.release,'NO_GO');assert.equal(result.migration,'HOLD');
 });
 await pass('prepared payload does not contain client-injected shop, token, owner or display fields',async()=>{
  assert.deepEqual(Object.keys(result.body),['customerId','vehicleId','reservationId']);
  for(const k of ['shopCode','owner','role','accessToken','customerName','reservationDisplayId'])assert.ok(!(k in result.body));
 });
 await pass('repeat request yields same descriptor without booking/order duplicate',async()=>{
  const repeated=await handoff.prepare(input);assert.deepEqual(repeated,result);
 });
 await pass('foreign-shop reservation cannot resolve inside current shop',async()=>{
  await assert.rejects(handoff.prepare({...input,reservationId:OTHER_RES}),/REFERENCE_NOT_FOUND/);
 });
 await pass('unknown but valid UUID is not accepted',async()=>{
  await assert.rejects(handoff.prepare({...input,reservationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),/REFERENCE_NOT_FOUND/);
 });
 await pass('display-only DEMO number cannot be used as DB reservation ID',async()=>{
  await assert.rejects(handoff.prepare({...input,reservationId:'DEMO-0001'}),/UUID_REQUIRED/);
 });
 await pass('client-injected tenant rejected without lookup',async()=>{
  await assert.rejects(handoff.prepare({...input,shopCode:OTHER}),/FIELDS_DENIED/);
 });
 await pass('client-injected customer or vehicle reference rejected',async()=>{
  await assert.rejects(handoff.prepare({...input,customerId:CUSTOMER}),/FIELDS_DENIED/);
  await assert.rejects(handoff.prepare({...input,vehicleId:VEHICLE}),/FIELDS_DENIED/);
 });
 await pass('customer-only role cannot request staff handoff',async()=>{
  await assert.rejects(handoff.prepare({...input,actor:{...actor,role:'customer'}}),/TRUSTED_STAFF_REQUIRED/);
 });
 await pass('forged verified flag cannot request staff handoff',async()=>{
  await assert.rejects(handoff.prepare({...input,actor:{...actor,verified:false}}),/TRUSTED_STAFF_REQUIRED/);
 });
 await pass('request key is required and malformed keys are rejected',async()=>{
  await assert.rejects(handoff.prepare({...input,idempotencyKey:'bad'}),/IDEMPOTENCY_REQUIRED/);
 });
 await pass('all bridge SQL statements executed on PG17 were SELECT only',async()=>assert.ok(reads>=4));
 await pass('reservations and work order row counts have not changed',async()=>assert.deepEqual(await counts(),before));
 await pass('hard R52 lock remains present and gateway is never called',async()=>{
  assert.match(entry,/const CAR02_RELEASE_LOCK=true;/);
  assert.equal(typeof handoff.send,'undefined');
 });
 console.log(`CAR02_LEGACY_RESERVATION_R13_R45_READONLY_PG17_PASS ${count}/${count} SYNTHETIC_ONLY NO_GO HOLD`);
} finally {await root.end()}

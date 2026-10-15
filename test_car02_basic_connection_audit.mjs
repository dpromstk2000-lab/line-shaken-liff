import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {auditCar02Source} from './car02-basic-connection-audit.mjs';
const source={'car02-api.mjs':'createCar02Api service.create service.report service.present service.decide service.complete',
'car02-core.mjs':'createCar02Service assertLinks customerId vehicleId reservationId',
'car02-pg-adapter.mjs':'createCar02PgAdapter ksh_demo_customers ksh_demo_vehicles ksh_demo_reservations ksh_car02_work_orders',
'car02-runtime-verified-r46.mjs':'createCar02VerifiedRuntimeR46 createCar02RuntimeR45',
'car02-edge-entry-r52.ts':'CAR02_RELEASE_LOCK=true CAR02_NOT_RELEASED',
'R13_MIGRATION_QA_ONLY.sql':'ksh_demo_customers ksh_demo_vehicles ksh_demo_reservations ksh_car02_work_orders'};
const audit=s=>auditCar02Source('/fixture',{loader:async p=>{const n=path.basename(p);if(!(n in s))throw Error('not found');return s[n]}});
test('known code footprints are detectable',async()=>{const x=await audit(source);assert.equal(x.sourceContractsPresent,true);assert.equal(x.evidence.length,6)});
test('source presence never means production connected',async()=>{const x=await audit(source);assert.equal(x.liveApiConnected,false);assert.equal(x.realBookingWriteVerified,false)});
test('release and migration hard locked in the report',async()=>{const x=await audit(source);assert.equal(x.release,'NO_GO');assert.equal(x.migration,'HOLD')});
test('release lock missing is flagged',async()=>{const x=await audit({...source,'car02-edge-entry-r52.ts':'CAR02_NOT_RELEASED'});assert.equal(x.releaseLockPresent,false);assert.equal(x.sourceContractsPresent,false)});
test('missing DB adapter is flagged',async()=>{const s={...source};delete s['car02-pg-adapter.mjs'];const x=await audit(s);assert.equal(x.sourceContractsPresent,false);assert.equal(x.evidence.find(e=>e.filename==='car02-pg-adapter.mjs').status,'MISSING')});
test('missing reservation scope reference is flagged',async()=>{const x=await audit({...source,'car02-pg-adapter.mjs':'createCar02PgAdapter ksh_demo_customers ksh_demo_vehicles ksh_car02_work_orders'});assert.equal(x.sourceContractsPresent,false)});
test('production blockers remain open',async()=>{const x=await audit(source);assert.ok(x.blockers.includes('REAL_BOOKING_WRITE_ENDPOINT'));assert.ok(x.blockers.includes('OWNER_RELEASE_APPROVAL'))});
test('root is obligatory',async()=>{await assert.rejects(()=>auditCar02Source(''),/ROOT_REQUIRED/)});

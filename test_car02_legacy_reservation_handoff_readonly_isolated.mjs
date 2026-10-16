import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02LegacyReservationHandoffReadOnly,CAR02_LEGACY_HANDOFF_MODE as MODE} from './car02-legacy-reservation-handoff-readonly-isolated.mjs';

const RES='66666666-6666-4666-8666-666666666666';
const CUSTOMER='11111111-1111-4111-8111-111111111111';
const VEHICLE='22222222-2222-4222-8222-222222222222';
const FOREIGN='77777777-7777-4777-8777-777777777777';
const row={reservation_id:RES,customer_id:CUSTOMER,vehicle_id:VEHICLE,shop_code:'street_house_kitsuki'};
const actor={verified:true,subject:'trusted-qa-staff',shopCode:'street_house_kitsuki',role:'staff'};
const input={actor,reservationId:RES,idempotencyKey:'qa-R13-handoff-20261016'};
const env={GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',CAR02_BASIC_PG17_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'};
function make({first=row,second={shop_ok:true,customer_ok:true,vehicle_ok:true,reservation_ok:true},
  records=[],poolPatch={},envPatch={},argPatch={},failQuery=false}={}){
 let i=0;
 const pool={options:{host:'127.0.0.1',database:'car02_qa',user:'postgres',port:5432},connect:()=>{},
 query:async(sql,values)=>{
    records.push({sql,values});if(failQuery)throw Error('DB_PRIVATE_DETAILS_SECRET');
    const n=i++;return {rows:n===0?(first==null?[]:[first]):[second]};
 }};
 Object.assign(pool,poolPatch);return createCar02LegacyReservationHandoffReadOnly({
  pool,env:{...env,...envPatch},environment:'disposable_qa',allowDisposableQa:true,...argPatch});
}
test('QA-only fixed mode, never deployable',()=>{assert.equal(MODE.productionReady,false);assert.equal(MODE.sendable,false);assert.equal(MODE.realLegacyApiConnected,false);assert.equal(MODE.release,'NO_GO');assert.equal(MODE.migration,'HOLD')});
test('normal input yields UNSENDABLE R45 descriptor verified twice by DB',async()=>{
 const records=[];const x=await make({records}).prepare(input);
 assert.deepEqual(x.body,{customerId:CUSTOMER,vehicleId:VEHICLE,reservationId:RES});
 assert.equal(x.sendable,false);assert.equal(x.path,'/api/car02');assert.equal(x.method,'POST');
 assert.equal(x.authorization,'SERVER_VERIFICATION_REQUIRED');assert.equal(x.source,'R13_DISPOSABLE_RESERVATION');
 assert.equal(x.readOnly,true);assert.equal(x.release,'NO_GO');assert.equal(x.migration,'HOLD');
 assert.equal(records.length,2);assert.ok(records.every(r=>/SELECT/i.test(r.sql)));
 assert.deepEqual(records[0].values,[RES,actor.shopCode]);
 assert.deepEqual(records[1].values,[actor.shopCode,CUSTOMER,VEHICLE,RES]);
 assert.equal(Object.isFrozen(x),true);assert.equal(Object.isFrozen(x.body),true);
});
test('does not provide send, deploy, publish or mutate method',()=>{const x=make();for(const method of ['send','deploy','publish','create','update','delete','post'])assert.equal(method in x,false)});
test('cannot construct in production',()=>assert.throws(()=>make({argPatch:{environment:'production'}}),/DISPOSABLE_ONLY/));
test('cannot construct without explicit opt-in',()=>assert.throws(()=>make({argPatch:{allowDisposableQa:false}}),/DISPOSABLE_ONLY/));
test('cannot construct without CI marker',()=>assert.throws(()=>make({envPatch:{GITHUB_ACTIONS:'false'}}),/DISPOSABLE_ONLY/));
test('cannot construct without R52 hard lock',()=>assert.throws(()=>make({envPatch:{CAR02_RELEASE_LOCK:'false'}}),/DISPOSABLE_ONLY/));
test('cannot construct with production database',()=>assert.throws(()=>make({envPatch:{PGDATABASE:'production'}}),/DISPOSABLE_ONLY/));
test('cannot construct with unexpected database host',()=>assert.throws(()=>make({poolPatch:{options:{host:'prod.example',port:5432,user:'postgres',database:'car02_qa'}}}),/DISPOSABLE_ONLY/));
test('cannot construct with DB pool bound to another DB',()=>assert.throws(()=>make({poolPatch:{options:{host:'127.0.0.1',port:5432,user:'postgres',database:'prod'}}}),/DISPOSABLE_ONLY/));
test('cannot construct with forged user or port',()=>{for(const k of ['PGUSER','PGPORT','PGPASSWORD','NODE_ENV','CAR02_BASIC_PG17_QA'])assert.throws(()=>make({envPatch:{[k]:'forged'}}),/DISPOSABLE_ONLY/)});
test('rejects unverified staff without looking up',async()=>{const records=[];await assert.rejects(make({records}).prepare({...input,actor:{...actor,verified:false}}),/TRUSTED_STAFF_REQUIRED/);assert.equal(records.length,0)});
test('rejects customer role even with verified property',async()=>assert.rejects(make().prepare({...input,actor:{...actor,role:'customer'}}),/TRUSTED_STAFF_REQUIRED/));
test('rejects role claims as input fields',async()=>assert.rejects(make().prepare({...input,role:'owner'}),/FIELDS_DENIED/));
test('rejects shopCode injected in body',async()=>assert.rejects(make().prepare({...input,shopCode:'other_shop'}),/FIELDS_DENIED/));
test('rejects customerId injected in body',async()=>assert.rejects(make().prepare({...input,customerId:CUSTOMER}),/FIELDS_DENIED/));
test('rejects vehicleId injected in body',async()=>assert.rejects(make().prepare({...input,vehicleId:VEHICLE}),/FIELDS_DENIED/));
test('rejects user-visible booking display IDs',async()=>assert.rejects(make().prepare({...input,reservationId:'DEMO-0001'}),/UUID_REQUIRED/));
test('rejects absent idempotency',async()=>assert.rejects(make().prepare({...input,idempotencyKey:null}),/IDEMPOTENCY_REQUIRED/));
test('rejects malformed idempotency',async()=>assert.rejects(make().prepare({...input,idempotencyKey:'abc'}),/IDEMPOTENCY_REQUIRED/));
test('rejects DB reservation not found in verified shop',async()=>assert.rejects(make({first:null}).prepare(input),/REFERENCE_NOT_FOUND/));
test('rejects returned other tenant row',async()=>assert.rejects(make({first:{...row,shop_code:'other_shop'}}).prepare(input),/REFERENCE_NOT_FOUND/));
test('rejects returned other reservation id',async()=>assert.rejects(make({first:{...row,reservation_id:FOREIGN}}).prepare(input),/REFERENCE_NOT_FOUND/));
test('rejects returned non-UUID customer',async()=>assert.rejects(make({first:{...row,customer_id:'CUSTOMER-01'}}).prepare(input),/REFERENCE_NOT_FOUND/));
test('rejects returned non-UUID vehicle',async()=>assert.rejects(make({first:{...row,vehicle_id:'AUTO-01'}}).prepare(input),/REFERENCE_NOT_FOUND/));
test('rejects customers outside tenant checked by second query',async()=>assert.rejects(make({second:{shop_ok:true,customer_ok:false,vehicle_ok:true,reservation_ok:true}}).prepare(input),/SCOPE_DENIED/));
test('rejects vehicle outside customer checked by second query',async()=>assert.rejects(make({second:{shop_ok:true,customer_ok:true,vehicle_ok:false,reservation_ok:true}}).prepare(input),/SCOPE_DENIED/));
test('rejects reservation outside customer/vehicle checked by second query',async()=>assert.rejects(make({second:{shop_ok:true,customer_ok:true,vehicle_ok:true,reservation_ok:false}}).prepare(input),/SCOPE_DENIED/));
test('rejects missing shop in second lookup',async()=>assert.rejects(make({second:{shop_ok:false,customer_ok:true,vehicle_ok:true,reservation_ok:true}}).prepare(input),/SCOPE_DENIED/));
test('returns generic error instead of leaking SQL failure details',async()=>{await assert.rejects(make({failQuery:true}).prepare(input),e=>e.message==='CAR02_LEGACY_HANDOFF_REFERENCE_UNAVAILABLE')});
test('rejects foreign actor shop even when valid UUID',async()=>assert.rejects(make({first:null}).prepare({...input,actor:{...actor,shopCode:'other_shop'}}),/REFERENCE_NOT_FOUND/));

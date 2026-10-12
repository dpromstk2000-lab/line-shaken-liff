// DPRO CAR02 R99. Disposable PostgreSQL 17 boundary/integration QA ONLY.
// No public deploy, production database/storage, LINE or real credentials.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createCar02R94AFullStagingPipeline} from './car02-r94a-full-staging-pipeline-isolated.mjs';
import {createR93YInProcessStorageFixture,createR93YIsolatedStorageProtocol} from './car02-r93y-qa-storage-http-fixture.mjs';

export const R99_DB='car02_r93q_qa_ci';
export const R99_SHOP='street_house_kitsuki';
export const R99_ORIGIN='https://r99-boundary-fixture.invalid';
export const R99_ORDER='22222222-2222-4222-8222-222222222222';
export const R99_REPORT='33333333-3333-4333-8333-333333333333';
export const R99_STAFF='11111111-1111-4111-8111-111111111111';
export const R99_INACTIVE='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const R99_MAX_UPLOAD=5242880;
export const R99_EXPECTED_ENV=Object.freeze({
 R99_DISPOSABLE_BOUNDARY_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',
 PGUSER:'postgres',PGPASSWORD:'disposable-r93s-ci-only',PGDATABASE:R99_DB
});
const TOKENS=Object.freeze({valid:'Bearer qa-valid-r99-fixture',foreign:'Bearer qa-foreign-r99-fixture',
 inactive:'Bearer qa-inactive-r99-fixture',guest:'Bearer qa-guest-r99-fixture'});
const JPEG=new Uint8Array([255,216,255,224,21,22,23,24,25,26]);
const endpoint=`${R99_ORIGIN}/functions/v1/dpro-car02-stage/api/car02/uploads/${R99_ORDER}/${R99_REPORT}`;
const business=`${R99_ORIGIN}/functions/v1/dpro-car02-stage/api/car02`;
function key(n){return '88888888-8888-4888-8888-'+String(n).padStart(12,'0');}
export function assertR99Environment(env){
 for(const [name,value] of Object.entries(R99_EXPECTED_ENV))
  assert.equal(env?.[name],value,'R99_NOT_DISPOSABLE_'+name);
 return true;
}
export function createR99QARequest({url=endpoint,method='POST',origin=R99_ORIGIN,
 token=TOKENS.valid,intent=501,mime='image/jpeg',bytes=JPEG,extra={}}={}){
 const headers={origin,authorization:token,'content-type':mime,'idempotency-key':key(intent),...extra};
 return new Request(url,{method,headers,...(method==='POST'?{body:new Uint8Array(bytes)}:{})});
}
export function createR99QARig({pool,reviewGate=async()=>true,config={},authenticate}={}){
 if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function'||
    typeof reviewGate!=='function'||(authenticate!==undefined&&typeof authenticate!=='function'))
  throw Error('R99_DISPOSABLE_DEPS_REQUIRED');
 const fixture=createR93YInProcessStorageFixture(config);
 const storage=createR93YIsolatedStorageProtocol({environment:'isolated_qa',dbName:R99_DB,fixture});
 const resolver=authenticate||(async request=>{
  const auth=request.headers.get('authorization');
  if(auth===TOKENS.valid)return {verified:true,shopCode:R99_SHOP,role:'staff',subject:'staff:'+R99_STAFF};
  if(auth===TOKENS.foreign)return {verified:true,shopCode:'other_shop',role:'staff',subject:'staff:'+R99_STAFF};
  if(auth===TOKENS.inactive)return {verified:true,shopCode:R99_SHOP,role:'staff',subject:'staff:'+R99_INACTIVE};
  return {verified:false,shopCode:R99_SHOP,role:'guest',subject:'not-staff'};
 });
 const handle=createCar02R94AFullStagingPipeline({environment:'isolated_qa',dbName:R99_DB,
  shopCode:R99_SHOP,pool,storage,reviewGate,authenticate:resolver,origins:[R99_ORIGIN]});
 return {fixture,handle};
}
export async function readR99State(pool){
 const {rows:db}=await pool.query(`SELECT current_database() AS db,
  current_setting('server_version_num')::integer AS pg,
  to_regclass('public.ksh_car02_photos') IS NULL AS no_live,
  to_regclass('car02_r93q_qa.photos') IS NOT NULL AS disposable_photos,
  to_regclass('car02_r93q_qa.upload_intents') IS NOT NULL AS durable_intents,
  to_regclass('car02_r93q_qa.cleanup_jobs') IS NOT NULL AS recovery_outbox`);
 assert.equal(db.length,1);
 assert.equal(db[0].db,R99_DB,'R99_DB_IDENTITY');
 assert.ok(db[0].pg>=170000&&db[0].pg<180000,'R99_POSTGRES17_REQUIRED');
 assert.equal(db[0].no_live,true,'R99_LIVE_TABLE_PRESENT');
 assert.equal(db[0].disposable_photos,true);
 assert.equal(db[0].durable_intents,true);
 assert.equal(db[0].recovery_outbox,true);
 const {rows:photos}=await pool.query(`SELECT id,shop_code,upload_state FROM car02_r93q_qa.photos ORDER BY id`);
 const {rows:intents}=await pool.query(`SELECT shop_code,intent_key,photo_id FROM car02_r93q_qa.upload_intents ORDER BY intent_key`);
 const {rows:outbox}=await pool.query(`SELECT shop_code,photo_id,state FROM car02_r93q_qa.cleanup_jobs ORDER BY job_id`);
 return {photos,intents,outbox};
}
export async function runR99AdversarialCases(pool){
 assert.deepEqual(await readR99State(pool),{photos:[],intents:[],outbox:[]},'R99_NONEMPTY_DISPOSABLE_DB');
 const locked=createR99QARig({pool,reviewGate:async()=>false});
 assert.equal((await locked.handle(createR99QARequest())).status,503);
 assert.equal(locked.fixture.calls.length,0,'R99_LOCK_READ_STORAGE');
 const {handle,fixture}=createR99QARig({pool});
 const failures=[
  [{origin:'https://unapproved.invalid'},403,'foreign_origin'],
  [{token:TOKENS.foreign},401,'foreign_tenant_actor'],
  [{token:TOKENS.guest},401,'guest_actor'],
  [{token:TOKENS.inactive},503,'inactive_staff'],
  // Foreign tenant identity is rejected by the R93V auth bridge BEFORE R82; this is HTTP 401, not 403.
  [{extra:{'x-shop-code':'other_shop'},intent:502,token:TOKENS.foreign},401,'header_spoof'],
  [{url:`${R99_ORIGIN}/api/car02/uploads/${R99_ORDER}/${R99_REPORT}`},404,'unprefixed_route'],
  [{url:endpoint+'?shop=other_shop'},404,'query_tenant_spoof'],
  [{url:business,bytes:new Uint8Array(32769)},413,'business_cap_32k'],
  [{bytes:new Uint8Array(R99_MAX_UPLOAD+1)},413,'upload_cap_5m'],
  [{mime:'application/octet-stream'},415,'bad_mime'],
  [{extra:{'x-line-id-token':'fake-id-token'}},403,'line_not_staff'],
  [{extra:{'idempotency-key':'bad-key'}},400,'bad_intent_key'],
  [{url:`${R99_ORIGIN}/functions/v1/dpro-car02-stage/api/car02/uploads/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`},503,'foreign_order'],
 ];
 for(const [options,status,name] of failures){
  const response=await handle(createR99QARequest(options));
  assert.equal(response.status,status,`R99_NEGATIVE_${name}`);
  if(name==='header_spoof') {
   const body=await response.json();
   assert.equal(body.ok,false,'R99_HEADER_SPOOF_FALSIFIED_SUCCESS');
   assert.equal(body.code,'CAR02_UNAUTHORIZED','R99_HEADER_SPOOF_AUTH_FAILURE');
  }
 }
 const initial=await readR99State(pool);
 assert.deepEqual(initial,{photos:[],intents:[],outbox:[]},'R99_REJECTED_REQUEST_CREATED_DB_ROWS');
 assert.equal(fixture.posts,0,'R99_REJECTED_REQUEST_POSTED_OBJECT');
 // CORS approved; no DB/Storage mutation, and header names are tightly scoped.
 const optionsHeaders={'access-control-request-method':'POST',
  'access-control-request-headers':'authorization,content-type,idempotency-key'};
 assert.equal((await handle(createR99QARequest({method:'OPTIONS',extra:optionsHeaders}))).status,204);
 assert.equal((await handle(createR99QARequest({method:'OPTIONS',extra:{...optionsHeaders,
  'access-control-request-headers':'authorization,content-type,idempotency-key,x-shop-code'}}))).status,403);
 assert.deepEqual(await readR99State(pool),initial);
 // First real, disposable photo: READY only after Storage read-back and DB proof.
 const one=await handle(createR99QARequest({intent:601}));
 assert.equal(one.status,201,'R99_FIRST_UPLOAD');
 const first=await one.json();assert.equal(first.state,'ready');
 assert.equal(fixture.posts,1);
 const repeat=await handle(createR99QARequest({intent:601}));
 assert.equal(repeat.status,201,'R99_RETRY');
 assert.equal((await repeat.json()).photoId,first.photoId,'R99_IDEMPOTENCY_REUSED_ID');
 assert.equal(fixture.posts,1,'R99_IDEMPOTENCY_REUPLOADED');
 const changed=new Uint8Array(JPEG);changed[changed.length-1]^=1;
 assert.equal((await handle(createR99QARequest({intent:601,bytes:changed}))).status,503,'R99_KEY_REUSE_CONFLICT');
 assert.equal(fixture.posts,1,'R99_KEY_REUSE_OVERWROTE');
 // A spoofed shop header on an otherwise valid staff request cannot change tenant scope.
 const spoof=await handle(createR99QARequest({intent:605,extra:{'x-shop-code':'other_shop'}}));
 assert.equal(spoof.status,201,'R99_VALID_ACTOR_SCOPE_NOT_OVERRIDDEN_BY_HEADER');
 assert.equal(fixture.posts,2,'R99_HEADER_SPOOF_WRONG_POST_COUNT');
 // A failed Storage write must become a durable tombstone and recovery outbox.
 const failing=createR99QARig({pool,config:{postFailure:true}});
 assert.equal((await failing.handle(createR99QARequest({intent:602}))).status,503,'R99_STORAGE_FAILURE_REJECTED');
 assert.equal(failing.fixture.posts,1);
 // Lost POST acknowledgment with verified read-back must still become one READY photo.
 const lost=createR99QARig({pool,config:{postAckLost:true}});
 assert.equal((await lost.handle(createR99QARequest({intent:603}))).status,201,'R99_LOST_ACK_READBACK');
 assert.equal(lost.fixture.posts,1);
 // A public bucket cannot be accepted or create another intent.
 const publicBucket=createR99QARig({pool,config:{publicBucket:true}});
 assert.equal((await publicBucket.handle(createR99QARequest({intent:604}))).status,503,'R99_PUBLIC_BUCKET_DENIED');
 assert.equal(publicBucket.fixture.posts,0);
 const final=await readR99State(pool);
 assert.equal(final.photos.length,4,'R99_PHOTO_COUNT');
 assert.equal(final.photos.filter(x=>x.upload_state==='ready').length,3,'R99_READY_COUNT');
 assert.equal(final.photos.filter(x=>x.upload_state==='deleted').length,1,'R99_TOMBSTONE_COUNT');
 assert.equal(final.intents.length,4,'R99_INTENT_COUNT');
 assert.equal(final.outbox.length,1,'R99_CLEANUP_OUTBOX_COUNT');
 assert.equal(final.outbox[0].shop_code,R99_SHOP,'R99_OUTBOX_SCOPE');
 assert.ok(final.photos.every(x=>x.shop_code===R99_SHOP),'R99_CROSS_TENANT_WRITE');
 assert.ok(final.intents.every(x=>x.shop_code===R99_SHOP),'R99_CROSS_TENANT_INTENT');
 assert.equal(final.outbox[0].photo_id,final.photos.find(x=>x.upload_state==='deleted').id,'R99_OUTBOX_BINDING');
 console.log('R99_NEGATIVE_13_13_PASS');
 console.log('R99_IDEMPOTENCY_AND_FAIL_CLOSED_PASS');
 console.log('R99_PRIVATE_STORAGE_TOMBSTONE_OUTBOX_PASS');
 console.log('R99_DISPOSABLE_BOUNDARY_VERIFIED_PASS');
 return {cases:13,photos:final.photos.length,ready:3,deleted:1,intents:4,outbox:1,
  productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'};
}
export const R99_CONTRACT=Object.freeze({qaOnly:true,disposablePg17Only:true,
 fakeAuthOnly:true,storage:'in_process_http_fixture',liveWiring:false,
 productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD',
 r47r50r51r52Immutable:true,deployAuthorized:false,lineDispatchAllowed:false});
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 assertR99Environment(process.env);
 const {default:pg}=await import('pg');
 const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',
  password:'disposable-r93s-ci-only',database:R99_DB,max:5,
  connectionTimeoutMillis:2500,idleTimeoutMillis:1000,
  application_name:'car02_r99_disposable_only'});
 try{await runR99AdversarialCases(pool)}finally{await pool.end()}
}

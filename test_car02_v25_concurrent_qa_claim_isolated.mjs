import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02V25QaClaim, V25_LOCK_SQL, V25_MODE} from './car02-v25-concurrent-qa-claim-isolated.mjs';
const UUID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SHOP='qa_ksh_shop';
const C='11111111-1111-4111-8111-111111111111', V='22222222-2222-4222-8222-222222222222';
const ACTOR={verified:true,role:'staff',subject:'synthetic-staff',shopCode:SHOP};
const ENV={GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',CAR02_BASIC_PG17_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'};
const OPTIONS={host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa'};
const BINDINGS={ksh:SHOP,wangan:'qa_wangan_shop'};
const ROW={reservation_id:UUID,shop_code:SHOP,customer_id:C,vehicle_id:V,
 lifecycle_status:'入庫予定',lifecycle_version:7,reservation_date:'2026-10-21',reservation_time:'10:30',real_order_exists:false};
const INPUT={actor:ACTOR,branch:'ksh',reservationId:UUID,expectedVersion:7,idempotencyKey:'SYNTHETIC_CLAIM_KEY_1'};
const makePool=({row=ROW,existing=null,inserted=true,broken=false}={},log=[])=>({
 options:{...OPTIONS},connect:async()=>({query:async(sql,args)=>{
  log.push({sql,args});if(broken&&sql.includes('SELECT r.id'))throw Error('SYNTHETIC_PG_ERROR');
  if(sql.includes('SELECT r.id'))return{rows:row?[row]:[]};
  if(sql.includes('SELECT idempotency_key'))return{rows:existing?[{idempotency_key:existing}]:[]};
  if(sql.includes('INSERT INTO public.car02_v25_qa_claims'))return{rows:inserted?[{reservation_id:UUID}]:[]};
  return{rows:[]};
 },release:()=>log.push({sql:'RELEASE'})})});
const make=(pool=makePool(),o={})=>createCar02V25QaClaim({pool,env:{...ENV},environment:'disposable_qa',allowDisposableQa:true,branchBindings:{...BINDINGS},...o});
const throws=(fn,code)=>assert.throws(fn,new RegExp(code));
const rejects=(fn,code)=>assert.rejects(fn,new RegExp(code));
const checkResult=x=>{assert.equal(x.sendable,false);assert.equal(x.safeToCreateRealOrder,false);assert.equal(x.businessMutation,false);assert.equal(x.release,'NO_GO');assert.equal(x.migration,'HOLD');assert.ok(Object.isFrozen(x))};

test('V2.5 never promises production readiness',()=>{assert.equal(V25_MODE.productionReady,false);assert.equal(V25_MODE.realAuthorization,false);assert.equal(V25_MODE.realOrderWrite,false);assert.equal(V25_MODE.release,'NO_GO');assert.equal(V25_MODE.migration,'HOLD')});
test('lock query scoped UUID, tenant and lifecycle row',()=>{assert.match(V25_LOCK_SQL,/r\.id=\$1::uuid AND r\.shop_code=\$2/);assert.match(V25_LOCK_SQL,/FOR UPDATE OF s/)});
test('no legacy API endpoint or work order INSERT',()=>{assert.ok(!V25_LOCK_SQL.includes('/api/'));assert.ok(!V25_LOCK_SQL.includes('INSERT'))});
test('no production mode',()=>throws(()=>make(makePool(),{environment:'production'}),'DISPOSABLE_ONLY'));
test('requires explicit QA optin',()=>throws(()=>make(makePool(),{allowDisposableQa:false}),'DISPOSABLE_ONLY'));
for(const [key,value] of [['GITHUB_ACTIONS','false'],['NODE_ENV','production'],['CAR02_RELEASE_LOCK','false'],['CAR02_BASIC_PG17_QA','no'],['PGHOST','real-host'],['PGDATABASE','production'],['PGUSER','admin'],['PGPASSWORD','changed'],['PGPORT','6432']])
 test('rejects invalid QA env '+key,()=>throws(()=>make(makePool(),{env:{...ENV,[key]:value}}),'DISPOSABLE_ONLY'));
for(const [key,value] of [['host','production-db'],['database','production'],['user','admin'],['password','changed'],['port',6432]])
 test('rejects invalid pool '+key,()=>{const p=makePool();p.options[key]=value;throws(()=>make(p),'DISPOSABLE_ONLY')});
test('requires both distinct branch bindings',()=>throws(()=>make(makePool(),{branchBindings:{ksh:SHOP,wangan:SHOP}}),'DISPOSABLE_ONLY'));
test('requires plain env input',()=>throws(()=>make(makePool(),{env:new Map()}),'DISPOSABLE_ONLY'));
test('requires pool connect',()=>throws(()=>make({options:{...OPTIONS}}),'DISPOSABLE_ONLY'));
test('rejects customer actor',async()=>rejects(()=>make().claim({...INPUT,actor:{...ACTOR,role:'customer'}}),'QA_ACTOR_REQUIRED'));
test('rejects forged verified actor',async()=>rejects(()=>make().claim({...INPUT,actor:{...ACTOR,verified:false}}),'QA_ACTOR_REQUIRED'));
test('rejects absent staff identity',async()=>rejects(()=>make().claim({...INPUT,actor:{...ACTOR,subject:''}}),'QA_ACTOR_REQUIRED'));
test('rejects mismatched shop',async()=>rejects(()=>make().claim({...INPUT,actor:{...ACTOR,shopCode:'qa_wangan_shop'}}),'BRANCH_SCOPE_DENIED'));
test('rejects forged branch',async()=>rejects(()=>make().claim({...INPUT,branch:'wangan'}),'BRANCH_SCOPE_DENIED'));
test('rejects unrecognized branch',async()=>rejects(()=>make().claim({...INPUT,branch:'admin'}),'BRANCH_SCOPE_DENIED'));
test('rejects display ID',async()=>rejects(()=>make().claim({...INPUT,reservationId:'DEMO-101'}),'UUID_REQUIRED'));
test('rejects invalid version',async()=>rejects(()=>make().claim({...INPUT,expectedVersion:0}),'VERSION_REQUIRED'));
test('rejects missing idempotency key',async()=>rejects(()=>make().claim({...INPUT,idempotencyKey:''}),'KEY_REQUIRED'));
test('rejects unsafe key characters',async()=>rejects(()=>make().claim({...INPUT,idempotencyKey:'synthetic-qa-key;$'}),'KEY_REQUIRED'));
test('rejects browser claims',async()=>rejects(()=>make().claim({...INPUT,customerId:C}),'FIELDS_DENIED'));
test('rejects tenant injection',async()=>rejects(()=>make().claim({...INPUT,shopCode:SHOP}),'FIELDS_DENIED'));
test('synthetic row claims QA only',async()=>{const e=[],x=await make(makePool({},e)).claim(INPUT);assert.equal(x.result,'CLAIMED_QA');checkResult(x);assert.ok(e.some(y=>y.sql.includes('INSERT INTO public.car02_v25_qa_claims')));assert.ok(!e.some(y=>/INSERT INTO public\.ksh_car02_work_orders/.test(y.sql)))});
test('returns HOLD for missing reservation',async()=>{const x=await make(makePool({row:null})).claim(INPUT);assert.equal(x.reason,'RESERVATION_NOT_FOUND');checkResult(x)});
test('returns HOLD on shop mismatch',async()=>{const x=await make(makePool({row:{...ROW,shop_code:'fake'}})).claim(INPUT);assert.equal(x.reason,'SCOPE_NOT_PROVEN')});
test('returns HOLD on customer missing',async()=>{const x=await make(makePool({row:{...ROW,customer_id:null}})).claim(INPUT);assert.equal(x.reason,'SCOPE_NOT_PROVEN')});
test('returns HOLD on existing real order',async()=>{const x=await make(makePool({row:{...ROW,real_order_exists:true}})).claim(INPUT);assert.equal(x.reason,'REAL_ORDER_ALREADY_EXISTS')});
test('returns HOLD for stale version',async()=>{const x=await make(makePool({row:{...ROW,lifecycle_version:8}})).claim(INPUT);assert.equal(x.reason,'STALE_BOOKING_VERSION')});
for(const status of ['キャンセル','作業完了','点検中',''] )
 test('returns HOLD for state '+status,async()=>{const x=await make(makePool({row:{...ROW,lifecycle_status:status}})).claim(INPUT);assert.equal(x.reason,'BOOKING_NOT_ELIGIBLE')});
test('returns HOLD on bad slot',async()=>{const x=await make(makePool({row:{...ROW,reservation_time:'10:15'}})).claim(INPUT);assert.equal(x.reason,'SLOT_INVALID')});
test('returns HOLD on malformed date',async()=>{const x=await make(makePool({row:{...ROW,reservation_date:'2026-02-30'}})).claim(INPUT);assert.equal(x.reason,'SLOT_INVALID')});
test('same key replay is stable and nonsendable',async()=>{const x=await make(makePool({existing:INPUT.idempotencyKey})).claim(INPUT);assert.equal(x.result,'REPLAY_QA');checkResult(x)});
test('other key on same reservation is HOLD',async()=>{const x=await make(makePool({existing:'ANOTHER_SYNTHETIC_KEY'})).claim(INPUT);assert.equal(x.reason,'BOOKING_ALREADY_CLAIMED');checkResult(x)});
test('replay after cancellation stays HOLD, not replayed',async()=>{const x=await make(makePool({existing:INPUT.idempotencyKey,row:{...ROW,lifecycle_status:'キャンセル'}})).claim(INPUT);assert.equal(x.result,'HOLD');assert.equal(x.reason,'BOOKING_NOT_ELIGIBLE')});
test('cross-reservation conflict is HOLD',async()=>{const x=await make(makePool({inserted:false})).claim(INPUT);assert.equal(x.reason,'CLAIM_CONFLICT')});
test('transaction error rolls back',async()=>{const e=[];await rejects(()=>make(makePool({broken:true},e)).claim(INPUT),'TRANSACTION_UNAVAILABLE');assert.ok(e.some(x=>x.sql==='ROLLBACK'));assert.ok(e.some(x=>x.sql==='RELEASE'))});
test('valid transaction locks first and commits',async()=>{const e=[];await make(makePool({},e)).claim(INPUT);assert.match(e[0].sql,/BEGIN TRANSACTION/);assert.equal(e[1].sql,V25_LOCK_SQL);assert.deepEqual(e[1].args,[UUID,SHOP]);assert.ok(e.some(x=>x.sql==='COMMIT'));assert.equal(e.at(-1).sql,'RELEASE')});
test('no external API calls',()=>{const x=make();for(const k of ['send','deploy','createOrder','book','release','updateCustomer','notifyLine'])assert.equal(typeof x[k],'undefined')});

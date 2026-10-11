import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93OIsolatedOutboxIdentityGuard as create,R93O_CONTRACT as C} from './car02-r93o-outbox-identity-guard-isolated.mjs';
const p='44444444-4444-4444-8444-444444444444';
const o='22222222-2222-4222-8222-222222222222';
const r='33333333-3333-4333-8333-333333333333';
const staff='11111111-1111-4111-8111-111111111111';
const shop='street_house_kitsuki';
const path=`${shop}/${o}/${r}/77777777-7777-4777-8777-777777777777.jpg`;
const obj={photoId:p,shopCode:shop,orderId:o,reportId:r,bucket:'ksh-car02-private-photos',path,mimeType:'image/jpeg',byteSize:777,sha256:'a'.repeat(64),actor:{verified:true,shopCode:shop,role:'staff',subject:`staff:${staff}`}};
const goodRow={id:p,shop_code:shop,order_id:o,report_id:r,storage_bucket:obj.bucket,storage_path:path,mime_type:'image/jpeg',byte_size:'777',sha256:obj.sha256,upload_state:'ready',order_status:'draft'};
function mock(over={}){
 let calls=[],released=false,jobs=over.jobs||[];
 const client={release(){released=true},async query(sql,params){calls.push({sql,params});
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL'))return {rows:[]};
  if(sql.includes('current_database()'))return {rows:[{db:over.db||'car02_r93o_qa_ci',staff_table:true,photo_table:true,jobs_table:true,no_live_photos:true,...over.schema}]};
  if(sql.includes('FROM car02_r93o_qa.staff'))return {rows:over.staffRows??[{active:true,role:'staff'}]};
  if(sql.includes('FROM car02_r93o_qa.photos p'))return {rows:over.photoRows??[{...goodRow,...over.photo}]};
  if(sql.includes('FROM car02_r93o_qa.cleanup_jobs')){
    // Faithfully simulate WHERE photo_id=$1 (no matching shop/path restriction).
    assert.deepEqual(params,[p]);
    return {rows:over.jobRows??[{n:jobs.filter(x=>x.photo_id===p).length}]};
  }
  throw Error('unexpected query '+sql)
 }};
 const pool={async connect(){calls.push({sql:'CONNECT'});if(over.connectionError)throw Error('no conn');return client;}};
 const gate=over.gate||(async()=>true);
 return {guard:create({environment:'isolated_qa',dbName:'car02_r93o_qa_ci',shopCode:shop,pool,reviewGate:gate}),calls,get released(){return released}};
}
test('valid ready evidence succeeds when no cleanup exists',async()=>{
 const m=mock();const z=await m.guard.proveCommittedReady(obj);
 assert.equal(z.ready,true);assert.equal(z.releaseDecision,'NO_GO');assert.equal(z.migrationDecision,'HOLD');
 assert.ok(m.calls.some(x=>x.sql==='COMMIT'));assert.equal(m.released,true);
});
for(const [name,job] of [
 ['same shop same path',{photo_id:p,shop_code:shop,storage_path:path}],
 ['same photo wrong path',{photo_id:p,shop_code:shop,storage_path:'foreign/path.jpg'}],
 ['same photo wrong shop',{photo_id:p,shop_code:'other_shop',storage_path:path}],
 ['same photo wrong both',{photo_id:p,shop_code:'other_shop',storage_path:'foreign/path.jpg'}]
]) test(`outbox collision blocks ${name}`,async()=>{
 const m=mock({jobs:[job]});await assert.rejects(m.guard.proveCommittedReady(obj),{code:'R93O_OUTBOX_CONFLICT'});
 assert.ok(m.calls.some(x=>x.sql==='ROLLBACK'));
 assert.ok(!m.calls.some(x=>x.sql==='COMMIT'));
});
test('outbox for a different photo must not deny ready evidence',async()=>{
 const m=mock({jobs:[{photo_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',shop_code:shop,storage_path:path}]});
 assert.equal((await m.guard.proveCommittedReady(obj)).ready,true);
});
test('malformed outbox count is never success',async()=>{
 for(const rows of [[],[{n:'0'}],[{n:-1}],[{n:NaN}],[{n:null}],[{n:0},{n:0}]]){
  const m=mock({jobRows:rows});await assert.rejects(m.guard.proveCommittedReady(obj),{code:'R93O_OUTBOX_CONFLICT'});
 }
});
for(const [name,change] of [
 ['shop',{shopCode:'other_shop'}], ['report',{reportId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}],
 ['path',{path:path.replace('.jpg','.png')}],['bucket',{bucket:'public'}],
 ['hash',{sha256:'x'.repeat(64)}],['byte size',{byteSize:5242881}],
 ['mime',{mimeType:'application/octet-stream'}],['actor',{actor:{...obj.actor,verified:false}}]
]) test(`invalid input denies ${name} without DB connection`,async()=>{
 const m=mock();await assert.rejects(m.guard.proveCommittedReady({...obj,...change}),{code:'R93O_INVALID_SCOPE'});
 assert.deepEqual(m.calls,[]);
});
for(const [name,change] of [
 ['photo ID',{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}],['path',{storage_path:'different/path.jpg'}],['tenant',{shop_code:'other_shop'}],
 ['photo id',{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}],
 ['byte size',{byte_size:789}],['digest',{sha256:'b'.repeat(64)}],
 ['state',{upload_state:'pending'}],['order',{order_status:'completed'}]
]) test(`photo mismatch ${name} fails closed`,async()=>{
 const m=mock({photo:change});await assert.rejects(m.guard.proveCommittedReady(obj),{code:'R93O_READY_PROOF_FAILED'});
 assert.ok(m.calls.some(x=>x.sql==='ROLLBACK'));
});
for(const rows of [[],[{role:'owner',active:true}],[{role:'staff',active:false}]])test(`staff validation refuses ${JSON.stringify(rows)}`,async()=>{
 const m=mock({staffRows:rows});await assert.rejects(m.guard.proveCommittedReady(obj),{code:'R93O_STAFF_DENIED'});
});
test('false review gate forbids connection',async()=>{
 const m=mock({gate:async()=>false});await assert.rejects(m.guard.proveCommittedReady(obj),{code:'R93O_GATE_CLOSED'});
 assert.deepEqual(m.calls,[]);
});
test('review gate errors deny without connection',async()=>{
 const m=mock({gate:async()=>{throw Error('offline')}});await assert.rejects(m.guard.proveCommittedReady(obj),{code:'R93O_GATE_CLOSED'});
 assert.deepEqual(m.calls,[]);
});
test('non-disposable DB denied',async()=>{
 const m=mock({db:'real_production'});await assert.rejects(m.guard.proveCommittedReady(obj),{code:'R93O_DISPOSABLE_DB_REQUIRED'});
});
test('missing table denies',async()=>{
 const m=mock({schema:{jobs_table:false}});await assert.rejects(m.guard.proveCommittedReady(obj),{code:'R93O_DISPOSABLE_DB_REQUIRED'});
});
test('connection exception sanitizes error',async()=>{
 const m=mock({connectionError:true});await assert.rejects(m.guard.proveCommittedReady(obj),{code:'R93O_PROOF_UNAVAILABLE'});
});
test('isolation constructor rejects unauthorized environments',()=>{
 const m=mock();const good={pool:{connect(){return {}}},reviewGate:()=>true,dbName:'car02_r93o_qa_ci',shopCode:shop};
 for(const x of [{...good,environment:'production'},{...good,environment:'isolated_qa',dbName:'production'},{...good,environment:'isolated_qa',pool:null}])
  assert.throws(()=>create(x),{code:'R93O_ISOLATION_REQUIRED'});
});
test('contracts remain hard locked',()=>{
 assert.equal(C.productionReady,false);assert.equal(C.liveWiring,false);assert.equal(C.noProductionMigration,true);
 assert.equal(C.anyOutboxRowForPhotoBlocksReady,true);assert.equal(C.releaseDecision,'NO_GO');assert.equal(C.migrationDecision,'HOLD');
});
test('SQL photo-id-only lookup, not a shop/path triple',async()=>{
 const m=mock();await m.guard.proveCommittedReady(obj);
 const q=m.calls.find(x=>x.sql.includes('FROM car02_r93o_qa.cleanup_jobs')).sql;
 assert.match(q,/WHERE photo_id=\$1/);assert.doesNotMatch(q,/(shop_code|storage_path)\s*=/);
});

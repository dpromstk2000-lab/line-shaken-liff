import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93SDurableUploadIntentQA,R93S_CONTRACT} from './car02-r93s-durable-upload-intent-isolated.mjs';
const D='car02_r93q_qa_ci';
const SHOP='street_house_kitsuki';
const O='22222222-2222-4222-8222-222222222222';
const R='33333333-3333-4333-8333-333333333333';
const U='11111111-1111-4111-8111-111111111111';
const x=()=>({shopCode:SHOP,orderId:O,reportId:R,
 intentKey:'44444444-4444-4444-8444-444444444444',bucket:'ksh-car02-private-photos',
 path:`${SHOP}/${O}/${R}/77777777-7777-4777-8777-777777777777.jpg`,mimeType:'image/jpeg',
 byteSize:200,sha256:'a'.repeat(64),actor:{verified:true,shopCode:SHOP,role:'staff',subject:`staff:${U}`}});
const service=(pool={connect:async()=>{throw Error('no connection');}},gate=async()=>true,config={})=>createR93SDurableUploadIntentQA({environment:'isolated_qa',dbName:D,shopCode:SHOP,pool,reviewGate:gate,...config});
for(const [name,m] of [
 ['shop mismatch',y=>y.shopCode='other_shop'],
 ['missing intent key',y=>delete y.intentKey],
 ['non UUID intent',y=>y.intentKey='bad'],
 ['cross tenant actor',y=>y.actor.shopCode='other_shop'],
 ['unverified actor',y=>y.actor.verified=false],
 ['unsupported role',y=>y.actor.role='admin'],
 ['wrong actor prefix',y=>y.actor.subject=U],
 ['missing actor',y=>delete y.actor],
 ['other report path',y=>y.path=y.path.replace(R,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')],
 ['extension spoof',y=>y.path=y.path.replace('.jpg','.png')],
 ['traversal',y=>y.path+='../../x'],
 ['wrong bucket',y=>y.bucket='public'],
 ['unsupported MIME',y=>y.mimeType='image/gif'],
 ['too small image',y=>y.byteSize=3],
 ['too large image',y=>y.byteSize=5242881],
 ['fractional image bytes',y=>y.byteSize=2.5],
 ['invalid hash',y=>y.sha256='not sha'],
 ['missing order id',y=>delete y.orderId],
 ['missing report id',y=>delete y.reportId],
 ['uppercased path',y=>y.path=y.path.toUpperCase()],
 ['path alternate UUID invalid',y=>y.path=y.path.replace('77777777-7777-4777-8777-777777777777','tricked')],
]){
 test(`R93S reserve and resume deny before DB: ${name}`,async()=>{
  const y=x();m(y);let calls=0;const pool={connect:async()=>{calls++;throw Error('unexpected')}};
  await assert.rejects(service(pool).reserve(y));
  await assert.rejects(service(pool).resume(y));
  assert.equal(calls,0);
 });
}
for(const [arg,code] of [
 [{environment:'staging'},'R93S_ISOLATION_REQUIRED'],
 [{dbName:'postgres'},'R93S_ISOLATION_REQUIRED'],
 [{shopCode:'other space'},'R93S_ISOLATION_REQUIRED'],
 [{reviewGate:null},'R93S_ISOLATION_REQUIRED'],
 [{pool:null},'R93S_ISOLATION_REQUIRED']
]){
 test('R93S constructor refuses improper isolation '+JSON.stringify(arg),()=>{
  assert.throws(()=>service(undefined,undefined,arg),{code});
 });
}
test('R93S gate closed fails without opening DB connection',async()=>{
 let connects=0;const pool={connect:async()=>{connects++;throw Error('unexpected')}};
 await assert.rejects(service(pool,async()=>false).reserve(x()),{code:'R93S_GATE_CLOSED'});
 await assert.rejects(service(pool,async()=>{throw Error('gate disconnected')}).resume(x()),{code:'R93S_GATE_CLOSED'});
 assert.equal(connects,0);
});
test('R93S SQL queries use ordered parameters instead of interpolated user content',()=>{
 const fs=requireFile();
 for(const s of ['AND i.intent_key=$2','AND staff_id=$2 FOR UPDATE',
 'AND r.id=$3 FOR UPDATE OF o,r','WHERE photo_id=$1','VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
 'SET LOCAL lock_timeout',"SET LOCAL statement_timeout"])
 assert.ok(fs.includes(s),s);
 assert.doesNotMatch(fs,/client\.query\(`[^`]*\$\{x\./);
});
function requireFile(){return requireFile.cached??=requireFileText()};
function requireFileText(){return __source}
// Static source text inserted by Node fs; no dynamic runtime import or network calls.
import {readFileSync} from 'node:fs';
const __source=readFileSync(new URL('./car02-r93s-durable-upload-intent-isolated.mjs',import.meta.url),'utf8');
test('R93S public contract remains isolated and never calls Storage',()=>{
 assert.equal(R93S_CONTRACT.productionReady,false);
 assert.equal(R93S_CONTRACT.liveWiring,false);
 assert.equal(R93S_CONTRACT.idempotentAcrossProcessRestart,true);
 assert.equal(R93S_CONTRACT.noStorageUploadOrDelete,true);
 assert.equal(R93S_CONTRACT.pendingIsNotPermissionToReupload,true);
 assert.equal(R93S_CONTRACT.releaseDecision,'NO_GO');
 assert.equal(R93S_CONTRACT.migrationDecision,'HOLD');
 assert.doesNotMatch(__source,/(?:^|[^\w])(?:fetch\(|XMLHttpRequest|WebSocket|serviceRoleKey|wrangler)/);
});
test('R93S resume cannot be derived from a per-instance in-memory receipt cache',()=>{
 assert.ok(__source.includes('car02_r93q_qa.upload_intents'));
 assert.doesNotMatch(__source,/\bnew Map\(/);
 assert.ok(__source.includes('FOR UPDATE OF i,p'));
 assert.ok(__source.includes('FOR UPDATE OF o,r'));
});

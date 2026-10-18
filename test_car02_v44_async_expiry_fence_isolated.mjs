import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {createV42OfflineSessionLab,V42_MODE} from './car02-v42-signed-session-binding-isolated.mjs';
import {v43QaSignedTxReplay} from './car02-v43-signed-transaction-replay-isolated.mjs';
import {v44QaExpiryFencedReplay,V44_MODE} from './car02-v44-async-expiry-fence-isolated.mjs';
const SUB='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const digest=createHash('sha256').update('v44 synthetic intent').digest('hex');
const pair=generateKeyPairSync('ed25519');
let now=1750000000;
const lab=createV42OfflineSessionLab({privateKey:pair.privateKey,publicKey:pair.publicKey,kid:'qa-key',issuer:'qa-issuer',audience:'qa-audience',nowSeconds:()=>now});
const initialNow=()=>{now=1750000000;return now;};
function sample(overrides={},role='staff'){
 const start=initialNow();const tx={id:'tx-v44-local',state:'open'};
 const row={shop_code:'SHOP_A',user_sub:SUB,staff_role:role,active:true,auth_version:7};
 const cfg={environment:'isolated_qa',allowIsolatedQa:true,lab,token:lab.issue({sub:SUB,shopCode:'SHOP_A',role,authVersion:7,ttlSeconds:100}),tx,
 shopCode:'SHOP_A',operation:'report',idempotencyKey:'v44-key-0000000001',intentDigest:digest,
 lockMembership:async ({txId})=>({txId,lockKind:'FOR_UPDATE',row:{...row}}),
 readReplay:async()=>null,mutate:async()=>({ok:true}),...overrides};
 return {cfg,tx,row,start};
}
const denied=e=>e?.code==='CAR02_V44_QA_DENIED';
const reject=fn=>assert.rejects(fn,denied);
function saved(ctx,role='staff',version=7){return {completed:true,shopCode:'SHOP_A',subject:SUB,role,authVersion:version,
 scopeDigest:ctx.scopeDigest,intentDigest:digest,snapshot:{cached:true}};}
test('mode cannot deploy or execute real transaction',()=>{
 assert.equal(V44_MODE.deployable,false);assert.equal(V44_MODE.realDatabase,false);
 assert.equal(V44_MODE.realRowLockProven,false);assert.equal(V44_MODE.rollbackProven,false);
 assert.equal(V44_MODE.release,'NO_GO');assert.equal(V42_MODE.liveJwtProvider,false);
});
for(const role of ['staff','owner'])for(const operation of ['create','report','present','complete'])for(const mode of ['new','replay']){
 test(`fresh ${role}/${operation}/${mode} remains allowed (synthetic)`,async()=>{
  const {cfg}=sample({},role);cfg.operation=operation;
  if(mode==='replay')cfg.readReplay=async ctx=>saved(ctx,role);
  let mutations=0;cfg.mutate=async()=>{mutations++;return {ok:true};};
  const result=await v44QaExpiryFencedReplay(cfg);
  assert.equal(result.mode,mode);assert.equal(mutations,mode==='replay'?0:1);
 });
}
test('V4.3 baseline gap is reproducible: expiration during replay awaits still returns result',async()=>{
 const {cfg,start}=sample();cfg.readReplay=async ctx=>{now=start+100;return saved(ctx);};
 const result=await v43QaSignedTxReplay(cfg);assert.equal(result.mode,'replay');
});
test('V4.4 rejects expiration during replay await, without mutation',async()=>{
 const {cfg,start}=sample();let mutations=0;
 cfg.readReplay=async ctx=>{now=start+100;return saved(ctx);};
 cfg.mutate=async()=>{mutations++;return 'should not run';};
 await reject(()=>v44QaExpiryFencedReplay(cfg));assert.equal(mutations,0);
});
test('V4.4 rejects expiration during fresh replay-read, before mutation',async()=>{
 const {cfg,start}=sample();let mutations=0;
 cfg.readReplay=async()=>{now=start+100;return null};cfg.mutate=async()=>{mutations++};
 await reject(()=>v44QaExpiryFencedReplay(cfg));assert.equal(mutations,0);
});
test('V4.4 rejects expiration inside mutation; real rollback remains unproven',async()=>{
 const {cfg,start}=sample();let mutations=0;
 cfg.mutate=async()=>{mutations++;now=start+100;return {written:true}};
 await reject(()=>v44QaExpiryFencedReplay(cfg));assert.equal(mutations,1);
});
test('expired during lock denied before replay',async()=>{
 const {cfg,start,row}=sample();let reads=0;
 cfg.lockMembership=async({txId})=>{now=start+100;return {txId,lockKind:'FOR_UPDATE',row:{...row}}};
 cfg.readReplay=async()=>{reads++;return null};
 await reject(()=>v44QaExpiryFencedReplay(cfg));assert.equal(reads,0);
});
for(const type of ['replay','mutation'])for(const seconds of [1,10,50,99]){
 test(`still valid with ${seconds}s delay in ${type} (expiry strictly later)`,async()=>{
  const {cfg,start}=sample();
  if(type==='replay')cfg.readReplay=async ctx=>{now=start+seconds;return saved(ctx)};
  else cfg.mutate=async()=>{now=start+seconds;return {ok:true}};
  const result=await v44QaExpiryFencedReplay(cfg);
  assert.equal(result.mode,type==='replay'?'replay':'new');
 });
}
for(const field of ['active','staff_role','auth_version','shop_code','user_sub']){
 test(`reject membership ${field} changed to unauthorized`,async()=>{
  const {cfg,row}=sample();const changes={active:false,staff_role:'owner',auth_version:8,shop_code:'SHOP_B',user_sub:OTHER};
  cfg.lockMembership=async({txId})=>({txId,lockKind:'FOR_UPDATE',row:{...row,[field]:changes[field]}});
  await reject(()=>v44QaExpiryFencedReplay(cfg));
 });
}
for(const [label,change] of [['wrong shop',{shopCode:'SHOP_B'}],['invalid operation',{operation:'delete'}],
 ['wrong execution mode',{environment:'production'}],['missing optin',{allowIsolatedQa:false}],
 ['no lock',{lockMembership:null}],['no replay',{readReplay:null}],['no mutation',{mutate:null}]]){
 test(`invalid configuration ${label} rejected`,async()=>{const {cfg}=sample(change);await reject(()=>v44QaExpiryFencedReplay(cfg))});
}
for(const key of ['role','authVersion','shopCode','subject','scopeDigest','intentDigest','completed']){
 test(`unauthorized replay ${key} rejected`,async()=>{
  const {cfg}=sample();const fake={role:'owner',authVersion:8,shopCode:'SHOP_B',subject:OTHER,scopeDigest:'1'.repeat(64),intentDigest:'2'.repeat(64),completed:false};
  cfg.readReplay=async ctx=>({...saved(ctx),[key]:fake[key]});
  await reject(()=>v44QaExpiryFencedReplay(cfg));
 });
}
for(const type of ['lock','read','mutate']){
 test(`closed transaction during ${type} rejected`,async()=>{
  const {cfg,tx,row}=sample();
  if(type==='lock')cfg.lockMembership=async({txId})=>{tx.state='committed';return {txId,lockKind:'FOR_UPDATE',row:{...row}}};
  if(type==='read')cfg.readReplay=async()=>{tx.state='committed';return null};
  if(type==='mutate')cfg.mutate=async()=>{tx.state='committed';return {ok:true}};
  await reject(()=>v44QaExpiryFencedReplay(cfg));
 });
}
test('tampered token rejected before lock',async()=>{
 const {cfg}=sample();let locks=0;
 cfg.token=cfg.token.slice(0,-6)+'ABCDEF';cfg.lockMembership=async()=>{locks++;throw Error('no')};
 await reject(()=>v44QaExpiryFencedReplay(cfg));assert.equal(locks,0);
});
test('reused same token after expiry rejects',async()=>{
 const {cfg,start}=sample();const one=await v44QaExpiryFencedReplay(cfg);assert.equal(one.mode,'new');
 now=start+100;await reject(()=>v44QaExpiryFencedReplay(cfg));
});
test('snapshot cloned, cannot mutate stored replay',async()=>{
 const {cfg}=sample();const snapshot={nested:{ok:true}};
 cfg.readReplay=async ctx=>({...saved(ctx),snapshot});
 const a=await v44QaExpiryFencedReplay(cfg);a.result.nested.ok=false;assert.equal(snapshot.nested.ok,true);
});

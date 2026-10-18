import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {createV42OfflineSessionLab,V42_MODE} from './car02-v42-signed-session-binding-isolated.mjs';
import {v43QaSignedTxReplay,V43_MODE} from './car02-v43-signed-transaction-replay-isolated.mjs';
const SUB='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let now=1750000000;
const pair=generateKeyPairSync('ed25519');
const lab=createV42OfflineSessionLab({privateKey:pair.privateKey,publicKey:pair.publicKey,kid:'qa-key',issuer:'qa-issuer',audience:'qa-audience',nowSeconds:()=>now});
const intentDigest=createHash('sha256').update('synthetic-intent').digest('hex');
function scenario(overrides={}){
  const row={shop_code:'SHOP_A',user_sub:SUB,staff_role:'staff',active:true,auth_version:7};
  const tx={id:'tx-local-01',state:'open'};
  const cfg={environment:'isolated_qa',allowIsolatedQa:true,lab,token:lab.issue({sub:SUB,shopCode:'SHOP_A',role:'staff',authVersion:7}),tx,
    shopCode:'SHOP_A',operation:'report',idempotencyKey:'key-000000000001',intentDigest,
    lockMembership:async ({txId})=>({txId,lockKind:'FOR_UPDATE',row:{...row}}),
    readReplay:async()=>null,
    mutate:async()=>({ok:true}),...overrides};
  return {cfg,row,tx};
}
const denied=e=>e?.code==='CAR02_V43_QA_DENIED';
const reject=async f=>assert.rejects(f,denied);
test('isolated mode remains NO_GO',()=>{assert.equal(V43_MODE.deployable,false);assert.equal(V43_MODE.realDatabase,false);assert.equal(V43_MODE.realRowLockProven,false);assert.equal(V43_MODE.release,'NO_GO');});
test('V4.2 issuer is also QA only',()=>assert.equal(V42_MODE.deployable,false));
for(const role of ['staff','owner'])for(const op of ['create','report','present','complete']){
 test(`fresh authorized ${role}/${op}`,async()=>{
  const {cfg,row}=scenario();cfg.operation=op;row.staff_role=role;
  cfg.token=lab.issue({sub:SUB,shopCode:'SHOP_A',role,authVersion:7});
  cfg.lockMembership=async ({txId})=>({txId,lockKind:'FOR_UPDATE',row:{...row}});
  const r=await v43QaSignedTxReplay(cfg);
  assert.equal(r.mode,'new');assert.deepEqual(r.result,{ok:true});assert.equal(r.scopeDigest.length,64);
 });
}
for(const [key,value] of [['environment','production'],['allowIsolatedQa',false],['lab',{}],['tx',null],['shopCode','SHOP_B'],['operation','delete'],['idempotencyKey','short'],['idempotencyKey','bad space key xx'],['intentDigest','xyz'],['lockMembership',null],['readReplay',null],['mutate',null]]){
 test(`reject invalid configuration ${key}=${String(value)}`,async()=>{
  const {cfg}=scenario({[key]:value});await reject(()=>v43QaSignedTxReplay(cfg));
 });
}
for(const [label,patch] of [
 ['inactive',{active:false}],['removed role',{staff_role:'customer'}],['other role',{staff_role:'owner'}],
 ['another shop',{shop_code:'SHOP_B'}],['another subject',{user_sub:OTHER}],
 ['higher authVersion',{auth_version:8}],['lower authVersion',{auth_version:6}],
 ['missing authVersion',{auth_version:undefined}],['noninteger authVersion',{auth_version:'7'}],
 ['missing active',{active:undefined}],['null row',null]
]){
 test(`reject invalid locked membership: ${label} without replay or mutation`,async()=>{
  const {cfg,row}=scenario();let reads=0,writes=0;
  cfg.lockMembership=async ({txId})=>({txId,lockKind:'FOR_UPDATE',row:patch===null?null:{...row,...patch}});
  cfg.readReplay=async()=>{reads++;return null};cfg.mutate=async()=>{writes++};
  await reject(()=>v43QaSignedTxReplay(cfg));assert.equal(reads,0);assert.equal(writes,0);
 });
}
for(const [label,change] of [
 ['missing lock',()=>null],['lock kind',({txId,row})=>({txId,lockKind:'NONE',row})],
 ['tx mismatch',({row})=>({txId:'another',lockKind:'FOR_UPDATE',row})],
 ['wrong row',()=>({txId:'tx-local-01',lockKind:'FOR_UPDATE',row:{}})],
 ['array lock',()=>[]]
]){
 test(`reject misleading lock evidence: ${label}`,async()=>{
  const {cfg,row}=scenario();let called=0;cfg.lockMembership=async ({txId})=>change({txId,row});
  cfg.readReplay=async()=>{called++;return null};await reject(()=>v43QaSignedTxReplay(cfg));assert.equal(called,0);
 });
}
for(const [label,setup] of [
 ['revoked transaction',({tx})=>{tx.state='rolledback'}],
 ['changed tx id',({tx})=>{tx.id='stolen'}],
 ['lock throws',()=>{throw Error('pg failed')}]
]){
 test(`reject transaction state during locking: ${label}`,async()=>{
  const {cfg,tx,row}=scenario();let reads=0;
  cfg.lockMembership=async ({txId})=>{setup({tx});return {txId,lockKind:'FOR_UPDATE',row:{...row}}};
  cfg.readReplay=async()=>{reads++;return null};await reject(()=>v43QaSignedTxReplay(cfg));assert.equal(reads,0);
 });
}
for(const label of ['expiry','not-yet-valid','different issuer signature','tamper claims','token absent']){
 test(`reject invalid signed session: ${label}`,async()=>{
  const {cfg}=scenario();let locks=0;cfg.lockMembership=async()=>{locks++;throw Error('must not run')};
  if(label==='expiry')now+=500;
  if(label==='not-yet-valid')now-=1000;
  if(label==='different issuer signature'){
    const keys=generateKeyPairSync('ed25519');const otherLab=createV42OfflineSessionLab({privateKey:keys.privateKey,publicKey:keys.publicKey,kid:'qa-key',issuer:'qa-issuer',audience:'qa-audience',nowSeconds:()=>now});
    cfg.token=otherLab.issue({sub:SUB,shopCode:'SHOP_A',role:'staff',authVersion:7});
  }
  if(label==='tamper claims'){
    const t=cfg.token.split('.');t[1]=t[1].slice(0,-1)+(t[1].at(-1)==='A'?'B':'A');cfg.token=t.join('.');
  }
  if(label==='token absent')cfg.token='';
  await reject(()=>v43QaSignedTxReplay(cfg));assert.equal(locks,0);
  now=1750000000;
 });
}
test('completed replay only after authorization',async()=>{
 const {cfg}=scenario();let writes=0;
 cfg.readReplay=async ({scopeDigest,shopCode})=>({completed:true,scopeDigest,shopCode,subject:SUB,role:'staff',authVersion:7,intentDigest,snapshot:{cached:true}});
 cfg.mutate=async()=>{writes++;return 1};const out=await v43QaSignedTxReplay(cfg);
 assert.equal(out.mode,'replay');assert.deepEqual(out.result,{cached:true});assert.equal(writes,0);
});
for(const [label,patch] of [
 ['incomplete',{completed:false}],['shop',{shopCode:'SHOP_B'}],['subject',{subject:OTHER}],
 ['role',{role:'owner'}],['version',{authVersion:8}],['intent',{intentDigest:'0'.repeat(64)}],
 ['scope',{scopeDigest:'b'.repeat(64)}],['no snapshot',{snapshot:undefined}],['array record',[]]
]){
 test(`reject unauthorized cached result: ${label}`,async()=>{
  const {cfg}=scenario();let mutated=0;
  cfg.readReplay=async ({scopeDigest,shopCode})=>{let v={completed:true,scopeDigest,shopCode,subject:SUB,role:'staff',authVersion:7,intentDigest,snapshot:'good'};
    if(label==='no snapshot')delete v.snapshot;else if(Array.isArray(patch))v=patch;else Object.assign(v,patch);
    return v;
  };cfg.mutate=async()=>{mutated++;return 'bad'};
  await reject(()=>v43QaSignedTxReplay(cfg));assert.equal(mutated,0);
 });
}
for(const phase of ['read replay failure','read changes state','mutation failure','mutation closes transaction']){
 test(`fail closed ${phase}`,async()=>{
 const {cfg,tx}=scenario();let writes=0;
 if(phase==='read replay failure')cfg.readReplay=async()=>{throw Error('database failed')};
 if(phase==='read changes state')cfg.readReplay=async()=>{tx.state='committed';return null};
 if(phase==='mutation failure')cfg.mutate=async()=>{throw Error('write failed')};
 if(phase==='mutation closes transaction')cfg.mutate=async()=>{writes++;tx.state='committed';return 'untrusted'};
 await reject(()=>v43QaSignedTxReplay(cfg));
 if(phase==='read changes state'||phase==='read replay failure')assert.equal(writes,0);
 });
}
test('snapshot return is a clone not shared object',async()=>{
 const {cfg}=scenario();const snapshot={nested:{n:1}};
 cfg.readReplay=async ({scopeDigest,shopCode})=>({completed:true,scopeDigest,shopCode,subject:SUB,role:'staff',authVersion:7,intentDigest,snapshot});
 const out=await v43QaSignedTxReplay(cfg);out.result.nested.n=9;assert.equal(snapshot.nested.n,1);
});
test('single token is rejected after subsequent membership version bump',async()=>{
 const {cfg,row}=scenario();await v43QaSignedTxReplay(cfg);
 cfg.lockMembership=async ({txId})=>({txId,lockKind:'FOR_UPDATE',row:{...row,auth_version:8}});
 await reject(()=>v43QaSignedTxReplay(cfg));
});
test('replay cannot bypass locked row active flag',async()=>{
 const {cfg,row}=scenario();const valid=await v43QaSignedTxReplay(cfg);
 cfg.readReplay=async ({shopCode})=>({completed:true,shopCode,subject:SUB,role:'staff',authVersion:7,scopeDigest:valid.scopeDigest,intentDigest,snapshot:'previous success'});
 cfg.lockMembership=async ({txId})=>({txId,lockKind:'FOR_UPDATE',row:{...row,active:false}});
 await reject(()=>v43QaSignedTxReplay(cfg));
});

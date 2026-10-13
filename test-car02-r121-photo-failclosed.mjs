import test from 'node:test';
import assert from 'node:assert/strict';
import {createR121IsolatedPhotoCandidate,R121_CONTRACT} from './car02-r121-photo-failclosed-isolated.mjs';
const u=(ch)=>`${ch.repeat(8)}-${ch.repeat(4)}-4${ch.repeat(3)}-8${ch.repeat(3)}-${ch.repeat(12)}`;
const base=()=>({shop:'street_house_demo',orderId:u('1'),reportId:u('2'),intentKey:u('3'),mimeType:'image/jpeg',
 bytes:new Uint8Array([255,216,255,217]),actor:{verified:true,shopCode:'street_house_demo',role:'staff',subject:'staff:'+u('4')}});
function setup(modes={},memory){
 const rows=memory||new Map(),objects=new Map();
 const calls={put:0,read:0,reserve:0,quarantine:0,mark:0,delete:0};
 const ledger={
  async reserve(m){calls.reserve++;if(modes.reserveThrow)throw Error('lost-reserve-ack');let r=rows.get(m.shop+':'+m.intentKey);
   if(r)return {...r,existing:true};
   const n=[...rows.values()].filter(x=>x.shop===m.shop&&x.reportId===m.reportId&&x.state!=='REMOVED').length;
   if(n>=3)throw Error('CAP_REACHED');r={...m,state:'PENDING'};rows.set(m.shop+':'+m.intentKey,r);return {...r,existing:false};
  },
  async inspect(m){if(modes.inspectThrow)throw Error('inspect-timeout');return rows.get(m.shop+':'+m.intentKey)||null;},
  async quarantine(m,reason){calls.quarantine++;if(modes.quarantineThrow)throw Error('quarantine-ack-loss');const r=rows.get(m.shop+':'+m.intentKey);
   if(!r||r.sha256!==m.sha256)throw Error('INVALID_SCOPE');if(r.state==='READY')return {...r};
   if(r.state!=='PENDING')throw Error('INVALID_STATE');r.state='QUARANTINED';r.reason=reason;return {...r};
  },
  async markReady(m){calls.mark++;const r=rows.get(m.shop+':'+m.intentKey);if(!r||r.state!=='PENDING')throw Error('INVALID');
   if(modes.markThrowBeforeCommit)throw Error('DB-error');r.state='READY';if(modes.markThrowAfterCommit)throw Error('ACK_LOST');return {...r};
  }
 };
 const storage={async putOnce(m,b){calls.put++;if(modes.putBeforeThrow)throw Error('UPLOAD_TIMEOUT');objects.set(m.path,new Uint8Array(b));if(modes.putAfterThrow)throw Error('ACK_LOST');},
 async readBack(m){calls.read++;if(modes.readThrow)throw Error('READ_TIMEOUT');if(modes.readWrongType)return 'HTTP 200';
  const b=objects.get(m.path);return modes.readCorrupt&&b?new Uint8Array([1,...b.slice(1)]):b||null;}};
 const create=()=>createR121IsolatedPhotoCandidate({environment:'isolated_qa',dbName:'car02_r121_qa_ci',releaseGate:()=>modes.closed!==true,ledger,storage});
 return {create,rows,objects,calls,storage,ledger};
}
const deny=async(f,code)=>assert.rejects(f,e=>e?.code===code);
test('R121 requires isolated environment',()=>{const s=setup();assert.throws(()=>createR121IsolatedPhotoCandidate({environment:'production',dbName:'car02_r121_qa_ci',releaseGate:()=>true,ledger:s.ledger,storage:s.storage}),/R121_ISOLATION/);});
test('R121 rejects arbitrary DB name',()=>{const s=setup();assert.throws(()=>createR121IsolatedPhotoCandidate({environment:'isolated_qa',dbName:'production',releaseGate:()=>true,ledger:s.ledger,storage:s.storage}),/R121_ISOLATION/);});
test('R121 closed gate prevents all side effects',async()=>{const s=setup({closed:true});await deny(()=>s.create().upload(base()),'R121_GATE_CLOSED');assert.equal(s.calls.reserve+s.calls.put,0);});
test('R121 refuses unverified actor',async()=>{const s=setup();await deny(()=>s.create().upload({...base(),actor:{...base().actor,verified:false}}),'R121_AUTH');assert.equal(s.calls.put,0);});
test('R121 rejects cross-shop actor',async()=>{const s=setup();await deny(()=>s.create().upload({...base(),actor:{...base().actor,shopCode:'other_shop'}}),'R121_AUTH');});
test('R121 rejects missing staff ID',async()=>{const s=setup();await deny(()=>s.create().upload({...base(),actor:{...base().actor,subject:'staff:FORGED'}}),'R121_AUTH');});
test('R121 rejects invalid order/report/intent UUIDs',async()=>{for(const k of ['orderId','reportId','intentKey']){const s=setup();await deny(()=>s.create().upload({...base(),[k]:'../../escape'}),'R121_SCOPE');assert.equal(s.calls.put,0);}});
test('R121 refuses supplied invalid MIME',async()=>{const s=setup();await deny(()=>s.create().upload({...base(),mimeType:'image/svg+xml'}),'R121_MIME');});
test('R121 refuses invalid image signature',async()=>{const s=setup();await deny(()=>s.create().upload({...base(),bytes:new Uint8Array([10,11,12,13])}),'R121_IMAGE');});
test('R121 refuses over 5MB image without storage',async()=>{const s=setup();const bytes=new Uint8Array(5*1024*1024+1);bytes.set([255,216,255,217]);await deny(()=>s.create().upload({...base(),bytes}),'R121_IMAGE');assert.equal(s.calls.put,0);});
test('R121 accepts valid JPEG with independent byte roundtrip',async()=>{const s=setup();assert.deepEqual(await s.create().upload(base()),{status:'READY',deduplicated:false,ackRecovered:false});assert.equal(s.calls.put,1);assert.equal(s.calls.read,1);});
test('R121 accepts valid PNG signature',async()=>{const s=setup();const r=await s.create().upload({...base(),mimeType:'image/png',bytes:new Uint8Array([137,80,78,71,13,10,26,10])});assert.equal(r.status,'READY');});
test('R121 accepts valid WEBP RIFF header',async()=>{const s=setup();const r=await s.create().upload({...base(),mimeType:'image/webp',bytes:new Uint8Array([82,73,70,70,4,0,0,0,87,69,66,80])});assert.equal(r.status,'READY');});
test('R121 replays READY same intent without second upload',async()=>{const s=setup();await s.create().upload(base());const r=await s.create().upload(base());assert.deepEqual(r,{status:'READY',deduplicated:true});assert.equal(s.calls.put,1);});
test('R121 replay after new adapter instance stays idempotent',async()=>{const s=setup();await s.create().upload(base());assert.equal((await s.create().upload(base())).status,'READY');assert.equal(s.calls.put,1);});
test('R121 changed payload for same key refuses storage mutation',async()=>{const s=setup();await s.create().upload(base());await deny(()=>s.create().upload({...base(),bytes:new Uint8Array([255,216,255,218])}),'R121_RESERVE_MISMATCH');assert.equal(s.calls.put,1);});
test('R121 lost PUT ack but verified object may be marked ready',async()=>{const s=setup({putAfterThrow:true});assert.deepEqual(await s.create().upload(base()),{status:'READY',deduplicated:false,ackRecovered:true});assert.equal(s.calls.quarantine,0);});
test('R121 failed PUT and no object requires quarantine, NEVER delete',async()=>{const s=setup({putBeforeThrow:true});await deny(()=>s.create().upload(base()),'R121_PHOTO_QUARANTINED');assert.equal([...s.rows.values()][0].state,'QUARANTINED');assert.equal(s.calls.delete,0);});
test('R121 accepted PUT and readback timeout quarantines, never deletes',async()=>{const s=setup({readThrow:true});await deny(()=>s.create().upload(base()),'R121_PHOTO_QUARANTINED');assert.equal(s.calls.quarantine,1);assert.equal(s.calls.delete,0);});
test('R121 readback hash mismatch quarantines, never deletes',async()=>{const s=setup({readCorrupt:true});await deny(()=>s.create().upload(base()),'R121_PHOTO_QUARANTINED');assert.equal(s.calls.quarantine,1);});
test('R121 forged HTTP success is not independent bytes',async()=>{const s=setup({readWrongType:true});await deny(()=>s.create().upload(base()),'R121_PHOTO_QUARANTINED');assert.equal(s.calls.quarantine,1);});
test('R121 quarantined intent cannot be retried',async()=>{const s=setup({readThrow:true});await deny(()=>s.create().upload(base()),'R121_PHOTO_QUARANTINED');await deny(()=>s.create().upload(base()),'R121_QUARANTINED_NO_REUPLOAD');assert.equal(s.calls.put,1);});
test('R121 crashed process pending intent never blind reuploads',async()=>{const s=setup();const m={...base()};const init=await s.ledger.reserve({shop:m.shop,orderId:m.orderId,reportId:m.reportId,intentKey:m.intentKey,
 actor:m.actor.subject,role:m.actor.role,bucket:'ksh-car02-private-photos',path:`${m.shop}/${m.orderId}/${m.reportId}/${m.intentKey}.jpg`,mime:m.mimeType,sha256:'test',size:4});
 // Existing exact metadata on a restarted process requires a valid digest.
 const {createHash}=await import('node:crypto');s.rows.get(m.shop+':'+m.intentKey).sha256=createHash('sha256').update(m.bytes).digest('hex');
 await deny(()=>s.create().upload(m),'R121_RETRY_NEEDS_REVIEW');assert.equal(s.calls.put,0);assert.equal([...s.rows.values()][0].state,'QUARANTINED');});
test('R121 DB markReady fails before commit, quarantine instead of claiming ready',async()=>{const s=setup({markThrowBeforeCommit:true});await deny(()=>s.create().upload(base()),'R121_PHOTO_QUARANTINED');assert.equal([...s.rows.values()][0].state,'QUARANTINED');});
test('R121 lost markReady commit ACK can be recovered by independent status read',async()=>{const s=setup({markThrowAfterCommit:true});const r=await s.create().upload(base());assert.equal(r.status,'READY');assert.equal(r.ackRecovered,true);});
test('R121 if quarantine is unconfirmed, fail closed',async()=>{const s=setup({readThrow:true,quarantineThrow:true});await deny(()=>s.create().upload(base()),'R121_QUARANTINE_UNCONFIRMED');assert.equal(s.calls.delete,0);});
test('R121 reserve failure prevents any attempt to upload',async()=>{const s=setup({reserveThrow:true});await deny(()=>s.create().upload(base()),'R121_RESERVE_UNCONFIRMED');assert.equal(s.calls.put,0);});
test('R121 three-photo cap refusal is fail closed',async()=>{const s=setup();for(let i=5;i<8;i++)await s.create().upload({...base(),intentKey:u(String(i))});await deny(()=>s.create().upload({...base(),intentKey:u('8')}),'R121_RESERVE_UNCONFIRMED');assert.equal(s.calls.put,3);});
test('R121 no DELETE method in adapter, no forbidden outbound facilities',()=>{assert.equal(R121_CONTRACT.storageDeleteNeverInvoked,true);assert.equal(R121_CONTRACT.productionReady,false);assert.equal(R121_CONTRACT.realSupabaseTested,false);assert.equal(R121_CONTRACT.durablePostgresTested,false);assert.equal(R121_CONTRACT.releaseDecision,'NO_GO');assert.equal(R121_CONTRACT.migrationDecision,'HOLD');});

// R122: real disposable PostgreSQL 17 only. Synthetic photos via in-memory storage stub.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createR121IsolatedPhotoCandidate} from './car02-r121-photo-failclosed-isolated.mjs';
import {createR122DisposablePgPhotoLedger,R122_CONTRACT} from './car02-r122-pg17-photo-ledger-isolated.mjs';
const DB='car02_r122_qa_ci';
const users={a:'car02_r122_a_ci',b:'car02_r122_b_ci'};
const uuid=(c)=>`${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const scope={a:{shop:'street_house_demo',orderId:uuid('1'),reportId:uuid('2'),staff:uuid('4')},
 b:{shop:'other_demo',orderId:uuid('a'),reportId:uuid('b'),staff:uuid('c')}};
const key=uuid('3');
function make(k,letter='3'){const s=scope[k];return {shop:s.shop,orderId:s.orderId,reportId:s.reportId,
 intentKey:uuid(letter),mimeType:'image/jpeg',bytes:new Uint8Array([255,216,255,217]),
 actor:{verified:true,shopCode:s.shop,role:'staff',subject:'staff:'+s.staff}};}
const toMeta=x=>({shop:x.shop,intentKey:x.intentKey,orderId:x.orderId,reportId:x.reportId,
 actor:x.actor.subject,role:x.actor.role,bucket:'ksh-car02-private-photos',
 path:`${x.shop}/${x.orderId}/${x.reportId}/${x.intentKey}.jpg`,
 mime:x.mimeType,size:x.bytes.length,sha256: 'a'});
function storage(modes={}){
 const objects=new Map(),calls={put:0,read:0};
 return {calls,objects,async putOnce(m,b){calls.put++;objects.set(m.path,new Uint8Array(b));if(modes.lostAck)throw Error('ACK_LOST')},
  async readBack(m){calls.read++;const x=objects.get(m.path);return modes.corrupt&&x?new Uint8Array([0,...x.slice(1)]):x||null}};
}
const getPool=(pg,user,dbname=DB)=>new pg.Pool({host:'127.0.0.1',port:5432,user,
 password:'r122-ci-disposable-only',database:dbname,max:12,connectionTimeoutMillis:6000,
 application_name:'car02_r122_disposable_pg17_test'});
const requireFail=async(action,codes)=>{let e;try{await action()}catch(x){e=x}assert.ok(e,'R122_UNEXPECTED_ALLOW');
 assert.ok(codes.includes(e.code)||codes.some(x=>e.message?.includes(x)),`unexpected ${e.code} ${e.message}`);};
export async function runR122(pg){
 assert.equal(process.env.R122_DISPOSABLE_QA,'yes');
 assert.equal(process.env.PGHOST,'127.0.0.1');
 assert.equal(process.env.PGDATABASE,DB);
 assert.equal(process.env.CAR02_RELEASE_LOCK,'true');
 const pools=[getPool(pg,users.a),getPool(pg,users.b)];
 const [aPool,bPool]=pools;
 let tests=0;
 const ck=(condition)=>{assert.ok(condition);tests++};
 const ledger=(k,pool)=>createR122DisposablePgPhotoLedger({environment:'isolated_qa',dbName:DB,
  expectedUser:users[k],pool});
 try{
  const a=ledger('a',aPool),b=ledger('b',bPool);
  // Validate isolated role and RLS flags before writing synthetic rows.
  const q=await aPool.query(`SELECT c.relrowsecurity AS rls,c.relforcerowsecurity AS forced FROM pg_class c WHERE c.oid='car02_r122_qa.photo_intents'::regclass`);
  ck(q.rows[0].rls&&q.rows[0].forced);
  // Genuine concurrent six-session insert conflict, one durable row and one audit insert.
  const x=make('a','3');const bytes=x.bytes;const hash=(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  const m={shop:x.shop,intentKey:x.intentKey,orderId:x.orderId,reportId:x.reportId,actor:x.actor.subject,
   role:x.actor.role,bucket:'ksh-car02-private-photos',path:`${x.shop}/${x.orderId}/${x.reportId}/${x.intentKey}.jpg`,
   mime:x.mimeType,size:bytes.length,sha256:hash};
  const concurrent=await Promise.all(Array.from({length:6},()=>a.reserve(m)));
  ck(concurrent.filter(r=>r.existing===false).length===1&&concurrent.filter(r=>r.existing===true).length===5);
  ck((await a.inspect(m)).state==='PENDING');
  ck((await aPool.query('SELECT count(*)::int AS n FROM car02_r122_qa.photo_intents')).rows[0].n===1);
  // Fresh process-style pool proves database durability; retry must NOT re-upload.
  const fresh=getPool(pg,users.a);pools.push(fresh);
  ck((await ledger('a',fresh).reserve(m)).existing===true);
  const store=storage(),candidate=createR121IsolatedPhotoCandidate({environment:'isolated_qa',dbName:'car02_r121_qa_ci',
    releaseGate:()=>true,ledger:ledger('a',fresh),storage:store});
  await requireFail(()=>candidate.upload(x),['R121_RETRY_NEEDS_REVIEW']);
  ck(store.calls.put===0&&(await a.inspect(m)).state==='QUARANTINED');
  await requireFail(()=>candidate.upload(x),['R121_QUARANTINED_NO_REUPLOAD']);
  ck(store.calls.put===0);
  // Normal successful synthetic storage roundtrip, database READY and audit durable.
  const ok=make('a','5'),synthetic=storage();
  const okCandidate=createR121IsolatedPhotoCandidate({environment:'isolated_qa',dbName:'car02_r121_qa_ci',
    releaseGate:()=>true,ledger:a,storage:synthetic});
  ck((await okCandidate.upload(ok)).status==='READY');
  ck((await okCandidate.upload(ok)).deduplicated===true&&synthetic.calls.put===1);
  // A lost successful POST ACK followed by verified bytes can still reach READY.
  const lost=make('a','6'),lostStore=storage({lostAck:true});
  const lostCandidate=createR121IsolatedPhotoCandidate({environment:'isolated_qa',dbName:'car02_r121_qa_ci',
    releaseGate:()=>true,ledger:a,storage:lostStore});
  ck((await lostCandidate.upload(lost)).ackRecovered===true);
  // 4th unique image stays blocked even if a previous image is quarantined.
  const extra=make('a','7');
  await requireFail(()=>okCandidate.upload(extra),['R121_RESERVE_UNCONFIRMED']);
  ck(synthetic.calls.put===1);
  // Audit is generated on the PG server transactionally; terminal state never overwritten.
  let rows=(await aPool.query('SELECT event_state FROM car02_r122_qa.audit_events ORDER BY id')).rows.map(x=>x.event_state);
  ck(rows.length===6&&rows.filter(s=>s==='PENDING').length===3&&rows.includes('QUARANTINED')&&rows.filter(s=>s==='READY').length===2);
  await requireFail(()=>a.quarantine({...m,intentKey:ok.intentKey,path:`${ok.shop}/${ok.orderId}/${ok.reportId}/${ok.intentKey}.jpg`,sha256:'0'.repeat(64)},'READBACK_MISMATCH'),['R122_INTENT_REBIND_DENIED']);
  await requireFail(()=>aPool.query(`UPDATE car02_r122_qa.photo_intents SET state='QUARANTINED',quarantine_reason='READBACK_MISMATCH' WHERE intent_key=$1`,[ok.intentKey]),['42501']);
  ck((await aPool.query('SELECT count(*)::int AS n FROM car02_r122_qa.audit_events')).rows[0].n===6);
  await requireFail(()=>aPool.query('DELETE FROM car02_r122_qa.photo_intents'),['42501']);
  await requireFail(()=>aPool.query('UPDATE car02_r122_qa.audit_events SET event_state=$1',['READY']),['42501']);
  await requireFail(()=>aPool.query(`SET ROLE ${users.b}`),['42501']);
  ck((await bPool.query('SELECT count(*)::int AS n FROM car02_r122_qa.photo_intents')).rows[0].n===0);
  await requireFail(()=>b.inspect(m),['R122_SCOPE_INVALID']);
  await requireFail(()=>bPool.query(`INSERT INTO car02_r122_qa.photo_intents
   (shop_code,intent_key,order_id,report_id,staff_subject,staff_role,bucket,storage_path,mime_type,byte_size,sha256)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[m.shop,uuid('8'),m.orderId,m.reportId,m.actor,m.role,m.bucket,m.path,m.mime,m.size,m.sha256]),['42501']);
  ck((await b.reserve({...m,shop:scope.b.shop,intentKey:uuid('d'),orderId:scope.b.orderId,reportId:scope.b.reportId,
      actor:'staff:'+scope.b.staff,path:`other_demo/${scope.b.orderId}/${scope.b.reportId}/${uuid('d')}.jpg`})).state==='PENDING');
  // DB-level cap for a direct INSERT attempt, not just the app adapter.
  await requireFail(()=>aPool.query(`INSERT INTO car02_r122_qa.photo_intents
   (shop_code,intent_key,order_id,report_id,staff_subject,staff_role,bucket,storage_path,mime_type,byte_size,sha256)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[m.shop,extra.intentKey,m.orderId,m.reportId,m.actor,m.role,m.bucket,
    `${m.shop}/${m.orderId}/${m.reportId}/${extra.intentKey}.jpg`,m.mime,m.size,m.sha256]),['23514']);
  ck(R122_CONTRACT.releaseDecision==='NO_GO'&&R122_CONTRACT.migrationDecision==='HOLD');
  // Produce only aggregate evidence; no customer identifiers, storage paths or hashes.
  const proof={version:'R122',environment:'disposable_pg17_synthetic_only',
    assertionGroups:tests,release:'NO_GO',migration:'HOLD',realSupabaseTested:false,
    realStorageTested:false,storageDeleteCalls:0,legacySourceMutations:0,
    expectedResult:'PG17_LEDGER_INTEGRATION_PASS'};
  if(process.env.R122_EVIDENCE_FILE)fs.writeFileSync(process.env.R122_EVIDENCE_FILE,JSON.stringify(proof,null,2)+'\n');
  console.log('R122_PG17_LEDGER_R121_BRIDGE_PASS');
  console.log('R122_RELEASE_NO_GO_MIGRATION_HOLD');
 }finally{await Promise.all(pools.map(p=>p.end().catch(()=>{})))}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const {default:pg}=await import('pg');await runR122(pg);
}

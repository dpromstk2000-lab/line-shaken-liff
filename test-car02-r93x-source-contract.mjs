import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R93X_CONTRACT} from './car02-r93x-verified-storage-lifecycle-isolated.mjs';
import {R93X_PG_CONTRACT} from './car02-r93x-pg-ready-port-isolated.mjs';
const source=f=>readFileSync(new URL(`./${f}`,import.meta.url),'utf8');
const orchestrator=source('car02-r93x-verified-storage-lifecycle-isolated.mjs');
const db=source('car02-r93x-pg-ready-port-isolated.mjs');
for(const [name,yes] of Object.entries({
 'never enable release':R93X_CONTRACT.releaseDecision==='NO_GO',
 'never migrate':R93X_CONTRACT.migrationDecision==='HOLD',
 'memory storage only':R93X_CONTRACT.storageMode==='isolated_memory_only',
 'no production entry wiring':R93X_CONTRACT.r47R50R51R52Unchanged,
 'DB no live schema':R93X_PG_CONTRACT.database==='car02_r93q_qa_ci',
 'no direct storage delete':R93X_PG_CONTRACT.neverDeletesStorageObject
}))test(`R93X contract ${name}`,()=>assert.equal(yes,true));
test('R93X ready proof requires independent read after completion',()=>{
 assert.ok(orchestrator.includes('intents.resume(env)'));
 assert.ok(orchestrator.includes('readyPort.proveReady(env,photoId)'));
 assert.ok(orchestrator.includes('storage.inspectObject'));
 assert.ok(orchestrator.includes('SHA(meta.bytes)===env.sha256'));
});
test('R93X NEVER calls DELETE or live Storage network',()=>{
 assert.doesNotMatch(orchestrator,/\b(?:fetch|XMLHttpRequest|WebSocket|serviceRoleKey)\b/);
 assert.doesNotMatch(orchestrator,/\.deleteObject\(|\.remove\(|method\s*:\s*['"]DELETE['"]/);
 assert.doesNotMatch(db,/\b(?:fetch|serviceRoleKey|wrangler|supabase\.co|DELETE FROM)\b/);
});
test('DB writes are scoped, parameterized and transactional',()=>{
 for(const pattern of ["await c.query('BEGIN')","await c.query('COMMIT')","await c.query('ROLLBACK')",
  'FOR UPDATE OF p,i','WHERE photo_id=$1','AND i.intent_key=$3',"upload_state='pending'",
  'RETURNING job_id,state'])assert.ok(db.includes(pattern),pattern);
 assert.doesNotMatch(db,/c\.query\(`[^`]*\$\{env\./);
});
test('DB requires exact matching uploaded identity and intent record',()=>{
 for(const field of ['row.storage_bucket!==BUCKET','row.storage_path!==envelope.path',
 'Number(row.byte_size)!==envelope.byteSize','row.sha256!==envelope.sha256',
 'row.staff_id!==staffId','row.intent_role!==envelope.actor.role'])assert.ok(db.includes(field),field);
});
test('R93W and R93S remain staged only, not promoted to production',()=>{
 const r93w=source('car02-r93w-durable-http-reservation-isolated.mjs');
 const r93s=source('car02-r93s-durable-upload-intent-isolated.mjs');
 assert.ok(r93w.includes('R93W_STORAGE_AND_READY_PROOF_NOT_CONNECTED'));
 assert.ok(r93s.includes('productionReady:false'));
 assert.ok(orchestrator.includes("storage?.kind!=='isolated_memory'"));
 console.log('R93X_SOURCE_LOCK_AND_NO_LIVE_STORAGE_PASS');
});

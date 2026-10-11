import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('./R93S_PG17_DURABLE_INTENT_FIXTURE_QA_ONLY.sql',import.meta.url),'utf8');
const js=readFileSync(new URL('./car02-r93s-durable-upload-intent-isolated.mjs',import.meta.url),'utf8');
for(const [name,condition] of [
 ['disposable db identity',sql.includes("current_database()<>'car02_r93q_qa_ci'")],
 ['postgres17 only',sql.includes("server_version_num')::int<170000")],
 ['reject live tables',sql.includes("to_regclass('public.ksh_car02_photos') IS NOT NULL")],
 ['refuse existing intent table',sql.includes("to_regclass('car02_r93q_qa.upload_intents') IS NOT NULL")],
 ['strong shop/idempotency composite key',sql.includes('PRIMARY KEY(shop_code,intent_key)')],
 ['unique photo binding',sql.includes('UNIQUE(photo_id)')],
 ['photo FK',sql.includes('REFERENCES car02_r93q_qa.photos(id)')],
 ['SQL table created only on QA schema',sql.includes('CREATE TABLE car02_r93q_qa.upload_intents')],
 ['no public privilege',sql.includes('REVOKE ALL ON car02_r93q_qa.upload_intents FROM PUBLIC')],
 ['immutable intent trigger',sql.includes('r93s_intent_immutable BEFORE UPDATE OR DELETE')],
 ['verify actual photo row too',js.includes('R93S_PHOTO_BINDING_MISMATCH')],
 ['two-stage transaction',js.includes("await client.query('BEGIN')")&&js.includes("await client.query('COMMIT')")],
 ['rollback on failure',js.includes("await client.query('ROLLBACK')")],
 ['staff row lock',js.includes('staff_id=$2 FOR UPDATE')],
 ['order row lock',js.includes('FOR UPDATE OF o,r')],
 ['intent row lock',js.includes('FOR UPDATE OF i,p')],
 ['idempotency key',js.includes('AND i.intent_key=$2')],
 ['outbox photo id check',js.includes('WHERE photo_id=$1')],
 ['do not expose production controls',!js.includes('Deno.env')&& !js.includes('process.env')],
 ['schema creation no DDL in application',!js.includes('CREATE SCHEMA')&&!js.includes('CREATE TABLE')],
 ['limit enforced after duplicate lookup',js.indexOf('const existing=await lookup')<js.indexOf('if(count.n>=3)')],
 ['no unqualified arguments causing shadowing',!sql.includes('storage_path=storage_path')],
 ])test(`R93S contract: ${name}`,()=>assert.equal(condition,true));

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('./R93D_DURABLE_CLEANUP_OUTBOX_QA_ONLY.sql',import.meta.url),'utf8');
const qa=readFileSync(new URL('./R93D_OUTBOX_PG17_ASSERT_QA_ONLY.sql',import.meta.url),'utf8');
for(const [label,re] of [
 ['isolated schema',/CREATE SCHEMA car02_r93d_qa;/],
 ['disposable QA warning',/NEVER run on liff-salon-reserve/],
 ['no create public table',/CREATE TABLE car02_r93d_qa\.cleanup_jobs/],
 ['unique shop/photo',/UNIQUE\(shop_code,photo_id\)/],
 ['hard deleted tombstone',/CHECK \(photo_state='deleted'\)/],
 ['leased state',/state IN \('queued','leased','verified','escalated'\)/],
 ['lease TTL',/interval '30 seconds'/],
 ['FOR UPDATE SKIP LOCKED',/FOR UPDATE SKIP LOCKED/],
 ['lease checked on finish',/WHERE id=p_job AND lease_id=p_lease AND state='leased' AND lease_expires>p_now/],
 ['no PUBLIC privileges',/REVOKE ALL ON SCHEMA car02_r93d_qa FROM PUBLIC/],
 ['RLS enabled',/ENABLE ROW LEVEL SECURITY/],
 ['QA transaction rollback',/ROLLBACK;/],
 ['assert forgery rejection',/FORGED_LEASE_ACCEPTED/],
 ['assert finalized not claimed',/VERIFIED_ROW_RECLAIMED/]
])test(`R93D SQL contract: ${label}`,()=>assert.match(sql+'\n'+qa,re));
for(const prohibited of [/\bCREATE\s+TABLE\s+public\./i,/\bALTER\s+TABLE\s+public\./i,/\bDROP\s+TABLE/i,
 /ksh_demo_customers/i,/SUPABASE_SERVICE_ROLE_KEY/i,/\bGRANT\b/i,/\bTRUNCATE\b/i])
 test(`R93D does not carry production action: ${prohibited}`,()=>assert.doesNotMatch(sql+'\n'+qa,prohibited));
test('QA uses fixed postgres disposable DB',()=>assert.match(qa,/current_database\(\) <> 'postgres'/));
test('QA SQL does not imply actual storage verification',()=>assert.match(sql,/function itself does not prove object absence/));

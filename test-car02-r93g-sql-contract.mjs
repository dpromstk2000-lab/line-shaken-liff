import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('./R93G_PHOTO_TOMBSTONE_ATOMIC_OUTBOX_PG17_QA_ONLY.sql',import.meta.url),'utf8');
const code=readFileSync(new URL('./car02-r93g-photo-tombstone-policy-isolated.mjs',import.meta.url),'utf8');
const positive=[
 ['psql ON_ERROR_STOP',/\\set ON_ERROR_STOP on/],
 ['begin',/^BEGIN;/m],['rollback',/^ROLLBACK;/m],
 ['disposable DB name guard',/current_database\(\)<>'postgres'/],
 ['PostgreSQL 17 guard',/server_version_num/],
 ['baseline photos guard',/to_regclass\('public\.ksh_car02_photos'\) IS NOT NULL/],
 ['baseline customers guard',/to_regclass\('public\.ksh_demo_customers'\) IS NOT NULL/],
 ['scoped QA schema',/CREATE SCHEMA car02_r93g_qa;/],
 ['no PUBLIC schema grants',/REVOKE ALL ON SCHEMA car02_r93g_qa FROM PUBLIC;/],
 ['QA photo table',/CREATE TABLE car02_r93g_qa\.photos/],
 ['QA outbox',/CREATE TABLE car02_r93g_qa\.cleanup_jobs/],
 ['unique photo job',/photo_id uuid NOT NULL UNIQUE/],
 ['photo scope',/storage_path text NOT NULL UNIQUE/],
 ['guard runs BEFORE INSERT UPDATE DELETE',/BEFORE INSERT OR UPDATE OR DELETE ON car02_r93g_qa\.photos/],
 ['pending-only direct insert',/R93G_INSERT_MUST_BEGIN_PENDING/],
 ['state regression SQL test',/R93G_READY_REGRESSION_ACCEPTED/],
 ['tombstone cannot be revived',/OLD\.upload_state='deleted'/],
 ['metadata immutability',/R93G_METADATA_IMMUTABLE/],
 ['state regression barred',/R93G_STATE_REGRESSION/],
 ['hard delete barred',/R93G_HARD_DELETE_PROHIBITED/],
 ['transactional outbox AFTER UPDATE',/AFTER UPDATE OF upload_state ON car02_r93g_qa\.photos/],
 ['outbox only after deletion',/NEW\.upload_state='deleted' AND OLD\.upload_state IS DISTINCT FROM NEW\.upload_state/],
 ['outbox inserted',/INSERT INTO car02_r93g_qa\.cleanup_jobs/],
 ['outbox duplicate failure test',/WHEN unique_violation THEN NULL/],
 ['photo change rollback test',/R93G_PARTIAL_TOMBSTONE/],
 ['no 2nd job on replay',/R93G_TOMBSTONE_REANIMATED/],
 ['explicit QA success marker',/R93G_PG17_ATOMIC_TOMBSTONE_OUTBOX_PASS/],
 ['source intentionally offline',/No HTTP, storage, database, credentials or production wiring/]
];
for(const [title,pattern] of positive)test('R93G SQL contract: '+title,()=>assert.match(title==='source intentionally offline'?code:sql,pattern));
for(const [title,pattern] of [
 ['no data-deleting SQL',/\b(?:DROP|TRUNCATE)\s+(?:TABLE|SCHEMA|DATABASE)\b/i],
 ['no destructive production SQL',/\b(?:ALTER|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.|auth\.|storage\.)/i],
 ['no external access',/\b(?:dblink|http_post|pg_notify|wrangler|supabase db push)\b/i],
 ['no grant to anonymous client',/\bGRANT\b.*\b(?:anon|authenticated)\b/i]
])test('R93G SQL contract: '+title,()=>assert.doesNotMatch(sql,pattern));

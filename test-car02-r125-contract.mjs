// Offline contract tests. They DO NOT execute PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const sql=fs.readFileSync('R125_PG17_REVIEW_JOURNAL_QA_ONLY.sql','utf8');
const runner=fs.readFileSync('car02-r125-pg17-review-journal-qa.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/car02-r125-pg17-review-replay-isolated-qa.yml','utf8');
const checks=[
 ['isolated_db_name',()=>assert.match(sql,/current_database\(\)<>\s*'car02_r125_qa_ci'/)],
 ['pg17_only',()=>assert.match(sql,/server_version_num[\s\S]{0,95}170000[\s\S]{0,145}180000/)],
 ['no_real_photo_table',()=>assert.match(sql,/to_regclass\('public\.ksh_car02_photos'\) IS NOT NULL/)],
 ['tenant_roles',()=>assert.ok(sql.includes('car02_r125_a_ci')&&sql.includes('car02_r125_b_ci'))],
 ['rls_forced_all_tables',()=>assert.equal((sql.match(/FORCE ROW LEVEL SECURITY/g)||[]).length,3)],
 ['no_direct_mutation_rights',()=>assert.doesNotMatch(sql,/GRANT (?:INSERT|UPDATE|DELETE|ALL) ON car02_r125_qa\.review_journal/i)],
 ['append_only_trigger_all_tables',()=>assert.equal((sql.match(/BEFORE UPDATE OR DELETE/g)||[]).length,3)],
 ['sha256_digest_guard',()=>assert.match(sql,/RECORD_HASH_MISMATCH/)],
 ['two_reviewer_enforcement',()=>assert.match(sql,/REVIEW_INDEPENDENCE/)],
 ['6_way_write_race',()=>assert.match(runner,/Array\.from\(\{length:6\}/)],
 ['restore_db_override',()=>assert.match(workflow,/PGDATABASE: car02_r125_restore_ci/)],
 ['backup_corruption_guard',()=>assert.match(workflow,/R125_CORRUPT_BACKUP_REJECTED/)],
 ['cleanup_both_dbs',()=>assert.match(workflow,/DROP DATABASE IF EXISTS car02_r125_restore_ci[\s\S]*DROP DATABASE IF EXISTS car02_r125_qa_ci/)],
 ['no_auto_deployment',()=>assert.doesNotMatch(workflow,/wrangler\s+deploy|supabase\s+db\s+push|git\s+push/i)],
 ['no_release',()=>assert.ok(sql.includes("'NO_GO'")&&sql.includes("'HOLD'"))],
 ['r123_record_bridge',()=>assert.match(runner,/car02-r124-r123-fixtures\.mjs/)],
];
for(const [name,check] of checks)test('R125_'+name,check);

/** DPRO CAR02 R135: Static safety contract only; live PostgreSQL is GitHub CI's responsibility. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('./R135_PG17_BOOKING_ATOMICITY_QA_ONLY.sql',import.meta.url),'utf8');
const py=readFileSync(new URL('./car02_r135_pg17_booking_qa.py',import.meta.url),'utf8');
const yaml=readFileSync(new URL('./.github/workflows/car02-r135-pg17-booking-atomicity-isolated-qa.yml',import.meta.url),'utf8');
const specs=[
 ['exact_disposable_db_guard',()=>assert.match(sql,/current_database\(\)\s*<>\s*'car02_r135_qa_ci'/)],
 ['postgres17_only',()=>{assert.match(sql,/server_version_num.*170000/);assert.match(sql,/server_version_num.*180000/)}],
 ['not_a_production_migration',()=>assert.match(sql,/NEVER execute on Supabase/)],
 ['no_other_app_tables_referenced',()=>assert.doesNotMatch(sql,/(?:ksh_car02_photos|photo_customers|auth\.users|storage\.objects)/i)],
 ['not_granted_superuser',()=>assert.equal((sql.match(/LOGIN NOSUPERUSER/g)||[]).length,2)],
 ['not_granted_bypass_rls',()=>assert.equal((sql.match(/NOBYPASSRLS/g)||[]).length,2)],
 ['no_inherited_privileges',()=>assert.equal((sql.match(/NOINHERIT/g)||[]).length,2)],
 ['tenant_derived_from_session_user',()=>assert.ok((sql.match(/CASE session_user/g)||[]).length>=4)],
 ['deny_public_schema',()=>assert.match(sql,/REVOKE ALL ON SCHEMA car02_r135_qa FROM PUBLIC/)],
 ['deny_direct_mutation',()=>{assert.match(sql,/REVOKE ALL ON car02_r135_qa\.bookings,car02_r135_qa\.audit_events FROM PUBLIC/);assert.doesNotMatch(sql,/GRANT\s+(?:UPDATE|DELETE|INSERT|ALL)\s+ON\s+car02_r135_qa/i)}],
 ['force_booking_rls',()=>assert.match(sql,/ALTER TABLE car02_r135_qa\.bookings FORCE ROW LEVEL SECURITY/)],
 ['force_audit_rls',()=>assert.match(sql,/ALTER TABLE car02_r135_qa\.audit_events FORCE ROW LEVEL SECURITY/)],
 ['unique_request_key_per_shop',()=>assert.match(sql,/UNIQUE \(shop_code,request_key\)/)],
 ['unique_active_slot_partial_index',()=>assert.match(sql,/CREATE UNIQUE INDEX r135_unique_active_slot[\s\S]+WHERE state='ACTIVE'/)],
 ['half_hour_and_business_hours',()=>{assert.match(sql,/extract\(minute from begins_at\) IN \(0,30\)/);assert.match(sql,/17:30/)}],
 ['sunday_and_60_days',()=>{assert.match(sql,/extract\(isodow from p_day\)=7/);assert.match(sql,/v_now::date \+ 60/)}],
 ['function_definer_narrow',()=>assert.equal((sql.match(/SECURITY DEFINER SET search_path=pg_catalog,car02_r135_qa/g)||[]).length,2)],
 ['function_public_execute_revoked',()=>assert.equal((sql.match(/REVOKE ALL ON FUNCTION/g)||[]).length,2)],
 ['function_scope_only_disposable_roles',()=>assert.match(sql,/GRANT EXECUTE ON FUNCTION[\s\S]+ TO car02_r135_a_ci,car02_r135_b_ci/)],
 ['request_replay_checked_for_exact_payload',()=>assert.match(sql,/R135_REQUEST_PAYLOAD_CONFLICT/)],
 ['cancel_idempotent_and_audited',()=>{assert.match(sql,/IDEMPOTENT_CANCEL/);assert.match(sql,/VALUES\(v_shop,v_id,'CANCELLED'\)/)}],
 ['tester_explicit_database_allowlist',()=>assert.match(py,/require\(db in DBS\.values\(\)/)],
 ['tester_six_way_parallel_claim_cancel',()=>{assert.match(py,/ThreadPoolExecutor\(max_workers=n\)/);assert.match(py,/PARALLEL_CANCEL/);assert.match(py,/PARALLEL_UNIQUE_SLOT/)}],
 ['tester_rejects_unapproved_dml',()=>{assert.match(py,/AUDIT_DELETE_ALLOWED/);assert.match(py,/RAW_BOOKING_UPDATE_ALLOWED/);assert.match(py,/RAW_AUDIT_INSERT_ALLOWED/)}],
 ['restore_checks_snapshot_and_rls',()=>{assert.match(py,/RESTORE_SNAPSHOT_MISMATCH/);assert.match(py,/RESTORE_TENANT_GUARD/)}],
 ['workflow_read_only_no_secret_deploy',()=>{assert.match(yaml,/permissions:\s*\n\s+contents: read/);assert.match(yaml,/persist-credentials: false/);assert.doesNotMatch(yaml,/\b(deploy|wrangler|supabase db push|service.role.key|secrets\.)\b/i)}],
 ['workflow_source_protection_and_cleanup',()=>{assert.match(yaml,/car02_r118_readonly_source_gate.py --strict/);assert.match(yaml,/if: always\(\)/);assert.match(yaml,/R135_DISPOSABLE_RESOURCES_DELETED/)}],
 ['workflow_closed_gate_and_sanitized_artifacts',()=>{assert.match(yaml,/R135_ISOLATED_PG17_NO_GO_HOLD_PASS/);assert.match(yaml,/release.*NO_GO/);assert.match(yaml,/migration.*HOLD/);assert.match(yaml,/retention-days: 7/)}],
];
for(const [name,fn] of specs)test('R135_contract_'+name,fn);

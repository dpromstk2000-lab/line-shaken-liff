/** R136 safety contract. Runtime PostgreSQL validation runs only in disposable GitHub CI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('./R136_PG17_CASE_LINK_QA_ONLY.sql',import.meta.url),'utf8');
const py=readFileSync(new URL('./car02_r136_pg17_case_qa.py',import.meta.url),'utf8');
const yml=readFileSync(new URL('./.github/workflows/car02-r136-pg17-booking-case-link-isolated-qa.yml',import.meta.url),'utf8');
const rules=[
 ['exact_temporary_database',()=>assert.match(sql,/current_database\(\)\s*<>\s*'car02_r136_qa_ci'/)],
 ['pg17_only',()=>{assert.match(sql,/server_version_num'\)::int\s*<\s*170000/);assert.match(sql,/server_version_num'\)::int\s*>=\s*180000/)}],
 ['no_prod_migration',()=>assert.match(sql,/NEVER run against Supabase/)],
 ['no_unrelated_tables',()=>assert.doesNotMatch(sql,/(?:ksh_car02_photos|photo_customers|storage\.objects|auth\.users)/i)],
 ['four_non_superuser_logins',()=>assert.equal((sql.match(/LOGIN NOSUPERUSER/g)||[]).length,4)],
 ['deny_bypass_rls',()=>assert.equal((sql.match(/NOBYPASSRLS/g)||[]).length,4)],
 ['deny_role_inheritance',()=>assert.equal((sql.match(/NOINHERIT/g)||[]).length,4)],
 ['staff_customer_per_tenant',()=>assert.ok(['a_staff','a_customer','b_staff','b_customer'].every(x=>sql.includes(`car02_r136_${x}_ci`)))],
 ['schema_not_public',()=>assert.match(sql,/REVOKE ALL ON SCHEMA car02_r136_qa FROM PUBLIC/)],
 ['no_direct_write_grants',()=>{assert.match(sql,/REVOKE ALL ON car02_r136_qa\.bookings/);assert.doesNotMatch(sql,/GRANT\s+(?:INSERT|DELETE|UPDATE|ALL)\s+ON\s+car02_r136_qa\./i)}],
 ['force_rls_four_tables',()=>assert.equal((sql.match(/FORCE ROW LEVEL SECURITY/g)||[]).length,4)],
 ['session_user_controls_tenant',()=>assert.ok((sql.match(/CASE session_user/g)||[]).length>=6)],
 ['unique_booking_key',()=>assert.match(sql,/UNIQUE\(shop_code,request_key\)/)],
 ['unique_active_slot',()=>assert.match(sql,/CREATE UNIQUE INDEX r136_active_slot[\s\S]*WHERE status='ACTIVE'/)],
 ['one_case_per_booking',()=>assert.match(sql,/booking_id bigint NOT NULL UNIQUE/)],
 ['case_references_booking',()=>assert.match(sql,/REFERENCES car02_r136_qa\.bookings\(id\)/)],
 ['case_operation_unique_key',()=>assert.match(sql,/UNIQUE\(shop_code,request_key\)/g)],
 ['case_version_guard',()=>assert.match(sql,/R136_STALE_VERSION/)],
 ['row_lock_case',()=>assert.match(sql,/shop_code=v_shop FOR UPDATE/)],
 ['row_lock_booking',()=>assert.match(sql,/status='ACTIVE' FOR UPDATE/)],
 ['no_staff_approval',()=>assert.match(sql,/p_op='DECIDE' AND v_staff/)],
 ['complete_requires_approval',()=>assert.match(sql,/v_case.state<>'APPROVED'/)],
 ['txn_audit_and_replay',()=>{assert.match(sql,/INSERT INTO car02_r136_qa.case_operations/);assert.match(sql,/INSERT INTO car02_r136_qa.audit_events/)}],
 ['security_definer_scope',()=>assert.equal((sql.match(/SECURITY DEFINER SET search_path=pg_catalog/g)||[]).length,3)],
 ['functions_revoke_public',()=>assert.equal((sql.match(/REVOKE ALL ON FUNCTION/g)||[]).length,3)],
 ['half_hour_sunday_window',()=>{assert.match(sql,/extract\(isodow from p_day\)=7/);assert.match(sql,/p_day>v_now::date\+60/)}],
 ['python_exact_database_allowlist',()=>assert.match(py,/require\(db in DBS.values\(\) and actor in ROLES/)],
 ['python_sixway_tests',()=>{assert.match(py,/ThreadPoolExecutor\(max_workers=n\)/);assert.match(py,/CONCURRENT_BOOKING_REPLAY/);assert.match(py,/CONCURRENT_CASE_CREATION/)}],
 ['python_integration_rejects_bad_roles',()=>{assert.match(py,/STAFF_APPROVAL/);assert.match(py,/CUSTOMER_REPORT_ROLE/);assert.match(py,/CROSS_TENANT_CASE/)}],
 ['python_tests_restoration',()=>{assert.match(py,/RESTORE_SNAPSHOT_MISMATCH/);assert.match(py,/RESTORED_REPLAY/)}],
 ['workflow_only_manual',()=>assert.match(yml,/on:\s*\n\s+workflow_dispatch:/)],
 ['workflow_read_only_checkout',()=>{assert.match(yml,/permissions:\s*\n\s+contents: read/);assert.match(yml,/persist-credentials: false/)}],
 ['workflow_pg17_no_deploy',()=>{assert.match(yml,/image: postgres:17/);assert.doesNotMatch(yml,/\b(wrangler|supabase db push|secrets\.|deploy\b)/i)}],
 ['workflow_immutable_sources_and_cleanup',()=>{assert.match(yml,/car02_r118_readonly_source_gate.py --strict/);assert.match(yml,/if: always\(\)/);assert.match(yml,/R136_DISPOSABLE_RESOURCES_DELETED/)}],
 ['workflow_release_locked',()=>{assert.match(yml,/R136_ISOLATED_PG17_NO_GO_HOLD_PASS/);assert.match(yml,/CAR02_RELEASE_LOCK: 'true'/);assert.match(yml,/retention-days: 7/)}],
];
for(const [name,fn] of rules)test('R136_contract_'+name,fn);

/** R137 is a synthetic PostgreSQL 17 contract; database runtime only in disposable GitHub CI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('./R137_PG17_CUSTOMER_OWNERSHIP_QA_ONLY.sql',import.meta.url),'utf8');
const py=readFileSync(new URL('./car02_r137_pg17_customer_qa.py',import.meta.url),'utf8');
const yaml=readFileSync(new URL('./.github/workflows/car02-r137-pg17-customer-ownership-isolated-qa.yml',import.meta.url),'utf8');
const tests=[
 ['requires_exact_disposable_db',()=>assert.match(sql,/current_database\(\)\s*<>\s*'car02_r137_qa_ci'/)],
 ['requires_postgresql17_only',()=>{assert.match(sql,/server_version_num'\)::integer\s*<\s*170000/);assert.match(sql,/server_version_num'\)::integer\s*>=\s*180000/)}],
 ['explicitly_prohibits_real_database',()=>assert.match(sql,/NEVER execute in Supabase, staging, production/)],
 ['contains_only_isolated_schema',()=>assert.doesNotMatch(sql,/(?:auth\.users|storage\.objects|photo_customers|ksh_car02_photos)/i)],
 ['five_nonsuperuser_logins',()=>assert.equal((sql.match(/LOGIN NOSUPERUSER/g)||[]).length,5)],
 ['five_nonbypass_rls_logins',()=>assert.equal((sql.match(/NOBYPASSRLS/g)||[]).length,5)],
 ['five_noinherit_logins',()=>assert.equal((sql.match(/NOINHERIT/g)||[]).length,5)],
 ['same_shop_two_distinct_customers',()=>{assert.match(sql,/car02_r137_a_one_ci/);assert.match(sql,/car02_r137_a_two_ci/)}],
 ['second_shop_distinct_customer',()=>assert.match(sql,/car02_r137_b_one_ci/)],
 ['schema_denies_public',()=>assert.match(sql,/REVOKE ALL ON SCHEMA car02_r137_qa FROM PUBLIC/)],
 ['tables_deny_public',()=>assert.match(sql,/REVOKE ALL ON car02_r137_qa\.bookings,car02_r137_qa\.service_cases,car02_r137_qa\.case_operations,car02_r137_qa\.audit_events FROM PUBLIC/)],
 ['no_direct_write_grants',()=>assert.doesNotMatch(sql,/GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)\s+ON\s+car02_r137_qa\./i)],
 ['four_force_rls_tables',()=>assert.equal((sql.match(/FORCE ROW LEVEL SECURITY/g)||[]).length,4)],
 ['four_read_policies',()=>assert.equal((sql.match(/CREATE POLICY r137_\w+_read/g)||[]).length,4)],
 ['four_owner_match_checks_for_reading',()=>assert.equal((sql.match(/OR owner_login=session_user/g)||[]).length,4)],
 ['booking_owner_field',()=>assert.match(sql,/owner_login text NOT NULL CHECK\(owner_login IN/)],
 ['case_owner_field',()=>assert.match(sql,/booking_id bigint NOT NULL UNIQUE,\s*shop_code text NOT NULL, owner_login text NOT NULL/)],
 ['composite_owner_booking_fk',()=>assert.match(sql,/FOREIGN KEY\(booking_id,shop_code,owner_login\) REFERENCES car02_r137_qa\.bookings/)],
 ['composite_owner_case_fk',()=>assert.match(sql,/FOREIGN KEY\(case_id,shop_code,owner_login\) REFERENCES car02_r137_qa\.service_cases/)],
 ['customer_cannot_assign_foreign_shop_owner',()=>assert.match(sql,/R137_OWNER_SHOP_MISMATCH/)],
 ['security_definer_enforces_object_ownership',()=>assert.match(sql,/IF NOT v_staff AND v_case.owner_login<>session_user/)],
 ['request_replay_includes_owner',()=>assert.match(sql,/v_old.owner_login<>p_owner/)],
 ['approval_excludes_staff',()=>assert.match(sql,/p_op='DECIDE' AND v_staff/)],
 ['other_operations_exclude_customer',()=>assert.match(sql,/p_op<>'DECIDE' AND NOT v_staff/)],
 ['sixway_retry_fingerprint_binds_actor_and_version',()=>{assert.match(sql,/'version',p_version,'actor',session_user/);assert.match(sql,/v_old.actor_login<>session_user/)}],
 ['audit_events_are_per_owner',()=>assert.match(sql,/INSERT INTO car02_r137_qa.audit_events\(shop_code,owner_login,entity_id,action\)/)],
 ['no_work_without_approval',()=>assert.match(sql,/v_case.state<>'APPROVED'/)],
 ['unique_active_booking_slot',()=>assert.match(sql,/CREATE UNIQUE INDEX r137_active_slot[\s\S]+WHERE state='ACTIVE'/)],
 ['booking_calendar_constraints',()=>{assert.match(sql,/p_day>v_now::date\+60/);assert.match(sql,/extract\(isodow from p_day\)=7/)}],
 ['python_explicit_disposable_db_allowlist',()=>assert.match(py,/db in DBS.values\(\) and actor in ROLES/)],
 ['python_cross_customer_negative_tests',()=>{assert.match(py,/SAME_SHOP_OTHER_CUSTOMER_APPROVES/);assert.match(py,/A1_APPROVES_A2/);assert.match(py,/A2_SEES_A1/)}],
 ['python_backup_restore_and_readonly',()=>{assert.match(py,/RESTORE_SNAPSHOT_MISMATCH/);assert.match(py,/RESTORED_CROSS_CUSTOMER/);assert.match(py,/RESTORE_MUTATED/)}],
 ['workflow_readonly_and_safe_pg17',()=>{assert.match(yaml,/permissions:\s*\n\s+contents: read/);assert.match(yaml,/persist-credentials: false/);assert.match(yaml,/image: postgres:17/);assert.doesNotMatch(yaml,/\b(wrangler|supabase db push|secrets\.|deploy\b)/i)}],
 ['workflow_cleanup_release_lock_and_artifacts',()=>{assert.match(yaml,/car02_r118_readonly_source_gate.py --strict/);assert.match(yaml,/if: always\(\)/);assert.match(yaml,/R137_DISPOSABLE_RESOURCES_DELETED/);assert.match(yaml,/R137_ISOLATED_PG17_NO_GO_HOLD_PASS/);assert.match(yaml,/retention-days: 7/)}],
];
for(const [name,fn] of tests)test('R137_contract_'+name,fn);

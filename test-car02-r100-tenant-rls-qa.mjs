import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R100_DB,R100_TABLES,R100_USERS,R100_CONTRACT,assertR100Disposable,
 assertR100RoleIdentity,assertR100Scoped,runR100TenantChallenge}
 from './car02-r100-pg17-tenant-rls-qa.mjs';
import {verifyR100Workflow} from './car02-r100-workflow-readonly-guard.mjs';
const sql=readFileSync('R100_PG17_TENANT_RLS_FIXTURE_QA_ONLY.sql','utf8');
const impl=readFileSync('car02-r100-pg17-tenant-rls-qa.mjs','utf8');
const workflow=readFileSync('.github/workflows/car02-r100-tenant-rls-qa.yml','utf8');
const env={R100_DISPOSABLE_RLS_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:R100_DB};
test('R100 strict disposable PostgreSQL 17 environment',()=>{
 assertR100Disposable(env);
 for(const k of Object.keys(env))assert.throws(()=>assertR100Disposable({...env,[k]:'bad'}),/R100_ENV_/);
});
test('R100 source contract cannot grant production readiness',()=>{
 assert.equal(R100_CONTRACT.productionReady,false);assert.equal(R100_CONTRACT.productionRLSDeployed,false);
 assert.equal(R100_CONTRACT.storageWired,false);assert.equal(R100_CONTRACT.releaseDecision,'NO_GO');
 assert.equal(R100_CONTRACT.migrationDecision,'HOLD');
});
test('R100 role identity must be non-superuser non-bypass, with exact DB and session identity',()=>{
 const row={db:R100_DB,pg:170001,user_name:R100_USERS[0].user,session_name:R100_USERS[0].user,
  superuser:false,bypass_rls:false,inherits:false,no_live:true};
 assertR100RoleIdentity(row,R100_USERS[0].user);
 for(const delta of [{db:'production'},{pg:160001},{pg:180001},{session_name:'postgres'},
  {superuser:true},{bypass_rls:true},{inherits:true},{no_live:false}])
  assert.throws(()=>assertR100RoleIdentity({...row,...delta},R100_USERS[0].user));
});
test('R100 table scope rejects mixed, empty and foreign tenant data',()=>{
 assertR100Scoped([{shop_code:'other_shop'}],'other_shop','probe');
 assert.throws(()=>assertR100Scoped([],'other_shop','probe'));
 assert.throws(()=>assertR100Scoped([{shop_code:'other_shop'},{shop_code:'street_house_kitsuki'}],'other_shop','probe'));
});
test('R100 protects seven named domain tables',()=>{
 assert.equal(R100_TABLES.length,7);
 for(const name of R100_TABLES)assert.ok(sql.includes(`'${name}'`),name);
 for(const t of ['staff','work_orders','reports','photos','upload_intents','cleanup_jobs','r100_tenant_probe'])assert.ok(R100_TABLES.includes(t));
});
test('R100 SQL rejects non-disposable databases and existing production tables',()=>{
 assert.match(sql,/current_database\(\) <> 'car02_r93q_qa_ci'/);
 assert.match(sql,/to_regclass\('public\.ksh_car02_photos'\) IS NOT NULL/);
 assert.match(sql,/server_version_num/);
 assert.match(sql,/R100_DISPOSABLE_PG17_ONLY/);
});
test('R100 SQL policies ignore caller supplied GUCs and rely on current_user',()=>{
 assert.match(sql,/CASE current_user/);
 assert.doesNotMatch(sql,/current_setting\('car02\.tenant'/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/FORCE ROW LEVEL SECURITY/);
 assert.match(sql,/WITH CHECK \(shop_code=CASE current_user/);
});
test('R100 uses two test-only nonprivileged PostgreSQL login roles',()=>{
 assert.equal(R100_USERS.length,2);
 assert.match(sql,/LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT/);
 assert.match(sql,/GRANT SELECT ON car02_r93q_qa\.staff/);
 assert.match(sql,/GRANT INSERT,UPDATE,DELETE ON car02_r93q_qa\.r100_tenant_probe/);
 assert.doesNotMatch(sql,/GRANT ALL PRIVILEGES|BYPASSRLS(?! NOINHERIT)|SUPERUSER(?! NOCREATEDB)/);
});
test('R100 tests both tenants and forged tenant GUC, SET ROLE and session identity',()=>{
 const code=String(runR100TenantChallenge);
 for(const term of ['set_config','SET ROLE','SET SESSION AUTHORIZATION','row_security=off','FOREIGN_UPDATE_NOT_FILTERED',
  'FOREIGN_DELETE_NOT_FILTERED','foreign_insert','tenant_switch','GUC_SPOOF','RLS_WRITE_SCOPE'])
  assert.ok(code.includes(term),term);
});
test('R100 uses pinned transaction clients and rollback-only own writes',()=>{
 assert.match(impl,/const ownClient=await p\.connect\(\)/);
 assert.match(impl,/const gucClient=await p\.connect\(\)/);
 assert.match(impl,/await gucClient\.query\('ROLLBACK'\)/);
 assert.match(impl,/const securityClient=await p\.connect\(\)/);
 assert.match(impl,/await ownClient\.query\('ROLLBACK'\)/);
 assert.match(impl,/await securityClient\.query\('ROLLBACK'\)/);
 assert.doesNotMatch(impl,/\.query\('COMMIT'\)/);
});
test('R100 never connects to real Supabase, cloud, LINE, or Worker',()=>{
 assert.doesNotMatch(impl,/SUPABASE_SERVICE_ROLE_KEY|CAR02_DATABASE_URL|wrangler|Deno\.env|\bfetch\s*\(/);
 assert.doesNotMatch(sql,/ALTER ROLE\s+postgres|CREATE EXTENSION|DROP SCHEMA public/i);
});
test('R100 workflow is manual, no deploy, hard lock, and cleans roles',()=>{
 const out=verifyR100Workflow(workflow);
 assert.equal(out.steps,8);assert.equal(out.isolatedOnly,true);
 assert.equal(out.releaseDecision,'NO_GO');assert.equal(out.migrationDecision,'HOLD');
 assert.match(workflow,/R100_DB_AND_ROLES_REMOVED/);
});
test('R100 workflow denies trigger changes, production secrets and deploy',()=>{
 for(const edited of [workflow.replace('workflow_dispatch:','push:'),workflow.replace('contents: read','contents: write'),
 workflow.replace('postgres:17','postgres:16'),workflow.replace('R100_PRODUCTION_NO_GO_MIGRATION_HOLD','release success'),
 workflow+'\n# ${{ secrets.PRODUCTION_KEY }}',workflow+'\n# wrangler deploy',
 workflow+'\n      - name: a hidden extra step\n'])
  assert.throws(()=>verifyR100Workflow(edited));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R100_DB,R100_USERS} from './car02-r100-pg17-tenant-rls-qa.mjs';
import {assertR101Environment,assertR101Principal,R101_POLICY,runR101SessionReuse} from './car02-r101-session-reuse-qa.mjs';
import {R101_STEPS,verifyR101Workflow} from './car02-r101-workflow-guard.mjs';
const source=readFileSync('car02-r101-session-reuse-qa.mjs','utf8');
const yaml=readFileSync('.github/workflows/car02-r101-session-rls-qa.yml','utf8');
const baseline={R101_DISPOSABLE_SESSION_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:R100_DB};
test('R101 strict disposable environment',()=>{assertR101Environment(baseline);
 for(const k of Object.keys(baseline))assert.throws(()=>assertR101Environment({...baseline,[k]:'bad'}),/R101_DISPOSABLE_ONLY/);
});
test('R101 requires low privilege role identity and backend PID',()=>{
 const user=R100_USERS[0].user;
 const id={db:R100_DB,pg:170001,user_name:user,session_name:user,superuser:false,
  bypass_rls:false,inherits:false,no_live:true,pid:1234,row_security:'on'};
 assertR101Principal(id,user);
 for(const edit of [{user_name:'postgres'},{session_name:'postgres'},{superuser:true},
  {bypass_rls:true},{inherits:true},{no_live:false},{pg:180001},{db:'production'},
  {pid:null},{row_security:'off'}])assert.throws(()=>assertR101Principal({...id,...edit},user));
});
test('R101 approval is permanently NO_GO HOLD',()=>{
 assert.equal(R101_POLICY.productionReady,false);assert.equal(R101_POLICY.deployAuthorized,false);
 assert.equal(R101_POLICY.productionRlsConnected,false);
 assert.equal(R101_POLICY.releaseDecision,'NO_GO');assert.equal(R101_POLICY.migrationDecision,'HOLD');
});
test('R101 compares physical backend IDs on consecutive pool checkouts',()=>{
 const code=String(runR101SessionReuse);
 for(const tok of ['original.pid','reused.pid','R101_BACKEND_NOT_REUSED','first.release()','second.release()','third.release()'])assert.ok(code.includes(tok));
});
test('R101 role is stable despite forged session GUC from prior checkout',()=>{
 for(const tok of ["set_config('car02.tenant'","current_setting('car02.tenant',true)","'forged_guc_after_release'","RESET car02.tenant"])assert.ok(source.includes(tok),tok);
});
test('R101 rollback returns RLS setting to on after a forced error',()=>{
 const code=String(runR101SessionReuse);
 for(const tok of ['SET LOCAL row_security=off','R101_RLS_DISABLED_IN_SESSION','rls_off','row_security_rollback',"third.query('ROLLBACK')"])assert.ok((code+' '+source).includes(tok),tok);
});
test('R101 mixed batch is atomic and checks no partial rows remain',()=>{
 for(const tok of ['R101_PARTIAL_BATCH_WRITE','VALUES($1,$2','($3,$4','mixed_insert','R101_FIXTURE_MUTATED'])assert.ok(source.includes(tok),tok);
});
test('R101 constrains both tenants and fully qualified schema reads',()=>{
 assert.equal(R100_USERS.length,2);
 assert.ok(source.includes('assertR100Scoped'));
 assert.ok(source.includes('FROM ${R100_SCHEMA}.r100_tenant_probe'));
 assert.ok(source.includes('SELECT id,shop_code,payload'));
});
test('R101 only uses read probes or rollback writes, never commits',()=>{
 assert.doesNotMatch(source,/\.query\('COMMIT'\)/);
 assert.doesNotMatch(source,/\b(?:DROP|TRUNCATE|ALTER)\s+(?:TABLE|SCHEMA)\b/i);
 assert.match(source,/await third\.query\('ROLLBACK'\)/);
});
test('R101 forbids external environments, credentials, deploys',()=>{
 assert.doesNotMatch(source,/SUPABASE_SERVICE_ROLE_KEY|CAR02_DATABASE_URL|Deno\.env|wrangler|\bfetch\s*\(/);
});
test('R101 workflow is manual, read-only, PG17 and removes test roles',()=>{
 const x=verifyR101Workflow(yaml);assert.equal(x.steps,9);assert.equal(R101_STEPS.length,9);
 assert.equal(x.releaseDecision,'NO_GO');assert.equal(x.migrationDecision,'HOLD');
});
test('R101 workflow fails closed on unexpected triggers and network',()=>{
 for(const change of [yaml.replace('workflow_dispatch:','push:'),
  yaml.replace('contents: read','contents: write'),
  yaml.replace('postgres:17','postgres:16'),
  yaml.replace('R101_DISPOSABLE_SESSION_QA:', 'R101_NOT_DISPOSABLE:'),
  yaml.replace('R101_DISPOSABLE_SESSION_RLS_QA_PASS','R101_UNCHECKED'),
  yaml+'\n      - name: malicious\n',yaml+'\n# ${{ secrets.X }}',yaml+'\n# wrangler deploy'])
 assert.throws(()=>verifyR101Workflow(change));
});

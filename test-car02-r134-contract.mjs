/** R134 static contract: synthetic only; never a deploy or authorization gate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=fn=>fs.readFileSync(fn,'utf8');
const src=read('car02-r134-staging-contract-isolated.mjs');
const tests=read('test-car02-r134-staging-contract.mjs');
const older=read('car02-r133-integrated-journey-isolated.mjs');
const readiness=read('car02-r132-readiness-gate-isolated.mjs');
const yml=read('.github/workflows/car02-r134-staging-contract-isolated-qa.yml');
const checks=[
 ['release_no_go',()=>assert.match(src,/release:'NO_GO'/)],
 ['migration_hold',()=>assert.match(src,/migration:'HOLD'/)],
 ['not_production_ready',()=>assert.match(src,/productionReady:false/)],
 ['staging_not_deployed',()=>assert.match(src,/stagingDeployed:false/)],
 ['fake_auth_only',()=>assert.match(src,/realAuthentication:false/)],
 ['fake_db_atomicity',()=>assert.match(src,/realDbAtomicity:false/)],
 ['fake_tenant_rls',()=>assert.match(src,/realTenantIsolation:false/)],
 ['no_real_booking',()=>assert.match(src,/bookingCreated:false/)],
 ['no_real_payments',()=>assert.match(src,/paymentMade:false/)],
 ['no_real_line',()=>assert.match(src,/lineDispatch:false/)],
 ['no_storage',()=>assert.match(src,/photosStored:false/)],
 ['r133_remains_closed',()=>assert.match(older,/productionBooking:false/)],
 ['r132_has_12_unverified_gates',()=>assert.equal((readiness.match(/\['[A-Z_]+','[a-z]+',/g)||[]).length,12)],
 ['isolation_required',()=>assert.match(src,/R134_OFFLINE_QA==='yes'/)],
 ['release_lock_required',()=>assert.match(src,/CAR02_RELEASE_LOCK==='true'/)],
 ['version_conflict',()=>assert.match(src,/VERSION_CONFLICT/)],
 ['idempotency_collision',()=>assert.match(src,/IDEMPOTENCY_COLLISION/)],
 ['actor_validation',()=>assert.match(src,/ACTOR_FIXTURE/)],
 ['tenant_scoped_booking_ids',()=>assert.match(src,/CAR02-DEMO-\$\{req.tenantId\}/)],
 ['customer_approval_role',()=>assert.match(src,/requiresRole\(req.actor,\['CUSTOMER'\]\)/)],
 ['audit_chain',()=>assert.match(src,/previousHash:prev/)],
 ['no_filesystem_mutations',()=>assert.doesNotMatch(src,/\b(?:writeFile|appendFile|unlink|rmSync|mkdirSync|renameSync|copyFileSync|writeFileSync)\s*\(/)],
 ['no_network_or_server',()=>assert.doesNotMatch(src,/\bfetch\s*\(|\bhttps?\.request\s*\(|\bcreateServer\s*\(|\bwrangler\b|\bsupabase\b/)],
 ['functional_71_cases',()=>assert.equal((tests.match(/add\('/g)||[]).length,71)],
 ['workflow_read_only_permissions',()=>assert.match(yml,/permissions:\s*\n\s*contents: read/)],
 ['workflow_no_credential_retention',()=>assert.match(yml,/persist-credentials: false/)],
 ['workflow_original_gate',()=>assert.match(yml,/car02_r118_readonly_source_gate\.py --strict/)],
 ['workflow_3_rounds',()=>assert.match(yml,/for i in 1 2 3;/)],
 ['workflow_no_deploy_secrets',()=>assert.doesNotMatch(yml,/secrets\.|\bwrangler\s+deploy\b|\bsupabase\s+db\s+push\b|git\s+push/i)],
 ['workflow_no_go_hold_gate',()=>assert.match(yml,/R134_NO_GO_HOLD_GATE_PASS/)],
 ['workflow_artifact_sanitized',()=>assert.match(yml,/qa-evidence-r134/)],
];
for(const [name,run] of checks)test('R134_contract_'+name,run);

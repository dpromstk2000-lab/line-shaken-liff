// R101 immutable offline workflow gate. No network, production credentials or deploy.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const R101_STEPS=Object.freeze([
 'Checkout immutable reviewed sources',
 'Verify historic release lock and R99 success baseline',
 'Run existing R94B-R100 and R101 session regression tests',
 'Install PostgreSQL driver in isolated runner',
 'Create disposable PG17 schema and low privilege roles',
 'Verify seven table RLS with distinct tenant logins',
 'Challenge pooled session reuse and mixed tenant atomicity',
 'Remove disposable database, roles and temp files',
 'Final release remains NO_GO and migration HOLD'
]);
const safe=(re,s,code)=>{if(!re.test(s))throw Error('R101_WORKFLOW_'+code)};
export function verifyR101Workflow(source){
 if(typeof source!=='string'||source.length<5000)throw Error('R101_WORKFLOW_MISSING');
 safe(/^on:\s*\n\s+workflow_dispatch:\s*$/m,source,'MANUAL_ONLY');
 safe(/^permissions:\s*\n\s+contents: read\s*$/m,source,'READ_ONLY');
 safe(/image: postgres:17/,source,'PG17');
 safe(/R101_DISPOSABLE_SESSION_QA: 'yes'/,source,'DISPOSABLE_ONLY');
 safe(/R100_PG17_TENANT_RLS_FIXTURE_QA_ONLY\.sql/,source,'R100_SYNTHETIC_FIXTURE');
 safe(/R101_MIXED_TENANT_BATCH_ATOMIC_REJECTION_PASS/,source,'R101_ATOMIC');
 safe(/R101_DISPOSABLE_SESSION_RLS_QA_PASS/,source,'R101_PROOF');
 safe(/CREATE DATABASE car02_r93q_qa_ci/,source,'CREATE_DISPOSABLE');
 safe(/DROP DATABASE IF EXISTS car02_r93q_qa_ci WITH \(FORCE\)/,source,'DROP_DISPOSABLE');
 safe(/DROP ROLE IF EXISTS car02_r100_a_ci/,source,'DROP_TEST_ROLE_A');
 safe(/DROP ROLE IF EXISTS car02_r100_b_ci/,source,'DROP_TEST_ROLE_B');
 safe(/if: always\(\)/,source,'CLEANUP_ALWAYS');
 safe(/CAR02_RELEASE_LOCK=true/,source,'LOCK_REQUIRED');
 safe(/R101_PRODUCTION_NO_GO_MIGRATION_HOLD/,source,'NO_GO_HOLD');
 safe(/node car02-r100-pg17-tenant-rls-qa\.mjs/,source,'PRIOR_PG17_QA');
 for(const [path,hash] of Object.entries({
  'car02-private-photo-r47.mjs':'e0f3abec6bcf57830d9f3b72fe2eee099b1dff1d',
  'car02-unified-runtime-r50.mjs':'76e4e8cae27599f27e3d887118148718c32ebb80',
  'car02-edge-boundary-r51.mjs':'6614f2ed1933aa787576cb8074cb7d4bc704efa0',
  'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302'
 }))safe(new RegExp(path.replaceAll('.','\\.')+'\\)" = '+hash),source,'BASELINE_'+path);
 const seen=[...source.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1]);
 if(JSON.stringify(seen)!==JSON.stringify(R101_STEPS))throw Error('R101_STEP_DRIFT');
 const forbidden=[/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,
  /\bcontents:\s*write\b/i,/^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,
  /\b(?:curl|wget)\s+/i,/\bgh\s+(?:api|auth|workflow|release)\b/i,
  /\b(?:aws|gcloud|az)\s+/i,/\bdeploy(?:ment)?\b/i];
 for(const re of forbidden)if(re.test(source))throw Error('R101_WORKFLOW_UNSAFE_'+re.source);
 const ids=[...source.matchAll(/\bcar02_[a-z0-9_]+\b/g)].map(x=>x[0]);
 const allowed=new Set(['car02_r93q_qa_ci','car02_r100_a_ci','car02_r100_b_ci','car02_r93q_qa']);
 for(const id of ids)if(!allowed.has(id))throw Error('R101_DATABASE_NOT_ALLOWLISTED_'+id);
 return Object.freeze({ok:true,steps:seen.length,disposableOnly:true,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 console.log('R101_WORKFLOW_GUARD_PASS',JSON.stringify(verifyR101Workflow(readFileSync('.github/workflows/car02-r101-session-rls-qa.yml','utf8'))));
}

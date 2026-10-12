// R103 offline workflow allowlist; read-only manually triggered disposable CI only.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const R103_STEPS=Object.freeze([
 'Checkout immutable reviewed sources',
 'Verify production release lock and pinned source baseline',
 'Run R94B through R103 offline regression',
 'Install isolated PostgreSQL driver',
 'Prepare disposable PG17 photo, intent and cleanup schemas',
 'Run R103 simulated Storage deletion and durable recovery',
 'Always remove disposable DB and logs',
 'Confirm NO_GO and HOLD'
]);
const fail=(s)=>{throw Error('R103_WORKFLOW_'+s)};
export function verifyR103Workflow(yaml){
 if(typeof yaml!=='string'||yaml.length<3000)fail('MISSING');
 const req=(re,name)=>{if(!re.test(yaml))fail('MISSING_'+name)};
 req(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY');
 req(/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY');
 req(/image: postgres:17/,'PG17');
 req(/R103_DISPOSABLE_RECOVERY_QA: 'yes'/,'DISPOSABLE_ENV');
 req(/CREATE DATABASE car02_r93q_qa_ci/,'DISPOSABLE_CREATE');
 req(/R103_PG17_CLEANUP_RECEIPTS_FIXTURE_QA_ONLY\.sql/,'RECEIPT_SETUP');
 req(/R103_DISPOSABLE_RECOVERY_QA_PASS/,'RECOVERY_PROOF');
 req(/DROP DATABASE IF EXISTS car02_r93q_qa_ci WITH \(FORCE\)/,'DATABASE_REMOVE');
 req(/R103_DISPOSABLE_DB_REMOVED/,'CLEANUP_PROOF');
 req(/if: always\(\)/,'ALWAYS_CLEANUP');
 req(/CAR02_RELEASE_LOCK=true/,'HARD_LOCK');
 req(/R103_PRODUCTION_NO_GO_MIGRATION_HOLD/,'FINAL_LOCK');
 for(const [name,sha] of Object.entries({
  'car02-private-photo-r47.mjs':'e0f3abec6bcf57830d9f3b72fe2eee099b1dff1d',
  'car02-unified-runtime-r50.mjs':'76e4e8cae27599f27e3d887118148718c32ebb80',
  'car02-edge-boundary-r51.mjs':'6614f2ed1933aa787576cb8074cb7d4bc704efa0',
  'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302'
 }))req(new RegExp(name.replaceAll('.','\\.')+'\\)" = '+sha),'PINNED_SOURCE');
 const actual=[...yaml.matchAll(/^\s{6}- name: (.+)$/gm)].map(m=>m[1].trim());
 if(JSON.stringify(actual)!==JSON.stringify(R103_STEPS))fail('STEP_DRIFT');
 const denied=[/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,
  /\bcontents:\s*write\b/i,/^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,
  /\b(?:curl|wget)\s+/i,/\bgh\s+(?:api|auth|workflow|release)\b/i,
  /\b(?:aws|gcloud|az)\s+/i];
 for(const re of denied)if(re.test(yaml))fail('UNSAFE_'+re.source);
 const dbs=[...yaml.matchAll(/\bcar02_[a-z0-9_]+\b/g)].map(x=>x[0]);
 for(const name of dbs)if(!new Set(['car02_r93q_qa_ci','car02_r93q_qa']).has(name))fail('BAD_DB_'+name);
 return Object.freeze({ok:true,steps:actual.length,disposableOnly:true,manualOnly:true,
  releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
 console.log('R103_WORKFLOW_GUARD_PASS',JSON.stringify(verifyR103Workflow(
  readFileSync('.github/workflows/car02-r103-disposable-cleanup-recovery-qa.yml','utf8'))));

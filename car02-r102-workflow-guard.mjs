// Static R102 workflow allowlist, no production credentials or deployment.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const R102_STEPS=Object.freeze([
 'Checkout immutable reviewed sources',
 'Verify protected source hashes and release lock',
 'Run R94B-R102 regression and static guard',
 'Install isolated PostgreSQL driver',
 'Prepare disposable PG17 upload fixture',
 'R102 verify early rejection and one safe ready upload',
 'Always remove disposable database and logs',
 'Confirm production NO_GO and migration HOLD'
]);
export function verifyR102Workflow(yaml){
 if(typeof yaml!=='string'||yaml.length<3000)throw Error('R102_WORKFLOW_MISSING');
 const has=(re,msg)=>{if(!re.test(yaml))throw Error('R102_WORKFLOW_'+msg)};
 has(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY');
 has(/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY');
 has(/image: postgres:17/,'PG17_ONLY');
 has(/R102_DISPOSABLE_INGRESS_QA: 'yes'/,'ENV');
 has(/CREATE DATABASE car02_r93q_qa_ci/,'CREATE_DISPOSABLE');
 has(/DROP DATABASE IF EXISTS car02_r93q_qa_ci WITH \(FORCE\)/,'DROP_DISPOSABLE');
 has(/if: always\(\)/,'ALWAYS_CLEAN');
 has(/R102_DISPOSABLE_POSTGRES17_UPLOAD_AND_RETRY_PASS/,'REAL_DB_QA');
 has(/R102_EARLY_REJECT_DB_STORAGE_ZERO_PASS/,'EARLY_REJECT_QA');
 has(/CAR02_RELEASE_LOCK=true/,'RELEASE_LOCK');
 has(/R102_PRODUCTION_NO_GO_MIGRATION_HOLD/,'NO_GO_HOLD');
 for(const [path,hash] of Object.entries({
  'car02-private-photo-r47.mjs':'e0f3abec6bcf57830d9f3b72fe2eee099b1dff1d',
  'car02-unified-runtime-r50.mjs':'76e4e8cae27599f27e3d887118148718c32ebb80',
  'car02-edge-boundary-r51.mjs':'6614f2ed1933aa787576cb8074cb7d4bc704efa0',
  'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302'
 }))has(new RegExp(path.replaceAll('.','\\.')+'\\)" = '+hash),'BASELINE_'+path);
 const names=[...yaml.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1]);
 if(JSON.stringify(names)!==JSON.stringify(R102_STEPS))throw Error('R102_STEP_DRIFT');
 for(const forbidden of [/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,
  /\bcontents:\s*write\b/i,/^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,
  /\b(?:curl|wget)\s+/i,/\bgh\s+(?:api|auth|workflow|release)\b/i,
  /\b(?:aws|gcloud|az)\s+/i])if(forbidden.test(yaml))throw Error('R102_UNSAFE_WORKFLOW');
 const namesDB=[...yaml.matchAll(/\bcar02_[a-z0-9_]+\b/g)].map(x=>x[0]);
 if(namesDB.some(x=>!new Set(['car02_r93q_qa','car02_r93q_qa_ci']).has(x)))throw Error('R102_OTHER_DB');
 return Object.freeze({ok:true,steps:names.length,disposableOnly:true,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
 console.log('R102_WORKFLOW_GUARD_PASS',JSON.stringify(verifyR102Workflow(readFileSync('.github/workflows/car02-r102-early-ingress-qa.yml','utf8'))));

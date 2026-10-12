// R104 workflow allowlist, offline; no network, production credentials or deploy.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const FILE='.github/workflows/car02-r104-advisory-fence-qa.yml';
export const R104_STEPS=Object.freeze([
 'Checkout immutable reviewed sources',
 'Verify protected source hashes and release lock',
 'Run R94B through R104 offline regression',
 'Install isolated PostgreSQL driver',
 'Prepare disposable PG17 photo, intent and cleanup schemas',
 'Run R104 competing recovery workers and retry',
 'Always remove disposable DB and logs',
 'Confirm NO_GO and HOLD'
]);
export function verifyR104Workflow(yaml){
 if(typeof yaml!=='string'||yaml.length<3500)throw Error('R104_WORKFLOW_TOO_SHORT');
 function must(re,name){if(!re.test(yaml))throw Error('R104_WORKFLOW_'+name)}
 must(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY');
 must(/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY');
 must(/image: postgres:17/,'PG17');
 must(/R104_DISPOSABLE_FENCE_QA: 'yes'/,'DISPOSABLE_ENV');
 must(/CREATE DATABASE car02_r93q_qa_ci/,'CREATE_DB');
 must(/R103_PG17_CLEANUP_RECEIPTS_FIXTURE_QA_ONLY\.sql/,'RECEIPT_FIXTURE');
 must(/R104_DISPOSABLE_ADVISORY_FENCING_PASS/,'FENCE_CHALLENGE');
 must(/DROP DATABASE IF EXISTS car02_r93q_qa_ci WITH \(FORCE\)/,'DB_CLEANUP');
 must(/if: always\(\)/,'ALWAYS_CLEANUP');
 must(/R104_DISPOSABLE_DB_REMOVED/,'CLEANUP_PROOF');
 must(/CAR02_RELEASE_LOCK=true/,'HARD_LOCK');
 must(/R104_PRODUCTION_NO_GO_MIGRATION_HOLD/,'RELEASE_DENY');
 const actual=[...yaml.matchAll(/^\s{6}- name: (.+)$/gm)].map(m=>m[1]);
 if(JSON.stringify(actual)!==JSON.stringify(R104_STEPS))throw Error('R104_UNEXPECTED_STEPS');
 const forbidden=[/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,
  /\bcontents:\s*write\b/i,/^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,
  /\b(?:curl|wget)\s+/i,/\bgh\s+(?:api|auth|workflow|release)\b/i,
  /\b(?:aws|gcloud|az)\s+/i, /\bdeploy(?:ment)?\s+--/i];
 for(const p of forbidden)if(p.test(yaml))throw Error('R104_UNSAFE_WORKFLOW_'+p.source);
 // Never permit a second DB or a URL to an external database.
 for(const id of [...yaml.matchAll(/\bcar02_[a-z0-9_]+\b/g)].map(x=>x[0]))
  if(!new Set(['car02_r93q_qa_ci']).has(id))throw Error('R104_UNEXPECTED_DB_'+id);
 for(const [file,sha] of Object.entries({
  'car02-private-photo-r47.mjs':'e0f3abec6bcf57830d9f3b72fe2eee099b1dff1d',
  'car02-unified-runtime-r50.mjs':'76e4e8cae27599f27e3d887118148718c32ebb80',
  'car02-edge-boundary-r51.mjs':'6614f2ed1933aa787576cb8074cb7d4bc704efa0',
  'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302',
  'car02-private-photo-upload-http-r82.mjs':'78f8b0f80fcc1f89d15fd25e4593c660cd197ea3'
 }))must(new RegExp(file.replaceAll('.','\\.')+'\\)" = '+sha),'HASH_'+file);
 return Object.freeze({ok:true,steps:actual.length,manualOnly:true,isolatedOnly:true,
  productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
 console.log('R104_WORKFLOW_GUARD_PASS',JSON.stringify(verifyR104Workflow(readFileSync(FILE,'utf8'))));

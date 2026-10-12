// R105 workflow is allowlisted, disposable CI only, no production access.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const FILE='.github/workflows/car02-r105-generation-lease-qa.yml';
export const R105_STEPS=Object.freeze([
 'Checkout immutable reviewed sources',
 'Verify protected source hashes and release lock',
 'Run R94B through R105 offline regression',
 'Install isolated PostgreSQL driver',
 'Prepare disposable PG17 photo, intent, receipt and generation schemas',
 'Challenge stale generation takeover and receipt finalization',
 'Always remove disposable DB and logs',
 'Confirm NO_GO and HOLD'
]);
export function verifyR105Workflow(yaml){
 if(typeof yaml!=='string'||yaml.length<3500)throw Error('R105_WORKFLOW_MISSING');
 const requireText=(re,label)=>{if(!re.test(yaml))throw Error('R105_WORKFLOW_'+label)};
 requireText(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY');
 requireText(/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY');
 requireText(/image: postgres:17/,'PG17');
 requireText(/R105_DISPOSABLE_GENERATION_QA: 'yes'/,'DISPOSABLE_ENV');
 requireText(/CREATE DATABASE car02_r93q_qa_ci/,'CREATE_DB');
 requireText(/R105_PG17_LEASE_GENERATION_FIXTURE_QA_ONLY\.sql/,'GENERATION_SCHEMA');
 requireText(/R105_DISPOSABLE_GENERATION_LEASE_QA_PASS/,'QA_PROOF');
 requireText(/DROP DATABASE IF EXISTS car02_r93q_qa_ci WITH \(FORCE\)/,'DROP_DB');
 requireText(/if: always\(\)/,'ALWAYS_CLEAN');
 requireText(/R105_DISPOSABLE_DB_REMOVED/,'CLEANUP_PROOF');
 requireText(/CAR02_RELEASE_LOCK=true/,'LOCK');
 requireText(/R105_PRODUCTION_NO_GO_MIGRATION_HOLD/,'NO_GO');
 const actual=[...yaml.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1]);
 if(JSON.stringify(actual)!==JSON.stringify(R105_STEPS))throw Error('R105_STEPS_DRIFT');
 for(const r of [/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,
  /\bcontents:\s*write\b/i,/^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,
  /\b(?:curl|wget)\s+/i,/\bgh\s+(?:api|auth|workflow|release)\b/i,
  /\b(?:aws|gcloud|az)\s+/i, /\bdeploy(?:ment)?\s+--/i])
  if(r.test(yaml))throw Error('R105_WORKFLOW_UNSAFE_'+r.source);
 for(const id of [...yaml.matchAll(/\bcar02_[a-z0-9_]+\b/g)].map(x=>x[0]))
  if(id!=='car02_r93q_qa_ci')throw Error('R105_UNEXPECTED_DATABASE_'+id);
 for(const [file,sha] of Object.entries({
  'car02-private-photo-r47.mjs':'e0f3abec6bcf57830d9f3b72fe2eee099b1dff1d',
  'car02-unified-runtime-r50.mjs':'76e4e8cae27599f27e3d887118148718c32ebb80',
  'car02-edge-boundary-r51.mjs':'6614f2ed1933aa787576cb8074cb7d4bc704efa0',
  'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302',
  'car02-private-photo-upload-http-r82.mjs':'78f8b0f80fcc1f89d15fd25e4593c660cd197ea3'
 }))requireText(new RegExp(file.replaceAll('.','\\.')+'\\)" = '+sha),'PIN_'+file);
 return Object.freeze({ok:true,steps:actual.length,manualOnly:true,disposableOnly:true,
  releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 console.log('R105_WORKFLOW_GUARD_PASS',JSON.stringify(verifyR105Workflow(readFileSync(FILE,'utf8'))));
}

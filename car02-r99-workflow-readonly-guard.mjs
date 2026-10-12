// R99: offline allowlist of the isolated PostgreSQL 17 Actions workflow.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const FILE='.github/workflows/car02-r99-disposable-upload-boundary-qa.yml';
export const R99_STEP_ALLOWLIST=Object.freeze([
 'Checkout immutable reviewed sources',
 'Confirm source baseline and production release lock',
 'Offline regression tests R94B through R99',
 'Install disposable PostgreSQL 17 driver',
 'Create isolated PG17 schema and staff fixtures',
 'Run R99 cross tenant and storage recovery challenges',
 'Remove disposable database and temporary logs',
 'Final no deploy release gate'
]);
function deny(code){throw Error('R99_WORKFLOW_'+code)}
export function verifyR99Workflow(yaml){
 if(typeof yaml!=='string'||yaml.length<3000)deny('MISSING');
 const requireText=(re,label)=>{if(!re.test(yaml))deny('MISSING_'+label)};
 requireText(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY');
 requireText(/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY');
 requireText(/image: postgres:17/,'PG17');
 requireText(/R99_DISPOSABLE_BOUNDARY_QA: 'yes'/,'DISPOSABLE_ENV');
 requireText(/CREATE DATABASE car02_r93q_qa_ci/,'CREATE_DB');
 requireText(/DROP DATABASE IF EXISTS car02_r93q_qa_ci WITH \(FORCE\)/,'DELETE_DB');
 requireText(/if: always\(\)/,'CLEANUP_ALWAYS');
 requireText(/R99_DISPOSABLE_DB_REMOVED/,'CLEANUP_VERIFIED');
 requireText(/R99_DISPOSABLE_BOUNDARY_VERIFIED_PASS/,'ADVERSARIAL_QA');
 requireText(/R99_PRODUCTION_NO_GO_MIGRATION_HOLD/,'NO_GO_HOLD');
 requireText(/CAR02_RELEASE_LOCK=true/,'HARD_LOCK');
 for(const [name,sha] of Object.entries({
  'car02-private-photo-r47.mjs':'e0f3abec6bcf57830d9f3b72fe2eee099b1dff1d',
  'car02-unified-runtime-r50.mjs':'76e4e8cae27599f27e3d887118148718c32ebb80',
  'car02-edge-boundary-r51.mjs':'6614f2ed1933aa787576cb8074cb7d4bc704efa0',
  'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302'
 }))requireText(new RegExp(name.replaceAll('.','\\.')+'\\)" = '+sha), 'SOURCE_PIN');
 const actual=[...yaml.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1]);
 if(JSON.stringify(actual)!==JSON.stringify(R99_STEP_ALLOWLIST))deny('STEP_DRIFT');
 const forbidden=[/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,
  /\bgh\s+(?:api|auth|workflow|release)\b/i,/\bcontents:\s*write\b/i,
  /^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,/\bdeploy(?:ment)?\s+--/i,
  /\bcurl\s+/i,/\bwget\s+/i,/\b(?:aws|gcloud|az)\s+/i];
 for(const x of forbidden)if(x.test(yaml))deny('UNSAFE_'+x.source);
 const sqlDbs=[...yaml.matchAll(/\bcar02_[a-z0-9_]+\b/g)].map(x=>x[0]);
 const allowed=new Set(['car02_r93q_qa_ci']);
 for(const db of sqlDbs)if(!allowed.has(db))deny('DATABASE_NOT_ALLOWED_'+db);
 return Object.freeze({ok:true,disposableOnly:true,manualOnly:true,
  steps:actual.length,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 console.log('R99_WORKFLOW_READONLY_GUARD_PASS',JSON.stringify(verifyR99Workflow(readFileSync(FILE,'utf8'))));
}

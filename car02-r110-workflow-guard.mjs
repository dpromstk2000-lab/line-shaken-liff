// R110: source-only/manual CI safety gate, no live production access or release approval.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const R110_STEPS=Object.freeze([
 'Checkout reviewed immutable sources',
 'Verify seven protected hashes and hard release lock',
 'Run R94B through R110 offline tests and safety guard',
 'Install isolated PostgreSQL driver',
 'Create disposable R109 and R110 review schemas',
 'Exercise scoped review events and immutable quarantine',
 'Always remove disposable database and all roles',
 'Confirm NO_GO HOLD without deployment'
]);
export function verifyR110Workflow(yml){
 if(typeof yml!=='string'||yml.length<4300)throw Error('R110_YML_MISSING');
 const req=(re,k)=>{if(!re.test(yml))throw Error('R110_GUARD_'+k)};
 req(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY');
 req(/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY');
 req(/image: postgres:17/,'PG17');
 req(/R110_DISPOSABLE_QA: 'yes'/,'DISPOSABLE_ONLY');
 req(/R109_PG17_DURABLE_QUARANTINE_QA_ONLY\.sql/,'R109_FIXTURE');
 req(/R110_PG17_REVIEW_EVENTS_QA_ONLY\.sql/,'R110_FIXTURE');
 req(/R110_DISPOSABLE_REVIEW_EVENTS_QA_PASS/,'INTEGRATION');
 req(/if: always\(\)/,'CLEAN_ALWAYS');
 req(/DROP DATABASE IF EXISTS car02_r109_qa_ci WITH \(FORCE\)/,'CLEAN_DB');
 for(const name of ['r109_a','r109_b','r110_a','r110_b'])req(new RegExp(`DROP ROLE IF EXISTS car02_${name}_ci`),'CLEAN_'+name);
 req(/SELECT CASE WHEN NOT EXISTS \(SELECT 1 FROM pg_database/,'CLEAN_PROOF');
 req(/\| grep -Fxq R110_DISPOSABLE_DATABASE_AND_ROLES_REMOVED/,'CLEAN_ASSERT');
 req(/R110_PRODUCTION_NO_GO_MIGRATION_HOLD/,'RELEASE_LOCK');
 req(/const CAR02_RELEASE_LOCK=true/,'HARD_LOCK');
 if((yml.match(/const CAR02_RELEASE_LOCK=true/g)||[]).length!==2||/const CAR02_RELEASE_LOCK=false/.test(yml))
  throw Error('R110_RELEASE_PIN_DRIFT');
 const steps=[...yml.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1]);
 if(JSON.stringify(steps)!==JSON.stringify(R110_STEPS))throw Error('R110_UNEXPECTED_STEPS');
 for(const re of [/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,
  /\bcontents:\s*write\b/i,/^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,
  /\b(?:curl|wget)\s+/i,/\b(?:gh|aws|gcloud|az)\s+(?:api|auth|deploy|release)\b/i,
  /\b(?:supabase\.co|storage\/v1)\b/i]) if(re.test(yml))throw Error('R110_FORBIDDEN_'+re.source);
 return Object.freeze({ok:true,steps:steps.length,manualOnly:true,disposableOnly:true,
  productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 console.log('R110_WORKFLOW_GUARD_PASS',JSON.stringify(verifyR110Workflow(readFileSync('.github/workflows/car02-r110-append-only-review-qa.yml','utf8'))));
}

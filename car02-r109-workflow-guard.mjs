// R109 locked, manual, reviewed CI-only workflow. No production deploy or credentials.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const R109_STEPS=Object.freeze([
 'Checkout reviewed immutable sources',
 'Verify seven protected Git hashes and hard release lock',
 'Run R94B through R109 offline tests and safety guard',
 'Install isolated PostgreSQL driver',
 'Create fresh disposable PG17 DB and role-scoped ledger',
 'Exercise tenant isolation immutable ledger and process restart',
 'Always destroy disposable DB roles and logs',
 'Confirm NO_GO HOLD and no deployment'
]);
export function verifyR109Workflow(yml){
 if(typeof yml!=='string'||yml.length<3600)throw Error('R109_WORKFLOW_MISSING');
 const require=(expr,name)=>{if(!expr.test(yml))throw Error('R109_WORKFLOW_'+name)};
 require(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY');
 require(/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY');
 require(/image: postgres:17/,'PG17');
 require(/R109_DISPOSABLE_QA: 'yes'/,'QA_ONLY');
 require(/R109_PG17_DURABLE_QUARANTINE_QA_ONLY\.sql/,'FIXTURE_ONLY');
 require(/R109_DISPOSABLE_DURABLE_QUARANTINE_QA_PASS/,'INTEGRATION_REQUIRED');
 require(/DROP DATABASE IF EXISTS car02_r109_qa_ci WITH \(FORCE\)/,'DATABASE_CLEANUP');
 require(/DROP ROLE IF EXISTS car02_r109_a_ci/,'ROLE_A_CLEANUP');
 require(/DROP ROLE IF EXISTS car02_r109_b_ci/,'ROLE_B_CLEANUP');
 require(/if: always\(\)/,'ALWAYS_CLEAN');
 require(/\| grep -Fxq R109_DISPOSABLE_DB_AND_ROLES_REMOVED/,'CLEAN_CHECK');
 require(/SELECT CASE WHEN NOT EXISTS \(SELECT 1 FROM pg_database/,'ABSENCE_PROOF');
 require(/R109_PRODUCTION_NO_GO_MIGRATION_HOLD/,'RELEASE_DENIED');
 require(/const CAR02_RELEASE_LOCK=true/,'IMMUTABLE_LOCK');
 const actual=[...yml.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1]);
 if(JSON.stringify(actual)!==JSON.stringify(R109_STEPS))throw Error('R109_UNEXPECTED_STEPS');
 const forbidden=[/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,
  /\bcontents:\s*write\b/i,/^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,
  /\b(?:curl|wget)\s+/i,/\bgh\s+(?:api|auth|workflow|release)\b/i,
  /\b(?:aws|gcloud|az)\s+/i,/\b(?:supabase\.co|storage\/v1)\b/i];
 for(const re of forbidden)if(re.test(yml))throw Error('R109_FORBIDDEN_'+re.source);
 return Object.freeze({ok:true,steps:actual.length,manualOnly:true,disposableOnly:true,
  productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
 console.log('R109_WORKFLOW_READONLY_GUARD_PASS',JSON.stringify(verifyR109Workflow(readFileSync('.github/workflows/car02-r109-durable-quarantine-qa.yml','utf8'))));

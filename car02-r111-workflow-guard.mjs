// CAR02 R111 source-only workflow allowlist and permanent production lock.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const R111_STEPS=Object.freeze([
 'Checkout immutable reviewed sources',
 'Verify protected hashes and release lock',
 'Run R94B through R111 offline regression',
 'Install isolated PostgreSQL driver',
 'Initialize disposable ledger and inbox fixtures',
 'Exercise R111 readonly tenant inbox and pagination',
 'Always remove disposable DB and test roles',
 'Confirm no deploy and release lock'
]);
export function verifyR111Workflow(yml){
 if(typeof yml!=='string'||yml.length<4400)throw Error('R111_WORKFLOW_MISSING');
 const require=(re,id)=>{if(!re.test(yml))throw Error('R111_WORKFLOW_'+id)};
 require(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY');
 require(/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY');
 require(/image: postgres:17/,'POSTGRES_17');
 require(/R111_DISPOSABLE_QA: 'yes'/,'DISPOSABLE_ENV');
 require(/R111_PG17_READONLY_INBOX_QA_ONLY\.sql/,'FIXTURE_SQL');
 require(/R111_DISPOSABLE_READONLY_INBOX_QA_PASS/,'PROOF');
 require(/# tests 403/,'REGRESSION_403');
 require(/R111_TENANT_SCOPED_READONLY_INBOX_PASS/,'TENANT_PROOF');
 require(/R111_KEYSET_PAGE_AND_ESCALATION_FILTER_PASS/,'PAGE_PROOF');
 require(/DROP DATABASE IF EXISTS car02_r109_qa_ci WITH \(FORCE\)/,'DB_REMOVE');
 require(/DROP ROLE IF EXISTS \$ROLE/,'DROP_ROLE_LOOP');
 require(/for ROLE in car02_r111_a_ci car02_r111_b_ci car02_r110_a_ci car02_r110_b_ci car02_r109_a_ci car02_r109_b_ci/,'SIX_TEST_ROLES');
 require(/if: always\(\)/,'ALWAYS_CLEAN');
 require(/SELECT CASE WHEN NOT EXISTS \(SELECT 1 FROM pg_database/,'ABSENCE_SQL');
 require(/THEN 'R111_DISPOSABLE_DB_AND_ROLES_REMOVED'/,'CLEAN_EXPECTED');
 require(/\| grep -Fxq R111_DISPOSABLE_DB_AND_ROLES_REMOVED/,'VERIFY_CLEAN');
 require(/R111_PRODUCTION_NO_GO_MIGRATION_HOLD/,'NO_GO');
 require(/const CAR02_RELEASE_LOCK=true/,'RELEASE_LOCK');
 const steps=[...yml.matchAll(/^\s{6}- name: (.+)$/gm)].map(m=>m[1]);
 if(JSON.stringify(steps)!==JSON.stringify(R111_STEPS))throw Error('R111_UNEXPECTED_WORKFLOW_STEPS');
 for(const re of [/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,
  /\bcontents:\s*write\b/i,/^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,
  /\b(?:curl|wget)\s+/i,/\bgh\s+(?:api|auth|workflow|release)\b/i,
  /\b(?:supabase\.co|storage\/v1)\b/i,/\b(?:aws|gcloud|az)\s+/i])
  if(re.test(yml))throw Error('R111_FORBIDDEN_'+re.source);
 return Object.freeze({ok:true,steps:steps.length,manualOnly:true,readOnlyRepo:true,
  disposableDbOnly:true,productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
 console.log('R111_WORKFLOW_GUARD_PASS',JSON.stringify(verifyR111Workflow(readFileSync('.github/workflows/car02-r111-readonly-inbox-qa.yml','utf8'))));

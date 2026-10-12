// R100 workflow allowlist: no deploy, no production secrets, disposable PostgreSQL 17 only.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const R100_STEPS=Object.freeze([
 'Checkout immutable reviewed sources',
 'Verify historic release lock and R99 success baseline',
 'Run existing R94B-R99 regression and R100 safety tests',
 'Install PostgreSQL driver in isolated runner',
 'Create disposable PG17 schema and low privilege roles',
 'Verify seven table RLS with distinct tenant logins',
 'Remove disposable database, roles and temp files',
 'Final release remains NO_GO and migration HOLD'
]);
export function verifyR100Workflow(yaml){
 if(typeof yaml!=='string'||yaml.length<3000)throw Error('R100_WORKFLOW_MISSING');
 const require=(re,label)=>{if(!re.test(yaml))throw Error('R100_WORKFLOW_'+label)};
 require(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY');
 require(/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY');
 require(/image: postgres:17/,'PG17');
 require(/R100_DISPOSABLE_RLS_QA: 'yes'/,'DISPOSABLE_ONLY');
 require(/CREATE DATABASE car02_r93q_qa_ci/,'CREATE_DISPOSABLE');
 require(/R100_PG17_TENANT_RLS_FIXTURE_QA_ONLY\.sql/,'RLS_FIXTURE');
 require(/R100_DISPOSABLE_TENANT_RLS_QA_PASS/,'LOW_PRIVILEGE_QA');
 require(/DROP DATABASE IF EXISTS car02_r93q_qa_ci WITH \(FORCE\)/,'DROP_DB');
 require(/DROP ROLE IF EXISTS car02_r100_a_ci/,'DROP_ROLE_A');
 require(/DROP ROLE IF EXISTS car02_r100_b_ci/,'DROP_ROLE_B');
 require(/if: always\(\)/,'ALWAYS_CLEAN');
 require(/CAR02_RELEASE_LOCK=true/,'RELEASE_LOCK');
 require(/R100_PRODUCTION_NO_GO_MIGRATION_HOLD/,'RELEASE_DENY');
 const actual=[...yaml.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1]);
 if(JSON.stringify(actual)!==JSON.stringify(R100_STEPS))throw Error('R100_WORKFLOW_UNEXPECTED_STEPS');
 const denied=[/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,
  /\bcontents:\s*write\b/i,/^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,
  /\b(?:curl|wget)\s+/i,/\bgh\s+(?:api|auth|workflow|release)\b/i,
  /\b(?:aws|gcloud|az)\s+/i];
 for(const re of denied)if(re.test(yaml))throw Error('R100_WORKFLOW_FORBIDDEN_'+re.source);
 const dbIds=[...yaml.matchAll(/\bcar02_[a-z0-9_]+\b/g)].map(x=>x[0]);
 for(const name of dbIds)if(!new Set(['car02_r93q_qa_ci','car02_r100_a_ci','car02_r100_b_ci','car02_r93q_qa']).has(name))throw Error('R100_DB_OR_ROLE_NOT_ALLOWLISTED_'+name);
 return Object.freeze({ok:true,steps:actual.length,isolatedOnly:true,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
 console.log('R100_WORKFLOW_READONLY_GUARD_PASS',JSON.stringify(verifyR100Workflow(readFileSync('.github/workflows/car02-r100-tenant-rls-qa.yml','utf8'))));

// CAR02 R97 workflow must remain manual, GitHub read-only, repo-source-only.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const fail=code=>{throw Error('R97_WORKFLOW_'+code)};
export const R97_STEPS=Object.freeze([
 'Checkout reviewed main',
 'Check immutable source and release lock',
 'Run offline security and order readiness regression tests',
 'Audit product intake template and unresolved deployment gates',
 'Confirm production remains closed'
]);
export function verifyR97Workflow(yaml){
 if(typeof yaml!=='string'||yaml.length<1300)fail('MISSING');
 const check=(re,label)=>{if(!re.test(yaml))fail(label)};
 check(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY');
 check(/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY');
 check(/CAR02_RELEASE_LOCK=true/,'HARD_LOCK');
 check(/node car02-r93t-release-preflight\.mjs/,'R93T_PREFLIGHT');
 check(/node --test test-car02-r94b-backup-restore-contract\.mjs/,'REGRESSION');
 check(/node car02-r97-readonly-preflight\.mjs/,'R97_AUDIT');
 check(/R97_PRODUCT_READINESS_SOURCE_ONLY_NO_GO_HOLD_PASS/,'EXPECTED_RESULT');
 check(/R97_PRODUCT_READINESS_SOURCE_ONLY_NO_GO_HOLD_PASS.*NO_GO/m,'CLOSED');
 const steps=[...yaml.matchAll(/^\s{6}- name: (.*)$/gm)].map(x=>x[1]);
 if(steps.join('|')!==R97_STEPS.join('|'))fail('STEP_ALLOWLIST');
 const forbidden=[/\$\{\{\s*secrets\./i,/\b(?:wrangler|curl|wget|psql|pg_restore|pg_dump|docker|supabase)\b/i,
  /\b(?:deploy|release|publish)\s+--/i,/\bgh\s+(?:api|auth|workflow|release)\b/i,
  /^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,/\bcontents:\s*write\b/i,
  /\bworkflow_call\s*:/i,/\b(?:aws|gcloud|az)\s+/i,
  /\b(?:npm|pnpm|yarn)\s+(?:install|add)\b/i,
  /\bhttps?:\/\//i];
 for(const re of forbidden)if(re.test(yaml))fail('FORBIDDEN_'+re.source);
 return Object.freeze({ok:true,steps:5,manualOnly:true,readOnly:true,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const yaml=readFileSync('.github/workflows/car02-r97-order-readiness-qa.yml','utf8');
 console.log('R97_WORKFLOW_READONLY_GUARD_PASS',JSON.stringify(verifyR97Workflow(yaml)));
}

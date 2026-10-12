// R98 GitHub Actions source-only guard. Does not connect to or modify backend resources.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const R98_STEPS=Object.freeze([
 'Checkout read-only main',
 'Confirm immutable release lock and source baseline',
 'Run R94B through R98 offline regression suite',
 'Run R97 preflight and R98 workflow safety audit',
 'Final production lock assertion'
]);
export function verifyR98Workflow(yaml){
 const deny=code=>{throw Error('R98_WORKFLOW_'+code)};
 if(typeof yaml!=='string'||yaml.length<1300||yaml.length>7000)deny('INVALID');
 const required=[[/^on:\s*\n\s+workflow_dispatch:\s*$/m,'TRIGGER'],[/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY'],[/CAR02_RELEASE_LOCK=true/,'RELEASE_LOCK'],[/car02-r97-readonly-preflight\.mjs/,'R97_PREFLIGHT'],[/node --test/,'TESTS'],[/R98_PRODUCT_WORKSHEET_LOCAL_QA_PASS/,'PASS_GATE']];
 for(const [regex,name] of required)if(!regex.test(yaml))deny('MISSING_'+name);
 const steps=[...yaml.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1].trim());
 if(JSON.stringify(steps)!==JSON.stringify(R98_STEPS))deny('STEP_ALLOWLIST');
 const forbidden=[/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bsupabase\b/i,/\bcurl\b/i,/\bwget\b/i,/\bgh\s+api\b/i,/\bcontents:\s*write\b/i,/\bworkflow_call\s*:/i,/^\s+(push|pull_request|schedule|repository_dispatch):/m,/\bdeploy\b/i,/\bdocker\b/i,/\bpostgres\b/i,/\bpsql\b/i,/\bpg_restore\b/i];
 for(const expression of forbidden)if(expression.test(yaml))deny('UNSAFE_'+expression.source);
 return Object.freeze({ok:true,steps:steps.length,manualOnly:true,readOnly:true,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 console.log('R98_WORKFLOW_READONLY_GUARD_PASS',JSON.stringify(verifyR98Workflow(readFileSync('.github/workflows/car02-r98-order-intake-qa.yml','utf8'))));
}

// Offline QA only; static demo, no deployment or provider authorization.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const EXPECTED=Object.freeze(['Checkout immutable reviewed sources','Verify seven protected hashes and release lock','Run R94B through R112 offline regression','Confirm no deploy, no secrets and release HOLD']);
export function verifyR112Workflow(yml){
 if(typeof yml!=='string'||yml.length<2100)throw Error('R112_WORKFLOW_MISSING');
 const req=(pattern,label)=>{if(!pattern.test(yml))throw Error('R112_GUARD_'+label)};
 req(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL');
 req(/^permissions:\s*\n\s+contents: read\s*$/m,'READONLY');
 req(/grep -Fxq '# tests 433'/,'TOTAL_TEST_COUNT');
 req(/R112_PRODUCTION_NO_GO_MIGRATION_HOLD/,'RELEASE');
 req(/const CAR02_RELEASE_LOCK=true/,'LOCK');
 req(/test-car02-r112-review-demo\.mjs/,'NEW_TEST');
 req(/car02-r112-review-demo-model\.mjs/,'MODEL');
 req(/R112_BROWSER_ONLY_FAKE_DATA/,'NO_LIVE');
 const steps=[...yml.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1]);
 if(JSON.stringify(steps)!==JSON.stringify(EXPECTED))throw Error('R112_UNEXPECTED_STEPS');
 for(const re of [/\$\{\{\s*secrets\./i,/\bcontents:\s*write\b/i,/^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,/\b(?:wrangler deploy|supabase db push|supabase functions deploy|curl|wget)\b/i,/\bSERVICE_ROLE_KEY\b/i,/\b(?:storage\/v1|\.supabase\.co)\b/i]){
  if(re.test(yml))throw Error('R112_FORBIDDEN_'+re.source);
 }
 return Object.freeze({ok:true,manualOnly:true,readOnly:true,steps:steps.length,productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
 console.log('R112_WORKFLOW_GUARD_PASS',JSON.stringify(verifyR112Workflow(readFileSync('.github/workflows/car02-r112-review-demo-qa.yml','utf8'))));

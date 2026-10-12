// R108 source-only GitHub Actions guard. Does not execute network operations.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const STEPS=Object.freeze(['Checkout approved source-only repository','Validate seven protected Git blob hashes','Run R94B to R108 local regression','Read-only storage transition evidence gate','Final immutable production lock']);
const fail=s=>{throw Error('R108_WORKFLOW_'+s)};
export function verifyR108Workflow(yaml){
 if(typeof yaml!=='string'||yaml.length<2500)fail('MISSING');
 for(const [re,code] of [[/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY'],[/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY'],[/R108_QUARANTINE_ONLY_SOURCE_GATE_NO_GO_HOLD_PASS/,'QUARANTINE_PROOF'],[/R108_PRODUCTION_NO_GO_MIGRATION_HOLD/,'RELEASE_LOCK'],[/CAR02_RELEASE_LOCK=true/,'HARDCODED_LOCK']])if(!re.test(yaml))fail(code);
 const actual=[...yaml.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1]);
 if(JSON.stringify(actual)!==JSON.stringify(STEPS))fail('STEP_DRIFT');
 for(const re of [/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bsupabase\s+db\b/i,/\bcontents:\s*write\b/i,/^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,/\b(?:curl|wget|aws|gcloud)\s+/i,/\bnode\s+--experimental-network-inspection/i,/\bgh\s+(?:api|auth|release)\b/i,/\bnpm\s+publish\b/i])if(re.test(yaml))fail('FORBIDDEN_'+re.source);
 if(!yaml.includes('test-car02-r108-storage-transition.mjs')||!yaml.includes('test-car02-r107-storage-compatibility.mjs'))fail('MISSING_REGRESSION');
 return Object.freeze({ok:true,manualOnly:true,sourceOnly:true,steps:STEPS.length,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
 console.log('R108_WORKFLOW_GUARD_PASS',JSON.stringify(verifyR108Workflow(readFileSync('.github/workflows/car02-r108-storage-transition-audit.yml','utf8'))));

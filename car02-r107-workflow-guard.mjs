// R107 manual, read-only, offline provider compatibility audit. No deploy or live credentials.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const R107_STEPS=Object.freeze([
 'Checkout reviewed source-only repository',
 'Verify protected hashes and hard release lock',
 'Run R94B through R107 offline regression',
 'Audit actual source and provider capability blockers',
 'Assert release remains NO_GO migration HOLD'
]);
function fail(k){throw Error('R107_WORKFLOW_'+k);}
export function verifyR107Workflow(yaml){
 if(typeof yaml!=='string'||yaml.length<1800)fail('MISSING');
 const need=(re,k)=>{if(!re.test(yaml))fail('MISSING_'+k);};
 need(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY');
 need(/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY');
 need(/node --test /,'TESTS');
 need(/car02-r107-storage-compatibility-gate\.mjs/,'AUDIT');
 need(/R107_STORAGE_COMPATIBILITY_SOURCE_GATE_NO_GO_HOLD_PASS/,'AUDIT_PROOF');
 need(/R107_PRODUCTION_NO_GO_MIGRATION_HOLD/,'FINAL_GATE');
 need(/const CAR02_RELEASE_LOCK=true/,'LOCK');
 need(/git hash-object car02-r93s-durable-upload-intent-isolated\.mjs/,'SOURCE_PIN');
 const steps=[...yaml.matchAll(/^\s{6}- name: (.+)$/gm)].map(m=>m[1]);
 if(JSON.stringify(steps)!==JSON.stringify(R107_STEPS))fail('UNEXPECTED_STEPS');
 for(const re of [/\$\{\{\s*secrets\./i,/^\s+push:/m,/^\s+pull_request:/m,
   /\bcontents:\s*write\b/i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,
   /\b(?:curl|wget)\s+/i,/\b(?:aws|gcloud|az)\s+/i,/\bgh\s+(?:api|auth|workflow|release)\b/i,
   /\b(?:psql|pg_dump|pg_restore|docker|npm install)\b/i]) if(re.test(yaml))fail('UNSAFE_'+re.source);
 return Object.freeze({ok:true,steps:steps.length,manualOnly:true,readOnly:true,
  liveProviderVerified:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
 console.log('R107_WORKFLOW_GUARD_PASS',JSON.stringify(verifyR107Workflow(readFileSync('.github/workflows/car02-r107-storage-compatibility-audit.yml','utf8'))));

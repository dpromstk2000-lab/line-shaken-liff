// R106: allowlist a single manual read-only disposable PG17 workflow.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const R106_STEPS=Object.freeze([
 'Checkout immutable approved sources',
 'Verify source baseline and release lock',
 'Run R94B to R106 offline regression',
 'Install isolated PostgreSQL driver',
 'Prepare disposable PG17 and version-bound cleanup fixture',
 'Challenge version replacement and lost acknowledgment recovery',
 'Always remove disposable DB and logs',
 'Confirm NO_GO HOLD and no deploy'
]);
export function verifyR106Workflow(yaml){
 const deny=c=>{throw Error('R106_WORKFLOW_'+c)};
 if(typeof yaml!=='string'||yaml.length<3500)deny('MISSING');
 const need=(p,c)=>{if(!p.test(yaml))deny('MISSING_'+c)};
 need(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL');
 need(/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY');
 need(/image: postgres:17/,'PG17');
 need(/R106_DISPOSABLE_VERSION_QA: 'yes'/,'ENV');
 need(/R106_PG17_VERSION_PIN_FIXTURE_QA_ONLY\.sql/,'FIXTURE');
 need(/R105_PG17_LEASE_GENERATION_FIXTURE_QA_ONLY\.sql/,'LEASE');
 need(/CREATE DATABASE car02_r93q_qa_ci/,'CREATE');
 need(/DROP DATABASE IF EXISTS car02_r93q_qa_ci WITH \(FORCE\)/,'DROP');
 need(/if: always\(\)/,'CLEANUP');
 need(/R106_DISPOSABLE_DB_REMOVED/,'CLEAN_VERIFIED');
 need(/R106_DISPOSABLE_CONDITIONAL_DELETE_QA_PASS/,'QA_PROOF');
 need(/R106_PRODUCTION_NO_GO_MIGRATION_HOLD/,'NO_GO');
 need(/const CAR02_RELEASE_LOCK=true/,'HARD_LOCK');
 const steps=[...yaml.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1]);
 if(JSON.stringify(steps)!==JSON.stringify(R106_STEPS))deny('EXTRA_STEPS');
 const forbidden=[/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,
  /\bcontents:\s*write\b/i,/^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,
  /\b(?:curl|wget)\s+/i,/\b(?:aws|gcloud|az)\s+/i,/\bgh\s+(?:api|auth|release|workflow)\b/i];
 for(const re of forbidden)if(re.test(yaml))deny('FORBIDDEN_'+re.source);
 const all=[...yaml.matchAll(/\bcar02_[a-z0-9_]+\b/g)].map(m=>m[0]);
 const ok=new Set(['car02_r93q_qa_ci']);
 for(const db of all)if(!ok.has(db))deny('FOREIGN_DB_'+db);
 return Object.freeze({ok:true,steps:steps.length,manualOnly:true,disposableOnly:true,
  productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
 console.log('R106_WORKFLOW_GUARD_PASS',JSON.stringify(verifyR106Workflow(readFileSync('.github/workflows/car02-r106-conditional-delete-qa.yml','utf8'))));

// DPRO CAR02 R95 offline source-only protection. Never uses network or credentials.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const FILE='.github/workflows/car02-r95-restore-drift-qa.yml';
export const EXPECTED_R95_STEPS=Object.freeze([
 'Checkout read-only approved sources',
 'Confirm release lock and GitHub source baseline',
 'Offline syntax and negative security tests',
 'Install isolated Node PostgreSQL test driver',
 'Create source fixture inside disposable PostgreSQL 17',
 'Seed realistic staging photo and cleanup lifecycle',
 'Backup source database with container native pg_dump',
 'Restore into distinct empty disposable database',
 'Verify data, constraints, immutable receipts and outbox after restore',
 'R95 transactional rollback-only restore drift challenge',
 'Remove disposable source, restored DB and dump',
 'Final immutable read-only release gate'
]);
export function verifyR95Workflow(yaml){
 if(typeof yaml!=='string'||yaml.length<6000)throw Error('R95_WORKFLOW_MISSING');
 const required=[
  [/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY'],
  [/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY_PERMISSIONS'],
  [/image: postgres:17/,'PG17_SERVICE'],
  [/CAR02_RELEASE_LOCK=true/,'HARD_LOCK'],
  [/R94B_RELEASE_NO_GO_HOLD_PASS/,'NO_GO_HOLD'],
  [/R94B_DISPOSABLE_BACKUP_RESTORE_VERIFIED_PASS/,'R94B_VERIFICATION'],
  [/R95_RESTORE_DRIFT_4_4_PASS/,'R95_VERIFICATION'],
  [/R94B_DISPOSABLE_DBS_REMOVED/,'DISPOSABLE_DB_REMOVAL'],
  [/if: always\(\)/,'UNCONDITIONAL_CLEANUP'],
  [/pg_dump -U postgres -d car02_r93q_qa_ci/,'DUMP_SOURCE'],
  [/pg_restore -U postgres -d car02_r94b_restore_ci/,'RESTORE_DESTINATION'],
  [/--exit-on-error --single-transaction/,'ATOMIC_RESTORE'],
  [/R94B_NO_PRODUCTION_MUTATION_PASS/,'FINAL_PRODUCTION_BLOCK'],
  [/node car02-r95-restore-drift-qa\.mjs/,'ROLLBACK_PROBES']
 ];
 for(const [rx,label] of required)if(!rx.test(yaml))throw Error('R95_MISSING_'+label);
 const steps=[...yaml.matchAll(/^\s{6}- name: (.+)$/gm)].map(m=>m[1].trim());
 if(JSON.stringify(steps)!==JSON.stringify(EXPECTED_R95_STEPS))throw Error('R95_STEP_ALLOWLIST_CHANGED');
 const denied=[/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,
  /\bcontents:\s*write\b/i,/\bworkflow_call\s*:/i,/^\s*push:\s*$/m,
  /^\s*pull_request:\s*$/m,/\bcurl\s+/i,/\bwget\s+/i,/\bgh\s+(?:api|auth|workflow|release)\b/i,
  /\b(aws|gcloud|az)\s+/i,/\bdeploy(?:ment)?\s+--/i];
 for(const rx of denied)if(rx.test(yaml))throw Error('R95_UNSAFE_WORKFLOW_'+rx.source);
 const names=[...yaml.matchAll(/\bcar02_[a-z0-9_]+\b/g)].map(x=>x[0]);
 for(const name of names)if(!['car02_r93q_qa','car02_r93q_qa_ci','car02_r94b_restore_ci'].includes(name))
  throw Error('R95_UNEXPECTED_DB_'+name);
 return Object.freeze({ok:true,steps:steps.length,environment:'disposable_pg17',release:'NO_GO',migration:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 console.log('R95_WORKFLOW_READONLY_GUARD_PASS',JSON.stringify(verifyR95Workflow(readFileSync(FILE,'utf8'))));
}

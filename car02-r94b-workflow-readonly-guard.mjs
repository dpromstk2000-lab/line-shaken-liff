// R94B repository-only workflow guard: can be executed offline before dispatch.
import {readFileSync} from 'node:fs';
const FILE='.github/workflows/car02-r94b-disposable-backup-restore-qa.yml';
export const EXPECTED_STEPS=Object.freeze([
 'Checkout read-only approved sources',
 'Confirm release lock and GitHub source baseline',
 'Offline syntax and negative security tests',
 'Install isolated Node PostgreSQL test driver',
 'Create source fixture inside disposable PostgreSQL 17',
 'Seed realistic staging photo and cleanup lifecycle',
 'Backup source database with container native pg_dump',
 'Restore into distinct empty disposable database',
 'Verify data, constraints, immutable receipts and outbox after restore',
 'Remove disposable source, restored DB and dump',
 'Final immutable read-only release gate'
]);
export function verifyR94BWorkflow(yaml){
 if(typeof yaml!=='string'||yaml.length<3000)throw Error('R94B_WORKFLOW_MISSING');
 const requireText=(expr,label)=>{if(!expr.test(yaml))throw Error('R94B_MISSING_'+label);};
 requireText(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY');
 requireText(/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY_PERMISSIONS');
 requireText(/image: postgres:17/,'PG17_SERVICE');
 requireText(/CAR02_RELEASE_LOCK=true/,'HARD_LOCK');
 requireText(/R94B_RELEASE_NO_GO_HOLD_PASS/,'NO_GO_HOLD');
 requireText(/pg_dump -U postgres -d car02_r93q_qa_ci/,'DISPOSABLE_DUMP');
 requireText(/pg_restore -U postgres -d car02_r94b_restore_ci/,'DISTINCT_RESTORE');
 requireText(/--exit-on-error --single-transaction/,'ATOMIC_RESTORE');
 requireText(/R94B_DISPOSABLE_BACKUP_RESTORE_VERIFIED_PASS/,'RESTORE_VERIFICATION');
 requireText(/R94B_DISPOSABLE_DBS_REMOVED/,'DB_CLEANUP');
 requireText(/rm -f \/tmp\/car02-r94b-disposable.dump/,'DUMP_CLEANUP');
 requireText(/if: always\(\)/,'ALWAYS_CLEANUP');
 const steps=[...yaml.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1].trim());
 if(JSON.stringify(steps)!==JSON.stringify(EXPECTED_STEPS))throw Error('R94B_STEP_ALLOWLIST_CHANGED');
 const denied=[/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,/\bdeploy(?:ment)?\s+--/i,/\bgh\s+(?:api|auth|workflow|release)\b/i,/\bcontents:\s*write\b/i,/\bworkflow_call\s*:/i,/\bpush:\s*$/m,/\bpull_request:\s*$/m,/\bcurl\s+/i,/\bwget\s+/i,/\bfetch\s*\(/i,/\b(aws|gcloud|az)\s+/i];
 for(const exp of denied)if(exp.test(yaml))throw Error('R94B_UNSAFE_WORKFLOW_'+exp.source);
 const dbNames=[...yaml.matchAll(/\bcar02_[a-z0-9_]+\b/g)].map(x=>x[0]);
 const allowed=new Set(['car02_r93q_qa_ci','car02_r94b_restore_ci','car02_r93q_qa']);
 for(const name of dbNames)if(!allowed.has(name))throw Error('R94B_UNEXPECTED_DB_'+name);
 if(!/\bR94B_NO_PRODUCTION_MUTATION_PASS\b/.test(yaml))throw Error('R94B_NO_FINAL_GATE');
 return Object.freeze({ok:true,steps:steps.length,disposableOnly:true,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]?.endsWith('car02-r94b-workflow-readonly-guard.mjs')){
 const result=verifyR94BWorkflow(readFileSync(FILE,'utf8'));
 console.log('R94B_WORKFLOW_READONLY_GUARD_PASS',JSON.stringify(result));
}

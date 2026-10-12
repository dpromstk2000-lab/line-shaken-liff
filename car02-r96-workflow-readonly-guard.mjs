// R96 offline workflow allowlist: performs no networking, uses no secrets.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const R96_WORKFLOW='.github/workflows/car02-r96-backup-corruption-recovery-qa.yml';
export const R96_EXPECTED_STEPS=Object.freeze([
 'Checkout read-only approved sources',
 'Confirm release lock and GitHub source baseline',
 'Offline syntax and security regression tests',
 'Install isolated Node PostgreSQL test driver',
 'Create source fixture inside disposable PostgreSQL 17',
 'Seed realistic staging photo and cleanup lifecycle',
 'Backup source database with container native pg_dump',
 'Restore into distinct empty disposable database',
 'Verify data, constraints, immutable receipts and outbox after restore',
 'R95 rollback-only restore drift challenge',
 'R96 reject corrupted archives and recover into isolated target',
 'Remove all disposable DBs and dumps',
 'Final immutable read-only release gate',
]);
export function verifyR96Workflow(yaml){
 if(typeof yaml!=='string'||yaml.length<6500)throw Error('R96_WORKFLOW_MISSING');
 const requireToken=(re,label)=>{if(!re.test(yaml))throw Error('R96_MISSING_'+label);};
 requireToken(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY');
 requireToken(/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY_PERMISSIONS');
 requireToken(/image: postgres:17/,'PG17_SERVICE');
 requireToken(/CAR02_RELEASE_LOCK=true/,'LOCK');
 requireToken(/R94B_RELEASE_NO_GO_HOLD_PASS/,'NO_GO_HOLD');
 requireToken(/--exit-on-error --single-transaction --no-owner/,'ATOMIC_RESTORE');
 requireToken(/R95_RESTORE_DRIFT_4_4_PASS/,'R95_GUARD');
 requireToken(/R96_CORRUPT_RESTORE_ATOMIC_EMPTY_PASS/,'CORRUPTION_GUARD');
 requireToken(/R96_RECOVERED_DB_MATCHES_SOURCE_PASS/,'RECOVERY_GUARD');
 requireToken(/R96_DOUBLE_RESTORE_ATOMIC_ROLLBACK_PASS/,'REPLAY_GUARD');
 requireToken(/if: always\(\)/,'CLEANUP_ALWAYS');
 requireToken(/DROP DATABASE IF EXISTS car02_r96_failure_ci/,'THIRD_DB_CLEANUP');
 requireToken(/DROP DATABASE IF EXISTS car02_r94b_restore_ci/,'RESTORED_CLEANUP');
 requireToken(/DROP DATABASE IF EXISTS car02_r93q_qa_ci/,'SOURCE_CLEANUP');
 requireToken(/R96_DISPOSABLE_DBS_REMOVED/,'CLEANUP_VERIFIED');
 requireToken(/rm -f \/tmp\/car02-r96-.*\.dump/,'CORRUPT_ARCHIVE_CLEANUP');
 requireToken(/R94B_NO_PRODUCTION_MUTATION_PASS/,'FINAL_GATE');
 const steps=[...yaml.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1].trim());
 if(JSON.stringify(steps)!==JSON.stringify(R96_EXPECTED_STEPS))throw Error('R96_STEPS_ALLOWLIST');
 const denied=[/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,/\bgh\s+(?:api|auth|workflow|release)\b/i,
  /\bcontents:\s*write\b/i,/^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,/\bcurl\s+/i,/\bwget\s+/i,/(?:aws|gcloud|az)\s+/i,
  /\b(?:deploy|release)\s+--/i,/\bworkflow_call\s*:/i,/\bhttps?:\/\//i];
 for(const re of denied)if(re.test(yaml))throw Error('R96_UNSAFE_WORKFLOW_'+re.source);
 const found=[...yaml.matchAll(/\bcar02_[a-z0-9_]+\b/g)].map(m=>m[0]);
 const allowed=new Set(['car02_r93q_qa_ci','car02_r94b_restore_ci','car02_r96_failure_ci','car02_r93q_qa']);
 for(const value of found)if(!allowed.has(value))throw Error('R96_DB_NAME_DENIED_'+value);
 return Object.freeze({ok:true,steps:steps.length,databases:3,release:'NO_GO',migration:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 console.log('R96_WORKFLOW_READONLY_GUARD_PASS',JSON.stringify(verifyR96Workflow(readFileSync(R96_WORKFLOW,'utf8'))));
}

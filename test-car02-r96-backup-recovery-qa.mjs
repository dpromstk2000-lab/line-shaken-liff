import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SOURCE,RESTORE,R95_ENV} from './car02-r95-restore-drift-qa.mjs';
import {FAILURE,R96_MODES,R96_DB_ALLOWLIST,assertR96Environment,
 assertR96EmptyTarget,assertR96SnapshotsEqual} from './car02-r96-backup-recovery-qa.mjs';
import {R96_EXPECTED_STEPS,verifyR96Workflow} from './car02-r96-workflow-readonly-guard.mjs';
const impl=readFileSync('car02-r96-backup-recovery-qa.mjs','utf8');
const yaml=readFileSync('.github/workflows/car02-r96-backup-corruption-recovery-qa.yml','utf8');
const env={...R95_ENV};
const empty={db:FAILURE,pg:170004,no_live:true,schema_absent:true,table_absent:true};

test('R96 enforces exact source/restore/failure database allowlist',()=>{
 assert.deepEqual(R96_DB_ALLOWLIST,[SOURCE,RESTORE,'car02_r96_failure_ci']);
 assert.match(impl,/R96_DB_ALLOWLIST\.includes\(name\)/);
});
test('R96 accepts only three named test modes and fixed disposable environment',()=>{
 for(const mode of R96_MODES)assert.doesNotThrow(()=>assertR96Environment(env,mode));
 for(const mode of ['production','',undefined,'seed'])assert.throws(()=>assertR96Environment(env,mode));
});
test('R96 rejects environment drift in every sensitive field',()=>{
 for(const key of Object.keys(env))assert.throws(()=>assertR96Environment({...env,[key]:'something-else'},'baseline'));
});
test('R96 rejects empty database when fixture schema remains',()=>{
 assert.doesNotThrow(()=>assertR96EmptyTarget(empty));
 assert.throws(()=>assertR96EmptyTarget({...empty,schema_absent:false}));
});
test('R96 rejects empty database when failed restore leaves table',()=>{
 assert.throws(()=>assertR96EmptyTarget({...empty,table_absent:false}));
});
test('R96 rejects empty database when wrong DB or version is supplied',()=>{
 assert.throws(()=>assertR96EmptyTarget({...empty,db:SOURCE}));
 for(const pg of [150000,160004,180001,null,'170004'])assert.throws(()=>assertR96EmptyTarget({...empty,pg}));
});
test('R96 refuses potential public live table in third DB',()=>{
 assert.throws(()=>assertR96EmptyTarget({...empty,no_live:false}));
});
test('R96 cross-DB snapshots match semantically',()=>{
 const state={tables:{photos:[{id:1}]},acls:[{grantee:'postgres'}]};
 assert.equal(typeof assertR96SnapshotsEqual(state,structuredClone(state),structuredClone(state)),'string');
 assert.throws(()=>assertR96SnapshotsEqual(state,{tables:{photos:[]}}));
 assert.throws(()=>assertR96SnapshotsEqual(state,state,{...state,acls:[]}));
});
test('R96 requires custom archive valid original, corrupted magic and header truncation',()=>{
 assert.match(yaml,/pg_dump -U postgres -d car02_r93q_qa_ci --format=custom --no-owner/);
 assert.match(yaml,/printf 'BAD!' \| dd of=\/tmp\/car02-r96-corrupt\.dump/);
 assert.match(yaml,/head -c 32 \/tmp\/car02-r94b-disposable\.dump > \/tmp\/car02-r96-truncated\.dump/);
 assert.match(yaml,/test "\$\(wc -c < \/tmp\/car02-r96-truncated\.dump\)" -eq 32/);
});
test('R96 rejects corrupt archive via both TOC and restore, then requires empty target',()=>{
 assert.match(yaml,/pg_restore -U postgres --list < "\$archive"/);
 assert.match(yaml,/pg_restore -U postgres -d car02_r96_failure_ci --exit-on-error --single-transaction --no-owner < "\$archive"/);
 assert.match(yaml,/R96_CORRUPT_RESTORE_ATOMIC_EMPTY_PASS/);
 assert.match(yaml,/R96_CORRUPT_2_2_REJECTED/);
});
test('R96 demands healthy restore then rejects second attempt with no partial damage',()=>{
 assert.match(yaml,/node car02-r96-backup-recovery-qa\.mjs recovered \| tee/);
 assert.match(yaml,/R96_DOUBLE_RESTORE_ATOMIC_ROLLBACK_PASS/);
 assert.match(yaml,/R96_RECOVERED_DB_MATCHES_SOURCE_PASS/);
});
test('R96 uses GitHub Actions with read-only permissions, no production secrets',()=>{
 assert.match(yaml,/permissions:\n  contents: read/);
 assert.doesNotMatch(yaml,/\$\{\{\s*secrets\./i);
 assert.doesNotMatch(yaml,/\bwrangler\b/i);
 assert.deepEqual(verifyR96Workflow(yaml),{ok:true,steps:13,databases:3,release:'NO_GO',migration:'HOLD'});
});
test('R96 guard disallows changing release lock or triggering via pushes',()=>{
 assert.throws(()=>verifyR96Workflow(yaml.replace('const CAR02_RELEASE_LOCK=true','const CAR02_RELEASE_LOCK=false')));
 assert.throws(()=>verifyR96Workflow(yaml.replace('  workflow_dispatch:','  push:')));
});
test('R96 guard disallows production command injection and extra steps',()=>{
 for(const injection of ['      - name: Deploy Worker\n','      - name: Foo\n        run: wrangler deploy\n',
  '      - name: leak\n        run: curl https://example.invalid\n',
  '      - name: forbidden\n        env:\n          KEY: ${{ secrets.MAIN_KEY }}\n']){
   assert.throws(()=>verifyR96Workflow(yaml+'\n'+injection));
  }
});
test('R96 enforces cleanup of 3 databases and all temporary dumps',()=>{
 assert.match(yaml,/if: always\(\)/);
 for(const name of R96_DB_ALLOWLIST)assert.ok(yaml.includes(`DROP DATABASE IF EXISTS ${name}`));
 assert.match(yaml,/R96_DISPOSABLE_DBS_REMOVED/);
 assert.match(yaml,/rm -f \/tmp\/car02-r96-\*\.dump/);
});
test('R96 guard rejects unexpected db names and removed cleanup',()=>{
 assert.throws(()=>verifyR96Workflow(yaml.replace('DROP DATABASE IF EXISTS car02_r96_failure_ci','DROP DATABASE IF EXISTS other_ci')));
 assert.throws(()=>verifyR96Workflow(yaml.replace('if: always()','if: success()')));
 assert.throws(()=>verifyR96Workflow(yaml.replace('image: postgres:17','image: postgres:16')));
});
test('R96 workflow retains R94B source and R95 drift safety gates',()=>{
 assert.match(yaml,/R94B_DISPOSABLE_BACKUP_RESTORE_VERIFIED_PASS/);
 assert.match(yaml,/R95_RESTORE_DRIFT_4_4_PASS/);
 assert.match(yaml,/R94B_RELEASE_NO_GO_HOLD_PASS/);
 assert.match(yaml,/node car02-r93t-release-preflight\.mjs/);
 assert.match(yaml,/node car02-r96-workflow-readonly-guard\.mjs/);
});
test('R96 unexpected return or extra step rejected by exact step allowlist',()=>{
 assert.equal(R96_EXPECTED_STEPS.length,13);
 assert.throws(()=>verifyR96Workflow(yaml.replace('Final immutable read-only release gate','Final unchecked gate')));
});

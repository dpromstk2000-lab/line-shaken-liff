import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyR95Workflow} from './car02-r95-workflow-readonly-guard.mjs';
import {R95_ENV,R95_PROBES,assertR95DisposableEnvironment,assertR95SnapshotMatch}
 from './car02-r95-restore-drift-qa.mjs';
const implementation=readFileSync('car02-r95-restore-drift-qa.mjs','utf8');
const yaml=readFileSync('.github/workflows/car02-r95-restore-drift-qa.yml','utf8');
const current=readFileSync('test-car02-r94b-backup-restore-contract.mjs','utf8');

test('R95 fail-closed on every wrong PostgreSQL connection environment value',()=>{
 assert.doesNotThrow(()=>assertR95DisposableEnvironment({...R95_ENV}));
 for(const [key,value] of Object.entries(R95_ENV))
  assert.throws(()=>assertR95DisposableEnvironment({...R95_ENV,[key]:value+'!'}),new RegExp(`R95_ENV_DENIED_${key}`));
});
test('R95 source and restored fixture are strictly two isolated databases',()=>{
 assert.match(implementation,/\[SOURCE,RESTORE\]\.includes\(db\)/);
 assert.match(implementation,/R95_PG17_ONLY/);
 assert.match(implementation,/R95_LIVE_TABLE_DETECTED/);
 assert.match(implementation,/R95_NO_ISOLATED_FIXTURE/);
});
test('R95 fingerprint detects data mismatch',()=>{
 assert.throws(()=>assertR95SnapshotMatch({staff:['active']},{staff:['inactive']},'STAFF_DATA_CHANGE'),/R95_DRIFT_STAFF_DATA_CHANGE/);
});
test('R95 fingerprint detects ACL and owner mismatch',()=>{
 assert.throws(()=>assertR95SnapshotMatch({schemaAcls:[{grantee:'postgres'}]},{schemaAcls:[{grantee:'PUBLIC'}]},'ACL'),/R95_DRIFT_ACL/);
 assert.throws(()=>assertR95SnapshotMatch({relations:[{owner:'postgres'}]},{relations:[{owner:'other'}]},'OWNER'),/R95_DRIFT_OWNER/);
});
test('R95 fingerprint detects trigger, RLS and indexes changes',()=>{
 for(const [name,x,y] of [['TRIGGER','O','D'],['RLS',false,true],['INDEX','unique','nonunique']]){
  assert.throws(()=>assertR95SnapshotMatch({v:x},{v:y},name),new RegExp(`R95_DRIFT_${name}`));
 }
});
test('R95 data, triggers, functions, constraints, indexes, table ACLs, schema ACLs all fingerprinted',()=>{
 for(const part of ['tables,relations,indexes,constraints,triggers,functions,tableAcls,schemaAcls',
  'pg_get_constraintdef','pg_get_triggerdef','pg_get_functiondef','aclexplode',
  'relrowsecurity','relforcerowsecurity','upload_intents','cleanup_jobs'])
  assert.ok(implementation.includes(part),part);
});
test('R95 at least 4 independent transactional corruption probes',()=>{
 assert.deepEqual(R95_PROBES.map(p=>p.name),[
  'STAFF_DATA_CHANGE','TRIGGER_DISABLED','PUBLIC_SCHEMA_USAGE','RLS_POLICY_DRIFT']);
 for(const {sql} of R95_PROBES)assert.match(sql,/^(UPDATE|ALTER|GRANT) /);
});
test('R95 all corrupted state is rolled back and checked after each probe',()=>{
 for(const token of ["await client.query('BEGIN')","await client.query('ROLLBACK')",
  'R95_DRIFT_NOT_DETECTED_', 'ROLLBACK_${name}', 'SOURCE_IMMUTABILITY', 'RESTORE_IMMUTABILITY'])
  assert.ok(implementation.includes(token),token);
 assert.doesNotMatch(implementation,/client\.query\('COMMIT'\)/);
});
test('R95 GH Actions manual-only read-only, no secrets or deployment',()=>{
 assert.match(yaml,/^on:\s*\n\s+workflow_dispatch:\s*$/m);
 assert.match(yaml,/^permissions:\s*\n\s+contents: read\s*$/m);
 assert.match(yaml,/image: postgres:17/);
 assert.match(yaml,/CAR02_RELEASE_LOCK=true/);
 assert.match(yaml,/R94B_RELEASE_NO_GO_HOLD_PASS/);
 for(const denied of [/\$\{\{\s*secrets\./i,/\bwrangler\b/i,/\bnpx\s+supabase\b/i,
  /^\s*push:/m,/^\s*pull_request:/m,/\bcontents:\s*write/i,/\bcurl\s+/i,/\bwget\s+/i])
  assert.doesNotMatch(yaml,denied);
});
test('R95 uses disposable backup and restore with guaranteed cleanup',()=>{
 for(const token of ['pg_dump -U postgres -d car02_r93q_qa_ci',
  'pg_restore -U postgres -d car02_r94b_restore_ci',
  'DROP DATABASE IF EXISTS car02_r93q_qa_ci',
  'DROP DATABASE IF EXISTS car02_r94b_restore_ci',
  'if: always()', 'R95_RESTORE_DRIFT_4_4_PASS',
  'R94B_DISPOSABLE_BACKUP_RESTORE_VERIFIED_PASS'])
  assert.ok(yaml.includes(token),token);
});
test('R95 test bundle includes improved R94B one-row ACL regressions',()=>{
 for(const token of ['R94B_OWNER_USAGE_MISSING','R94B_OWNER_CREATE_MISSING','R94B_ACL_EMPTY_OR_MISSING'])
  assert.ok(current.includes(token),token);
});

test('R95 frozen workflow guard rejects unexpected job steps and write permissions',()=>{
 assert.equal(verifyR95Workflow(yaml).steps,12);
 assert.throws(()=>verifyR95Workflow(yaml.replace('contents: read','contents: write')));
 assert.throws(()=>verifyR95Workflow(yaml.replace('image: postgres:17','image: postgres:16')));
 assert.throws(()=>verifyR95Workflow(yaml.replace('  workflow_dispatch:','  push:')));
 assert.throws(()=>verifyR95Workflow(yaml.replace('Final immutable read-only release gate','Production deploy')));
 assert.throws(()=>verifyR95Workflow(yaml+'\n      - name: malicious\n'));
});

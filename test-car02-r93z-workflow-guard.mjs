import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditR93ZWorkflow,WORKFLOW} from './car02-r93z-workflow-readonly-guard.mjs';
const source=readFileSync(WORKFLOW,'utf8');
test('R93Z workflow current locked isolated configuration accepted',()=>{
 assert.deepEqual(auditR93ZWorkflow(source),{ok:true,release:'NO_GO',migration:'HOLD',productionWrites:false,pg17Disposable:true});
});
for(const [name,needle,replacement] of [
 ['deploy injected','      - name: Create disposable PostgreSQL 17 test database','      - name: wrangler deploy\\n        run: true\\n      - name: Create disposable PostgreSQL 17 test database'],
 ['secret injection','      - name: Create disposable PostgreSQL 17 test database',"      - name: secrets.R93Z_TOKEN\\n        run: true\\n      - name: Create disposable PostgreSQL 17 test database"],
 ['write permission','contents: read','contents: write'],
 ['external network','      - name: Create disposable PostgreSQL 17 test database','      - name: curl https://outside.invalid\\n        run: true\\n      - name: Create disposable PostgreSQL 17 test database'],
 ['different database','PGDATABASE: car02_r93q_qa_ci','PGDATABASE: production'],
 ['different PG image','image: postgres:17','image: postgres:16'],
 ['unknown action','actions/checkout@v5','actions/checkout@v4'],
 ['trigger change','workflow_dispatch:','push:'],
 ['extra last step','R93Z_READONLY_GUARD_PASS','R93Z_READONLY_GUARD_PASS\\n      - name: trailing dangerous step'],
 ])test('R93Z workflow rejects '+name,()=>{
 assert.ok(source.includes(needle),name);
 const changed=source.replace(needle,replacement.replaceAll('\\n','\n'));
 assert.throws(()=>auditR93ZWorkflow(changed),name);
});

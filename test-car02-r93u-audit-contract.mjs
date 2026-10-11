import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R93U_CONTRACT} from './car02-r93u-staging-upload-route-isolated.mjs';
test('R93U cannot authorize production release or DB migration',()=>{
 assert.deepEqual([R93U_CONTRACT.productionReady,R93U_CONTRACT.deployAuthorized,
  R93U_CONTRACT.r52HardLockUnchanged,R93U_CONTRACT.r82DurableIntentNotYetWired],
 [false,false,true,true]);
});
test('module never reads secrets or imports R50/R52 live composition',()=>{
 const s=readFileSync('car02-r93u-staging-upload-route-isolated.mjs','utf8');
 assert.doesNotMatch(s,/\bDeno\.env\.get\s*\(|\bprocess\.env\s*\[|\bfetch\s*\(/);
 assert.doesNotMatch(s,/^import .*car02-(?:unified-runtime-r50|edge-entry-r52)/m);
});
test('module only routes normalized staging endpoints, never legacy reservation or LINE',()=>{
 const s=readFileSync('car02-r93u-staging-upload-route-isolated.mjs','utf8');
 assert.ok(s.includes("const NAME='dpro-car02-stage'"));
 assert.ok(s.includes('const BUSINESS_MAX=32768'));
 assert.ok(s.includes('const UPLOAD_MAX=5*1024*1024'));
 assert.equal(R93U_CONTRACT.notProductionRouter,true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const text=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
test('R52 stage entry is permanently locked, no env override',()=>{
  assert.match(text,/const CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
  assert.match(text,/isServerReleased:\s*\(\)\s*=>\s*!CAR02_RELEASE_LOCK/);
  assert.doesNotMatch(text,/getenv\(['"]CAR02_(?:LIVE|RELEASE|ENABLE)/);
});
test('R52 stage entry references only isolated CAR02 modules',()=>{
  assert.match(text,/createCar02EdgeBoundaryR51/);
  assert.match(text,/createCar02UnifiedRuntimeR50/);
  assert.doesNotMatch(text,/ksh-line-demo-api\.workers\.dev|api\/reservations/);
});

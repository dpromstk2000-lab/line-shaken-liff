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


test('R52 FIX1 cold start does not eagerly load npm pg or its USER env defaults',()=>{
  assert.doesNotMatch(text,/^import\s+(?!type\b).*npm:pg@/m);
  assert.doesNotMatch(text,/^import\s+\{createCar02UnifiedRuntimeR50\}/m);
  const lock=text.indexOf("if(CAR02_RELEASE_LOCK)throw Error('CAR02_NOT_RELEASED')");
  const pgImport=text.indexOf("import('npm:pg@8.16.3')");
  const unifiedImport=text.indexOf("import('./car02-unified-runtime-r50.mjs')");
  assert.ok(lock>0 && pgImport>lock && unifiedImport>lock);
  assert.match(text,/const pool=new pg\.Pool\(/);
});

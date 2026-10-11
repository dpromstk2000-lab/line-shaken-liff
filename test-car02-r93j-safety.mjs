import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R93J_CONTRACT,R93J_QA_TOKENS} from './car02-r93j-http-memory-pipeline-isolated.mjs';
const code=readFileSync('car02-r93j-http-memory-pipeline-isolated.mjs','utf8');
const requireText=['createCar02PhotoUploadHttpR82','createR93IIsolatedR47SafeBridge','environment:\'isolated_qa\'','liveWiring:false','dbAccess:false','networkAccess:false','migrationDecision:\'HOLD\''];
for(const str of requireText)test('isolated composition contains '+str,()=>assert.ok(code.includes(str)));
for(const expr of [/\bfetch\s*\(/,/\bWebSocket\s*\(/,/\bXMLHttpRequest\b/,/\bprocess\.env\b/,/\bhttps?:\/\/[^'\s]*supabase\b/i])
 test('isolated composition has no remote code '+String(expr),()=>assert.equal(expr.test(code),false));
test('fake QA tokens never resemble a production secret',()=>{assert.match(R93J_QA_TOKENS.staff,/^R93J-FAKE-/);assert.match(R93J_QA_TOKENS.owner,/^R93J-FAKE-/)});
test('R93J preserves closed release gates',()=>{assert.equal(R93J_CONTRACT.productionReady,false);assert.equal(R93J_CONTRACT.releaseDecision,'NO_GO');assert.equal(R93J_CONTRACT.migrationDecision,'HOLD')});

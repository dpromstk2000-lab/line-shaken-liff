import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {R121_CONTRACT} from './car02-r121-photo-failclosed-isolated.mjs';
const module=fs.readFileSync('car02-r121-photo-failclosed-isolated.mjs','utf8');
const yaml=fs.readFileSync('.github/workflows/car02-r121-photo-failclosed-isolated-qa.yml','utf8');
test('nonproduction contract never claims authorization',()=>{
 assert.equal(R121_CONTRACT.productionReady,false);
 assert.equal(R121_CONTRACT.releaseDecision,'NO_GO');
 assert.equal(R121_CONTRACT.migrationDecision,'HOLD');
 assert.equal(R121_CONTRACT.realSupabaseTested,false);
 assert.equal(R121_CONTRACT.durablePostgresTested,false);
 assert.equal(R121_CONTRACT.replacesExistingProductionR47,false);
});
test('isolated adapter accepts no production URL/key and contains no direct network or deletion',()=>{
 assert.doesNotMatch(module,/(?:\bfetch\s*\(|\bhttps?\s*:\/\/|\bprocess\.env\.|\bDELETE\b\s*[,)]|\.remove\s*\(|\.deleteObject\s*\(|\bwrangler\b)/i);
 assert.match(module,/typeof storage\?\.putOnce/);
 assert.match(module,/typeof storage\?\.readBack/);
 assert.match(module,/typeof ledger\?\.quarantine/);
 assert.match(module,/existing===true/);
});
test('GitHub job cannot push or deploy and always holds release',()=>{
 assert.match(yaml,/permissions:\s*\n\s+contents: read/);
 assert.match(yaml,/workflow_dispatch:/);
 assert.match(yaml,/CAR02_RELEASE_LOCK: 'true'/);
 assert.match(yaml,/car02_r118_readonly_source_gate\.py --strict/);
 assert.doesNotMatch(yaml,/(wrangler\s+deploy|supabase\s+db\s+push|push:\s*\n|deploy-pages|cloudflare\/workers|checkout@v\d+\s*\n\s*with:\s*\n\s*persist-credentials: true)/i);
});

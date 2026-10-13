import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {R123_CONTRACT} from './car02-r123-photo-review-offline.mjs';
const src=fs.readFileSync('car02-r123-photo-review-offline.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/car02-r123-photo-review-offline-qa.yml','utf8');
test('NO_GO and HOLD are immutable constants',()=>{
 assert.equal(R123_CONTRACT.release,'NO_GO');assert.equal(R123_CONTRACT.migration,'HOLD');
 assert.equal(R123_CONTRACT.productionReady,false);
});
test('candidate implements no network client',()=>assert.doesNotMatch(src,/\bfetch\s*\(|\bhttps?:\/\/|\bXMLHttpRequest\b|\bWebSocket\b|\bimport\s*\(\s*['"]https/i));
test('candidate implements no file mutation or database driver',()=>assert.doesNotMatch(src, /(?:from\s+['"]node:fs|\bpg\.Pool\b|\bpostgresql:\/\/|\bwriteFile\b|\bdeleteObject\s*\(|\bremoveObject\s*\()/i));
test('candidate implements no mutating ledger/storage API',()=>assert.doesNotMatch(src,/\bmarkReady\s*\(|\bdeletePhoto\s*\(|\bpromoteQuarantine\s*\(|\bexec\s*\(/i));
test('candidate not wired into existing R47/R50/R51/R52',()=>{
 assert.equal(R123_CONTRACT.doesNotWireR47,true);assert.equal(R123_CONTRACT.doesNotChangeR122,true);
});
test('offline review cannot claim real reviewer authentication',()=>{
 assert.equal(R123_CONTRACT.realAuthenticationTested,false);
 assert.equal(R123_CONTRACT.offlineReviewsAreNotCryptographicIdentities,true);
});
test('offline review cannot claim persistent anti-replay',()=>assert.equal(R123_CONTRACT.noPersistentReplayGuard,true));
test('workflow uses manual trigger and readonly permissions',()=>{
 assert.match(workflow,/workflow_dispatch:/);assert.match(workflow,/contents: read/);
 assert.doesNotMatch(workflow,/\bcontents:\s*write\b|\bpush:|\bpull_request:/);
});
test('workflow runs existing protected source gate',()=>assert.match(workflow,/car02_r118_readonly_source_gate.py\s+--strict/));
test('workflow is offline with no secrets or deployment step',()=>{
 assert.doesNotMatch(workflow,/\bwrangler\b|\bsupabase\b|\bdeploy\b|\bsecrets\./i);
 assert.match(workflow,/NO_GO/);assert.match(workflow,/HOLD/);
});
test('workflow repeats tests and checks exact pass counts',()=>{
 assert.match(workflow,/seq 1 3/);assert.match(workflow,/# pass 41/);
 assert.match(workflow,/# pass 11/);assert.match(workflow,/# fail 0/);
});

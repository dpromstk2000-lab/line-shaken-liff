import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyR114Workflow,R114_STEPS} from './car02-r114-workflow-guard.mjs';
const read=p=>readFileSync(p,'utf8');
const py=read('car02-r114-company-pc-roundtrip-qa.py');
const yml=read('.github/workflows/car02-r114-company-pc-roundtrip-qa.yml');
const limits=read('CAR02_R114_COMPANY_PC_QA_LIMITS.txt');

test('R114 keeps production NO_GO and manual QA only',()=>{
 const r=verifyR114Workflow(yml);assert.equal(r.ok,true);assert.equal(r.steps,7);
 assert.equal(r.productionReady,false);assert.equal(r.releaseDecision,'NO_GO');assert.equal(r.migrationDecision,'HOLD')
});
test('R114 workflow has exactly 7 known steps',()=>{
 assert.deepEqual([...yml.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1]),R114_STEPS)
});
test('R114 test uses strict allowlisted loopback HTTP sources',()=>{
 assert.match(py,/ThreadingHTTPServer\(\('127\.0\.0\.1', 0\)/);
 assert.match(py,/if path not in FILES:/);assert.match(py,/safe_route/);assert.match(py,/connect-src 'none'/)
});
test('R114 only exposes R90 R91 and their approved local modules',()=>{
 for(const name of ['CAR02_R90_COMPANY_PC_RECORD.html','CAR02_R91_COMPANY_PC_TRIAGE.html',
  'car02-staff-review-app-r90.mjs','car02-company-pc-record-r90.mjs',
  'car02-r89-acceptance-model.mjs','car02-r91-triage-app.mjs','car02-r91-triage-model.mjs',
  'car02-staff-review-model-r86.mjs'])assert.ok(py.includes("'/"+name+"'"),name);
 assert.match(py,/urlsplit/)
});
test('R114 never sends data to Supabase Worker or LINE',()=>{
 for(const str of [py,yml,limits])assert.doesNotMatch(str,/SUPABASE_SERVICE_ROLE_KEY|CAR02_DATABASE_URL|\.supabase\.co|(?:wrangler|supabase)\s+deploy|\bfetch\s*\(/i);
 assert.match(py,/forbidden\.append\(u\)/)
});
test('R114 exercises all 8 R90 safe checks and two distinct outcomes',()=>{
 assert.match(py,/select\[data-qa-id\]/);assert.match(py,/to_have_count\(8\)/);
 assert.match(py,/'ui_desktop': 'ok'/);assert.match(py,/'booking_calendar': 'issue'/)
});
test('R114 verifies real R90 JSON export and reimport',()=>{
 for(const key of ['#qaExport','#qaReset','#qaImportFile','DPRO_CAR02_R90_PC_SELF_CHECK_V1',
 'ISOLATED_UI_SELF_REPORT','downloaded.save_as'])assert.ok(py.includes(key),key)
});
test('R114 checks R91 JSON file import summary and TXT export',()=>{
 for(const key of ['#sourceFile','#issueCount','#pendingCount','#okCount','#totalCount',
 '#saveText','DPRO_CAR02_R91_COMPANY_PC_TRIAGE.txt'])assert.ok(py.includes(key),key)
});
test('R114 guards release and migration in both downloads',()=>{
 assert.match(py,/payload\['releaseDecision'\] == 'NO_GO'/);
 assert.match(py,/payload\['migrationDecision'\] == 'HOLD'/);
 assert.match(py,/payload\['productionReady'\] is False/);
 assert.match(py,/NO_GO.*HOLD/)
});
test('R114 rejects forged and oversized imported evidence',()=>{
 for(const key of ['forged.json','oversized.json','16385','R114_INVALID_IMPORT_REJECTED_PASS'])assert.ok(py.includes(key),key)
});
test('R114 independently checks desktop and mobile widths',()=>{
 assert.match(py,/'desktop', 1280, 840/);assert.match(py,/'mobile', 375, 800/);
 assert.match(py,/R114_\{name\.upper\(\)\}_ROUNDTRIP_PASS/)
});
test('R114 checks horizontal overflow and JavaScript errors',()=>{
 assert.match(py,/document\.documentElement\.scrollWidth <= window\.innerWidth\+1/);
 assert.match(py,/R114_BROWSER_JS_ERRORS/)
});
test('R114 stores only synthetic screenshots for 7 days even on failure',()=>{
 assert.match(yml,/r114-browser-evidence\/\*\.png/);
 assert.match(yml,/if: always\(\)/);assert.match(yml,/retention-days: 7/);
 assert.match(py,/name}_failure\.png/)
});
test('R114 workflow refuses push deployments secrets and hidden steps',()=>{
 for(const bad of [yml.replace('workflow_dispatch:','push:'),yml.replace('contents: read','contents: write'),
   yml+'\n# ${{ secrets.ADMIN }}',yml+'\n# wrangler deploy',
   yml.replace('if: always()','if: success()'),yml.replace('retention-days: 7','retention-days: 30'),
   yml.replace('R114_PRODUCTION_NO_GO_MIGRATION_HOLD','PRODUCTION_READY'),
   yml.replace('      - name: Confirm no deployment and retain NO_GO HOLD',
               '      - name: hidden action\n      - name: Confirm no deployment and retain NO_GO HOLD')])
    assert.throws(()=>verifyR114Workflow(bad))
});

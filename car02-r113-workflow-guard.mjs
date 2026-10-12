// DPRO CAR02 R113: read-only GitHub synthetic browser QA safety gate.
// No real Storage, live Supabase, LINE dispatch, DB migrations or Worker deployment.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const R113_STEPS=Object.freeze([
 'Checkout immutable reviewed sources',
 'Verify protected Git blobs and production HOLD',
 'Run R94B through R113 source regression',
 'Install disposable headless Chromium for QA',
 'Exercise real browser module interactions',
 'Preserve synthetic-only browser screenshots',
 'Confirm NO_GO HOLD and no deployment'
]);
export function verifyR113Workflow(yml){
 if(typeof yml!=='string'||yml.length<2900)throw Error('R113_WORKFLOW_MISSING');
 const req=(re,label)=>{if(!re.test(yml))throw Error('R113_GUARD_'+label)};
 req(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL_ONLY');
 req(/^permissions:\s*\n\s+contents: read\s*$/m,'READ_ONLY');
 req(/grep -Fxq '# tests (?:\d+)'/,'EXACT_TEST_COUNT');
 req(/\/tmp\/car02_r113_venv\/bin\/python -m playwright install --with-deps chromium/,'BROWSER_INSTALL');
 req(/playwright==1\.57\.0/,'BROWSER_VERSION_PIN');
 req(/\/tmp\/car02_r113_venv\/bin\/python car02-r113-browser-qa\.py --out r113-browser-evidence/,'REAL_HTTP_TEST');
 req(/R113_REAL_HTTP_MODULE_BROWSER_QA_PASS/,'REAL_MODULE_PROOF');
 req(/R113_DESKTOP_BROWSER_INTERACTION_PASS/,'DESKTOP_PROOF');
 req(/R113_MOBILE_BROWSER_INTERACTION_PASS/,'MOBILE_PROOF');
 req(/R113_NARROW_BROWSER_INTERACTION_PASS/,'NARROW_PROOF');
 req(/actions\/upload-artifact@v4/,'SCREENSHOT_ARTIFACT');
 req(/if: always\(\)/,'FAILURE_ARTIFACT');
 req(/retention-days: 7/,'ARTIFACT_RETENTION');
 req(/CAR02_R112_QUARANTINE_REVIEW_DEMO\.html/,'SOURCE_QA');
 req(/const CAR02_RELEASE_LOCK=true/,'LOCK');
 req(/R113_PRODUCTION_NO_GO_MIGRATION_HOLD/,'FINAL_HOLD');
 const actual=[...yml.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1]);
 if(JSON.stringify(actual)!==JSON.stringify(R113_STEPS))throw Error('R113_UNEXPECTED_STEPS');
 for(const re of [/\$\{\{\s*secrets\./i,/\bcontents:\s*write\b/i,/^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,/\b(?:wrangler deploy|supabase db push|supabase functions deploy)\b/i,/\bSERVICE_ROLE_KEY\b/i,/\b(?:storage\/v1|\.supabase\.co)\b/i,/\b(?:curl|wget)\s+/i,/--embedded/]){
  if(re.test(yml))throw Error('R113_FORBIDDEN_'+re.source);
 }
 return Object.freeze({ok:true,manualOnly:true,steps:actual.length,realBrowserOnly:true,
  productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
 console.log('R113_WORKFLOW_READONLY_GUARD_PASS',JSON.stringify(verifyR113Workflow(readFileSync('.github/workflows/car02-r113-real-browser-qa.yml','utf8'))));

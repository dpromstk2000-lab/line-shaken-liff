// CAR02 R114: read-only evidence of R90->R91 synthetic export-import browser QA.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const R114_STEPS=Object.freeze([
  'Checkout reviewed sources',
  'Verify seven protected blobs and immutable release lock',
  'Run R94B through R114 offline regression',
  'Install headless Chromium for isolated workflow QA',
  'Exercise R90 export and R91 import in real browser',
  'Preserve synthetic screenshot evidence',
  'Confirm no deployment and retain NO_GO HOLD'
]);
export function verifyR114Workflow(yml){
 if(typeof yml!=='string'||yml.length<3600)throw Error('R114_WORKFLOW_MISSING');
 const require=(re,label)=>{if(!re.test(yml))throw Error('R114_GUARD_'+label)};
 require(/^on:\s*\n\s+workflow_dispatch:\s*$/m,'MANUAL');
 require(/^permissions:\s*\n\s+contents: read\s*$/m,'READONLY');
 require(/grep -Fxq '# tests 462'/,'TEST_COUNT');
 require(/playwright==1\.57\.0/,'PLAYWRIGHT_PIN');
 require(/python car02-r114-company-pc-roundtrip-qa\.py --out r114-browser-evidence/,'REAL_MODULE_QA');
 require(/R114_R90_R91_REAL_HTTP_MODULE_ROUNDTRIP_PASS/,'ROUNDTRIP_PROOF');
 require(/R114_DESKTOP_ROUNDTRIP_PASS/,'DESKTOP_PROOF');
 require(/R114_MOBILE_ROUNDTRIP_PASS/,'MOBILE_PROOF');
 require(/R114_NO_EXTERNAL_REQUESTS_PASS/,'NO_NETWORK');
 require(/R114_PRODUCTION_NO_GO_MIGRATION_HOLD/,'HOLD');
 require(/const CAR02_RELEASE_LOCK=true/,'LOCK');
 require(/actions\/upload-artifact@v4/,'ARTIFACT');
 require(/if: always\(\)/,'FAILURE_ARTIFACT');
 require(/retention-days: 7/,'TTL');
 const actual=[...yml.matchAll(/^\s{6}- name: (.+)$/gm)].map(x=>x[1]);
 if(JSON.stringify(actual)!==JSON.stringify(R114_STEPS))throw Error('R114_UNEXPECTED_STEPS');
 for(const re of [/\$\{\{\s*secrets\./i,/\bcontents:\s*write\b/i,/^\s+push:\s*$/m,/^\s+pull_request:\s*$/m,/\b(?:wrangler deploy|supabase db push|supabase functions deploy|git push)\b/i,/\bSERVICE_ROLE_KEY\b/i,/\.supabase\.co|storage\/v1/i,/\b(?:curl|wget)\s+/i]){
  if(re.test(yml))throw Error('R114_FORBIDDEN_'+re.source)
 }
 return Object.freeze({ok:true,manualOnly:true,steps:actual.length,productionReady:false,
   releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 console.log('R114_WORKFLOW_GUARD_PASS',JSON.stringify(verifyR114Workflow(readFileSync('.github/workflows/car02-r114-company-pc-roundtrip-qa.yml','utf8'))));
}

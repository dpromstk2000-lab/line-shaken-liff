/**
 * DPRO CAR02 / Existing UI compatibility preflight v1.9.
 * READ-ONLY, no production modules imported, no network/DB/Worker/LINE calls,
 * no customer data access. This is a compatibility guard, NOT a release approval.
 */
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const CAR02_PREFLIGHT_MODE=Object.freeze({readOnly:true,productionReady:false,release:'NO_GO',dbMigration:'HOLD',realIdentityVerified:false,realBookingApiWired:false});
export const REQUIRED=Object.freeze([
 'dashboard.html','owner-ipad.html','index.html','member.html',
 'car02-api.mjs','car02-edge-entry-r52.ts','car02-browser-client-r57.mjs',
 'car02-basic-booking-atomic-isolated.mjs','car02-basic-staff-booking-browser-isolated.mjs',
 'CAR02_BASIC_UNIFIED_OPERATIONS_ISOLATED_PREVIEW.html',
 'car02-basic-unified-operations-isolated.mjs'
]);
export const LEGACY_BASELINES=Object.freeze({
 'dashboard.html':'ec9b94bb3ff66b5d4ee91d70185e5a2425134420',
 'owner-ipad.html':'63394a03c3e34a2d18f0a49e21cd3773b2abe7f4',
 'index.html':'139eadda8400155035c29dde7406c1f56b7343c7',
 'member.html':'b2870a8e8a809e686f2fd11b76769f4e7e79a0e5',
 'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302',
 'car02-api.mjs':'e3216bf265bbb6fc6ac1c893334b76a2f429ccc1'
});
const issue=(id,state,meaning)=>Object.freeze({id,state,meaning});
const sha=(s)=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex');
const legacyApiPrefix=(s,x)=>new RegExp('\\bconst\\s+WORKER_API_BASE\\s*=\\s*CONTROL_ADAPTER_BASE\\s*\\+\\s*[\\x22\\x27]\\/'+x+'[\\x22\\x27]').test(s);
const includesOwnApi=(s)=>/\/(?:api\/car02|functions\/v1\/dpro-car02-stage)(?:\/|\b)/.test(s);
const illegalSecretName=(name)=>/^(?:SUPAbasepass\.txt|\.env(?:\..+)?|id_rsa|id_ed25519|.*(?:service[_-]?role|private[_-]?key).*(?:\.json|\.pem|\.key|\.txt))$/i.test(name)&&!/^(?:\.env\.example|\.env\.sample|\.env\.template)$/i.test(name);
export function auditSources(sourceMap,filePaths=Object.keys(sourceMap),{shaReference=LEGACY_BASELINES}={}){
 if(!sourceMap||typeof sourceMap!=='object')throw Error('CAR02_PREFLIGHT_SOURCES_REQUIRED');
 const checks=[];
 const get=(file)=>{const s=sourceMap[file];if(typeof s!=='string'||!s.length){checks.push(issue('SOURCE_MISSING_'+file,'BLOCK','Required source unavailable'));return ''}return s};
 const legacy=[['dashboard.html','wangan'],['owner-ipad.html','ksh'],['index.html','ksh'],['member.html','ksh']];
 for(const [name,tenantPath] of legacy){const s=get(name);
   if(s)checks.push(issue('LEGACY_ROUTE_'+name,legacyApiPrefix(s,tenantPath)&&!includesOwnApi(s)?'PASS':'BLOCK','Existing legacy API family must remain unchanged and must not silently call CAR02 R45'));
 }
 const r52=get('car02-edge-entry-r52.ts');
 if(r52)checks.push(issue('R52_HARD_RELEASE_LOCK',/\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(r52)?'PASS':'BLOCK','Hard release lock must remain true'));
 const r45=get('car02-api.mjs');
 if(r45)checks.push(issue('R45_API_SEPARATE',r45.includes('/api\\/car02')&&r45.includes('releaseEnabled')&&r45.includes('authenticate')?'PASS':'BLOCK','R45 must enforce both release and authentication before business actions'));
 const r57=get('car02-browser-client-r57.mjs');
 if(r57)checks.push(issue('R57_BROWSER_STARTS_CLOSED',r57.includes('connectionEnabled')&&r57.includes("CAR02_API_ORIGIN_INVALID")?'PASS':'BLOCK','Browser client must require an explicit connection flag and pinned URL'));
 const atomic=get('car02-basic-booking-atomic-isolated.mjs');
 if(atomic)checks.push(issue('BOOKING_ONLY_DISPOSABLE',atomic.includes('DISPOSABLE PostgreSQL 17 QA ONLY')&&atomic.includes('productionReady:false')?'PASS':'BLOCK','Synthetic booking provisioner must not be treated as a live endpoint'));
 const browser=get('car02-basic-staff-booking-browser-isolated.mjs');
 if(browser)checks.push(issue('STAFF_BROWSER_INVALID_HOST',browser.includes('.invalid/api/car02/booking')&&browser.includes('realEndpoint:false')?'PASS':'BLOCK','Synthetic browser transport must use reserved .invalid hostname'));
 const html=get('CAR02_BASIC_UNIFIED_OPERATIONS_ISOLATED_PREVIEW.html');
 if(html){
  const hasCsp=/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i.test(html)&&html.includes("connect-src 'none'")&&html.includes("script-src 'self'");
  checks.push(issue('UNIFIED_PREVIEW_NO_NETWORK',hasCsp?'PASS':'BLOCK','Isolated preview must forbid external network connections'));
  const noInline=!/<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script\s*>/i.test(html);
  const moduleScript=/<script\s+type=["']module["']\s+src=["']\.\/car02-basic-unified-operations-isolated\.mjs["']\s*>\s*<\/script>/i.test(html);
  checks.push(issue('UNIFIED_PREVIEW_EXTERNAL_SCRIPT',noInline&&moduleScript?'PASS':'BLOCK','Executable JavaScript must be external to preserve strict CSP'));
 }
 const unified=get('car02-basic-unified-operations-isolated.mjs');
 if(unified)checks.push(issue('UNIFIED_PREVIEW_SYNTHETIC_ONLY',unified.includes('car02-basic-flow-isolated.mjs')&&unified.includes('car02-basic-staff-booking-browser-isolated.mjs')?'PASS':'BLOCK','Demo must depend only on the approved isolated model and transport'));
 const riskyNames=filePaths.filter(p=>typeof p==='string').map(p=>p.split('/').at(-1)).filter(illegalSecretName);
 checks.push(issue('ROOT_TRACKED_SECRET_FILENAMES',riskyNames.length===0?'PASS':'BLOCK',riskyNames.length?'A file matching a secret filename pattern is present; do not print or read its contents':'No high-confidence private-key or secret-named file detected by filename-only check'));
 for(const [name,expected] of Object.entries(shaReference)){const s=sourceMap[name];if(s){let actual=sha(s);checks.push(issue('LEGACY_BASELINE_'+name,actual===expected?'PASS':'REVIEW','Source drift relative to last approved read-only snapshot; do not overwrite automatically'));}}
 const blockers=checks.filter(x=>x.state==='BLOCK');const review=checks.filter(x=>x.state==='REVIEW');
 return Object.freeze({service:'CAR02_EXISTING_UI_READONLY_PREFLIGHT',mode:CAR02_PREFLIGHT_MODE,
  summary:{pass:checks.filter(x=>x.state==='PASS').length,blockers:blockers.length,review:review.length},
  checks,connectivity:[
   {site:'legacy_owner',routeFamily:'/wangan/api/*',status:'LEGACY_ONLY'},
   {site:'legacy_ipad_customer',routeFamily:'/ksh/api/*',status:'LEGACY_ONLY'},
   {site:'car02_business',routeFamily:'/api/car02/*',status:'ISOLATED_STAGING_ONLY'},
   {site:'car02_booking',routeFamily:'/api/car02/booking',status:'DISPOSABLE_QA_ONLY'},
   {site:'unified_5_screen',routeFamily:'none',status:'BROWSER_SYNTHETIC_ONLY'}
  ], gates:{production:'NO_GO',databaseMigration:'HOLD',identity:'UNVERIFIED_REAL',legacyMigration:'NOT_AUTHORIZED',photoStorage:'OPEN'},
  disclaimer:'Static checks; does not prove live auth, RLS, Worker routing, Git history removal, or customer acceptance.'});
}
function listPaths(root,max=12000){let result=[];const ignore=new Set(['.git','node_modules','.next','dist','coverage']);function walk(dir){for(const item of readdirSync(dir,{withFileTypes:true})){if(ignore.has(item.name))continue;const abs=join(dir,item.name);if(item.isDirectory())walk(abs);else if(item.isFile()){result.push(relative(root,abs).replaceAll('\\','/'));if(result.length>max)throw Error('CAR02_PREFLIGHT_TOO_MANY_FILES')}}}walk(root);return result;}
export function runReadOnlyPreflight(root){root=resolve(root);const sources={};for(const file of REQUIRED){const p=join(root,file);if(existsSync(p))sources[file]=readFileSync(p,'utf8')}return auditSources(sources,listPaths(root))}
const isCLI=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isCLI){const args=process.argv.slice(2);if(args.some(s=>!['--json'].includes(s)))throw Error('CAR02_PREFLIGHT_UNSUPPORTED_ARG');
 const report=runReadOnlyPreflight(process.cwd());
 if(args.includes('--json'))console.log(JSON.stringify(report,null,2));else{
  console.log(`CAR02_READONLY_PREFLIGHT PASS=${report.summary.pass} BLOCK=${report.summary.blockers} REVIEW=${report.summary.review}`);
  for(const c of report.checks)console.log(`${c.state} ${c.id}`);
  console.log('NO_GO / DB HOLD; no live service invoked');
 }
 if(report.summary.blockers)process.exitCode=1;
}

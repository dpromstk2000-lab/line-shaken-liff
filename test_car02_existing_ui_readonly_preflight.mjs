import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditSources,REQUIRED,CAR02_PREFLIGHT_MODE,runReadOnlyPreflight} from './car02-existing-ui-readonly-preflight.mjs';

const legacy=p=>`<html><script>const CONTROL_ADAPTER_BASE='https://fixture.invalid/function';const WORKER_API_BASE = CONTROL_ADAPTER_BASE + '/${p}';const data='/api/dashboard';</script></html>`;
const fixtures=()=>({
 'dashboard.html':legacy('wangan'),
 'owner-ipad.html':legacy('ksh'),
 'index.html':legacy('ksh'),
 'member.html':legacy('ksh'),
 'car02-edge-entry-r52.ts':'const CAR02_RELEASE_LOCK=true;\nexport const go=()=>!CAR02_RELEASE_LOCK;',
 'car02-api.mjs':`function authenticate(){};function releaseEnabled(){};const matcher=/^\\/api\\/car02/;`,
 'car02-browser-client-r57.mjs':'const connectionEnabled=false; throw Error("CAR02_API_ORIGIN_INVALID");',
 'car02-basic-booking-atomic-isolated.mjs':'// DISPOSABLE PostgreSQL 17 QA ONLY\nexport const cfg={productionReady:false};',
 'car02-basic-staff-booking-browser-isolated.mjs':'const url="https://fixture.invalid/api/car02/booking";const qa={realEndpoint:false};',
 'CAR02_BASIC_UNIFIED_OPERATIONS_ISOLATED_PREVIEW.html':`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'none'"></head><body><script type="module" src="./car02-basic-unified-operations-isolated.mjs"></script></body></html>`,
 'car02-basic-unified-operations-isolated.mjs':`import './car02-basic-flow-isolated.mjs';import './car02-basic-staff-booking-browser-isolated.mjs';`
});
const check=(src,paths=Object.keys(src))=>auditSources(src,paths,{shaReference:{}});
const get=(r,id)=>r.checks.find(x=>x.id===id)?.state;
test('mode is read-only and NO_GO',()=>{assert.equal(CAR02_PREFLIGHT_MODE.readOnly,true);assert.equal(CAR02_PREFLIGHT_MODE.release,'NO_GO');assert.equal(CAR02_PREFLIGHT_MODE.dbMigration,'HOLD')});
test('manifest contains expected eleven sources',()=>assert.equal(REQUIRED.length,11));
test('healthy synthetic repo passes blockers',()=>assert.equal(check(fixtures()).summary.blockers,0));
test('owner dashboard is wangan, not ksh',()=>assert.equal(get(check(fixtures()),'LEGACY_ROUTE_dashboard.html'),'PASS'));
test('iPad is ksh',()=>assert.equal(get(check(fixtures()),'LEGACY_ROUTE_owner-ipad.html'),'PASS'));
test('customer home is ksh',()=>assert.equal(get(check(fixtures()),'LEGACY_ROUTE_index.html'),'PASS'));
test('member is ksh',()=>assert.equal(get(check(fixtures()),'LEGACY_ROUTE_member.html'),'PASS'));
test('legacy owner cross-wiring is blocked',()=>{const s=fixtures();s['dashboard.html']=legacy('ksh');assert.equal(get(check(s),'LEGACY_ROUTE_dashboard.html'),'BLOCK')});
test('legacy iPad cross-wiring is blocked',()=>{const s=fixtures();s['owner-ipad.html']=legacy('wangan');assert.equal(get(check(s),'LEGACY_ROUTE_owner-ipad.html'),'BLOCK')});
test('legacy route silently importing CAR02 fails',()=>{const s=fixtures();s['dashboard.html']+='\nconst x="/api/car02"';assert.equal(get(check(s),'LEGACY_ROUTE_dashboard.html'),'BLOCK')});
test('missing legacy page is blocked, not silently assumed',()=>{const s=fixtures();delete s['index.html'];assert.equal(get(check(s),'SOURCE_MISSING_index.html'),'BLOCK')});
test('releasing R52 lock is blocked',()=>{const s=fixtures();s['car02-edge-entry-r52.ts']='const CAR02_RELEASE_LOCK=false;';assert.equal(get(check(s),'R52_HARD_RELEASE_LOCK'),'BLOCK')});
test('missing R45 release gate is blocked',()=>{const s=fixtures();s['car02-api.mjs']='const m=/^\\/api\\/car02/; function authenticate(){}';assert.equal(get(check(s),'R45_API_SEPARATE'),'BLOCK')});
test('missing R57 connection flag is blocked',()=>{const s=fixtures();s['car02-browser-client-r57.mjs']='const x="CAR02_API_ORIGIN_INVALID"';assert.equal(get(check(s),'R57_BROWSER_STARTS_CLOSED'),'BLOCK')});
test('a production booking adapter is not accepted as disposable fixture',()=>{const s=fixtures();s['car02-basic-booking-atomic-isolated.mjs']='export const productionReady=true';assert.equal(get(check(s),'BOOKING_ONLY_DISPOSABLE'),'BLOCK')});
test('staff transport to real host is blocked',()=>{const s=fixtures();s['car02-basic-staff-booking-browser-isolated.mjs']='const url="https://example.com/api/car02/booking"';assert.equal(get(check(s),'STAFF_BROWSER_INVALID_HOST'),'BLOCK')});
test('CSP allowing network is blocked',()=>{const s=fixtures();s['CAR02_BASIC_UNIFIED_OPERATIONS_ISOLATED_PREVIEW.html']=s['CAR02_BASIC_UNIFIED_OPERATIONS_ISOLATED_PREVIEW.html'].replace("connect-src 'none'","connect-src *");assert.equal(get(check(s),'UNIFIED_PREVIEW_NO_NETWORK'),'BLOCK')});
test('inline JS under strict CSP is blocked',()=>{const s=fixtures();s['CAR02_BASIC_UNIFIED_OPERATIONS_ISOLATED_PREVIEW.html']+='<script>window.live=1</script>';assert.equal(get(check(s),'UNIFIED_PREVIEW_EXTERNAL_SCRIPT'),'BLOCK')});
test('missing external MJS link is blocked',()=>{const s=fixtures();s['CAR02_BASIC_UNIFIED_OPERATIONS_ISOLATED_PREVIEW.html']=s['CAR02_BASIC_UNIFIED_OPERATIONS_ISOLATED_PREVIEW.html'].replace('type="module"','type="text/javascript"');assert.equal(get(check(s),'UNIFIED_PREVIEW_EXTERNAL_SCRIPT'),'BLOCK')});
test('secret filename is detected without reading contents',()=>{const s=fixtures();const r=check(s,[...Object.keys(s),'SUPAbasepass.txt']);assert.equal(get(r,'ROOT_TRACKED_SECRET_FILENAMES'),'BLOCK');assert.ok(!JSON.stringify(r).includes('actual-password'))});
test('ordinary docs with pass in name not flagged',()=>{const s=fixtures();const r=check(s,[...Object.keys(s),'PasswordPolicy.md','.env.example']);assert.equal(get(r,'ROOT_TRACKED_SECRET_FILENAMES'),'PASS')});
test('missing synthetic data dependency is blocked',()=>{const s=fixtures();s['car02-basic-unified-operations-isolated.mjs']='export const live=true';assert.equal(get(check(s),'UNIFIED_PREVIEW_SYNTHETIC_ONLY'),'BLOCK')});
test('baseline changed produces REVIEW, not false production GO',()=>{const s=fixtures();const r=auditSources(s,Object.keys(s),{shaReference:{'dashboard.html':'0000000000000000000000000000000000000000'}});assert.equal(get(r,'LEGACY_BASELINE_dashboard.html'),'REVIEW');assert.equal(r.gates.production,'NO_GO')});
test('filesystem run is read-only and does not mutate fixtures',()=>{const root=mkdtempSync(join(tmpdir(),'car02-preflight-'));try{const s=fixtures();for(const [file,body]of Object.entries(s))writeFileSync(join(root,file),body);const before=statSync(join(root,'dashboard.html')).mtimeMs;const result=runReadOnlyPreflight(root);assert.equal(result.summary.blockers,0);assert.equal(statSync(join(root,'dashboard.html')).mtimeMs,before);assert.equal(readFileSync(join(root,'dashboard.html'),'utf8'),s['dashboard.html'])}finally{rmSync(root,{recursive:true,force:true})}});
test('separation is explicit in emitted report',()=>{const r=check(fixtures());assert.equal(r.connectivity.length,5);assert.equal(r.gates.legacyMigration,'NOT_AUTHORIZED');assert.equal(r.gates.identity,'UNVERIFIED_REAL')});

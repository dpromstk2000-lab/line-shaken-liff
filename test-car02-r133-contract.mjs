/** CAR02 R133 contract: offline integrated UX is not a production implementation. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const model=read('car02-r133-integrated-journey-isolated.mjs');
const ui=read('CAR02_R133_INTEGRATED_JOURNEY_ISOLATED_DEMO.html');
const tests=read('test-car02-r133-integrated-journey.mjs');
const prev=read('car02-r132-readiness-gate-isolated.mjs');
const workflow=read('.github/workflows/car02-r133-integrated-journey-isolated-qa.yml');
const cases=[
 ['policy_no_go',()=>assert.match(model,/release:'NO_GO'/)],
 ['policy_hold',()=>assert.match(model,/migration:'HOLD'/)],
 ['production_ready_false',()=>assert.match(model,/productionReady:false/)],
 ['no_booking_claim',()=>assert.match(model,/productionBooking:false/)],
 ['no_network_storage_model',()=>assert.doesNotMatch(model,/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|node:https?|node:net|node:tls|WebSocket|\.connect\s*\(/)],
 ['no_network_storage_ui',()=>assert.doesNotMatch(ui,/<script\s+[^>]*src=|<iframe|<img\s+src=["']https?:|\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/)],
 ['module_import_local_only',()=>assert.match(ui,/import\s*\{.*?initialJourney.*?\}\s*from\s*'\.\/car02-r133-integrated-journey-isolated\.mjs'/s)],
 ['ui_has_4_steps',()=>['① 予約入口','② 写真付き整備報告','③ 追加作業','④ お客様'].forEach(x=>assert.ok(ui.includes(x)))],
 ['ui_no_pii_input',()=>assert.doesNotMatch(ui,/<input[^>]*(name=["'](?:name|phone|plate)|autocomplete=["'](?:tel|name))/i)],
 ['ui_no_upload',()=>assert.doesNotMatch(ui,/type=["']file["']/i)],
 ['ui_shows_closed_gate',()=>assert.match(ui,/NO_GO.*DB HOLD/)],
 ['model_30min_slot',()=>assert.match(model,/durationMinutes:30/)],
 ['model_60day_window',()=>assert.match(model,/today\+60/)],
 ['model_sunday_closed',()=>assert.match(model,/SUNDAY_CLOSED/)],
 ['model_booking_conflict',()=>assert.match(model,/reason:'BUSY'/)],
 ['model_requires_customer_approval_to_complete',()=>assert.match(model,/previous==='CUSTOMER_APPROVED'/)],
 ['model_prevents_postapproval_requote',()=>assert.match(model,/previous==='REPORT_DRAFT'&&next.report/)],
 ['model_does_not_store_photos',()=>assert.match(model,/photos:0/)],
 ['model_authority_remains_closed',()=>assert.match(model,/allExternalGatesOpen:12/)],
 ['model_12_dependencies_untested',()=>assert.match(model,/status:'NOT_VERIFIED'/)],
 ['r132_remains_closed',()=>assert.match(prev,/openBlockingGates:gates\.length/)],
 ['workflow_readonly_permissions',()=>assert.match(workflow,/permissions:\s*\n\s*contents: read/)],
 ['workflow_no_credentials',()=>assert.match(workflow,/persist-credentials: false/)],
 ['workflow_protected_sources',()=>assert.match(workflow,/car02_r118_readonly_source_gate\.py --strict/)],
 ['workflow_3_rounds',()=>assert.match(workflow,/for i in 1 2 3;/)],
 ['workflow_no_secret_deploy',()=>assert.doesNotMatch(workflow,/secrets\.|wrangler\s+deploy|supabase\s+db\s+push|git\s+push/i)],
 ['workflow_closed_gate',()=>assert.match(workflow,/R133_NO_GO_HOLD_GATE_PASS/)],
 ['workflow_no_production_destination',()=>assert.doesNotMatch(workflow,/environment:\s*production/i)],
 ['76_functional_tests',()=>assert.equal((tests.match(/\bcheck\('/g)||[]).length,76)],
 ['workflow_evidence_sanitized',()=>assert.match(workflow,/qa-evidence-r133\/nonproduction-summary\.json/)],
];
for(const [name,fn] of cases)test('R133_contract_'+name,fn);

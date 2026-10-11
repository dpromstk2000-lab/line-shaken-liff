import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('.',import.meta.url);
const html=readFileSync(new URL('CAR02_R92_COMPANY_PC_START.html',root),'utf8');
const r90=readFileSync(new URL('CAR02_R90_COMPANY_PC_RECORD.html',root),'utf8');
const r91=readFileSync(new URL('CAR02_R91_COMPANY_PC_TRIAGE.html',root),'utf8');
const links=[...html.matchAll(/<a\s+[^>]*\bhref="([^"]+)"/g)].map(x=>x[1]);
const pathOf=x=>new URL(x,root);
test('R92 links exactly to existing R90 and R91 HTML (relative and same directory)',()=>{
 assert.deepEqual(links,['./CAR02_R90_COMPANY_PC_RECORD.html','./CAR02_R91_COMPANY_PC_TRIAGE.html']);
 for(const l of links){assert.match(l,/^\.\/[A-Z0-9_]+\.html$/); assert.doesNotThrow(()=>readFileSync(pathOf(l),'utf8'));}
});
test('R90 record/export and import file operations still documented in original UI',()=>{
 assert.match(r90,/R90|会社PC確認/);assert.match(r90,/JSON/);
 assert.match(readFileSync(new URL('car02-staff-review-app-r90.mjs',root),'utf8'),/createReviewExport/);
 assert.match(readFileSync(new URL('car02-staff-review-app-r90.mjs',root),'utf8'),/parseReviewImport/);
});
test('R91 existing triage file matches intended import and TXT actions',()=>{
 assert.match(r91,/id="openFile"/);assert.match(r91,/id="saveText"/);
 const a=readFileSync(new URL('car02-r91-triage-app.mjs',root),'utf8');
 assert.match(a,/makeR91Triage/);assert.match(a,/formatR91Report/);
});
test('R92 shows file names and two steps in order',()=>{
 assert.match(html,/DPRO_CAR02_R90_PC_SELF_CHECK_YYYYMMDD\.json/);
 assert.match(html,/DPRO_CAR02_R91_COMPANY_PC_TRIAGE\.txt/);
 assert.ok(html.indexOf('id="stepOne"')<html.indexOf('id="stepTwo"'));
});
test('R92 asks for actual R90 JSON, not demo sample',()=>{
 assert.match(html,/サンプルボタンは実機検証では使わず/);
 assert.match(html,/このチャットへアップロード/);
});
test('R92 uses no hardcoded GitHub Pages host or unsupported external destination',()=>{
 assert.doesNotMatch(html,/github\.io|https?:\/\//i);
});
test('R92 routes have stable element IDs',()=>{
 assert.match(html,/id="openR90"/);assert.match(html,/id="openR91"/);
 assert.equal((html.match(/id="openR90"/g)||[]).length,1);
 assert.equal((html.match(/id="openR91"/g)||[]).length,1);
});
test('R90 JSON schema and R91 report are still explicitly self reported only',()=>{
 const v=readFileSync(new URL('car02-company-pc-record-r90.mjs',root),'utf8');
 const t=readFileSync(new URL('car02-r91-triage-model.mjs',root),'utf8');
 assert.match(v,/SELF_REPORTED_ONLY/);assert.match(t,/SELF_REPORTED_ONLY/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const root=new URL('.',import.meta.url);
const h=readFileSync(new URL('CAR02_R92_COMPANY_PC_START.html',root),'utf8');
const hasLock=existsSync(new URL('car02-edge-entry-r52.ts',root));
const lock=hasLock?readFileSync(new URL('car02-edge-entry-r52.ts',root),'utf8'):'';
const snapshot=JSON.parse(readFileSync(new URL('R79_EVIDENCE_SNAPSHOT.json',root),'utf8'));
test('R92 explicitly forbids all script execution and browser connections in CSP',()=>{
 assert.match(h,/http-equiv="Content-Security-Policy"/);
 assert.match(h,/default-src 'none'/);assert.match(h,/script-src 'none'/);assert.match(h,/connect-src 'none'/);
 assert.match(h,/form-action 'none'/);assert.match(h,/frame-src 'none'/);
});
test('R92 has no scripts, forms or other executable DOM',()=>{
 assert.doesNotMatch(h,/<\s*script\b|<\s*form\b|<\s*iframe\b|<\s*input\b|<\s*button\b/i);
 assert.doesNotMatch(h,/\bon\w+\s*=/i);
});
test('R92 has exactly two relative navigation links and no inline event handlers',()=>{
 const links=[...h.matchAll(/<a\s+[^>]*\bhref="([^"]+)"/g)];
 assert.equal(links.length,2);assert.ok(links.every(x=>/^\.\/[A-Z0-9_]+\.html$/.test(x[1])));
});
test('R92 contains NO_GO/HOLD lock and does not claim release authorization',()=>{
 assert.match(h,/本番公開 NO_GO \/ DB移行 HOLD/);
 assert.match(h,/全8項目が「問題なし」でも/);
 assert.match(h,/復元できる本番バックアップ/);
});
test('R52 hard release lock still literal true',{skip:!hasLock&&!process.env.GITHUB_ACTIONS},()=>{
 assert.match(lock,/\bconst CAR02_RELEASE_LOCK=true\s*;/);
 assert.match(lock,/if\s*\(CAR02_RELEASE_LOCK\)throw Error\('CAR02_NOT_RELEASED'\)/);
});
test('R79 metadata states NOT migrated and NO_GO/HOLD',()=>{
 assert.equal(snapshot.release_decision,'NO_GO');
 assert.equal(snapshot.migration_decision,'HOLD_BACKUP_AND_RESTORE');
 assert.equal(snapshot.live_backup_completed,false);
 assert.equal(snapshot.separate_production_restore_verified,false);
 assert.equal(snapshot.car02_tables,0);
});
const hasRuntime=['car02-unified-runtime-r50.mjs','car02-edge-boundary-r51.mjs','car02-edge-entry-r52.ts'].every(n=>existsSync(new URL(n,root)));
test('R92 is not part of R50/R51/R52 request routing',{skip:!hasRuntime&&!process.env.GITHUB_ACTIONS},()=>{
 for(const name of ['car02-unified-runtime-r50.mjs','car02-edge-boundary-r51.mjs','car02-edge-entry-r52.ts']){
  const source=readFileSync(new URL(name,root),'utf8');assert.doesNotMatch(source,/CAR02_R92_COMPANY_PC_START|r92-company-pc-start/i);
 }
});
test('R92 discloses local self-report and no real data handling',()=>{
 assert.match(h,/自己申告メモ/);assert.match(h,/個人情報、パスワード、トークン/);
 assert.match(h,/公開設定を勝手に変更せず/);
});

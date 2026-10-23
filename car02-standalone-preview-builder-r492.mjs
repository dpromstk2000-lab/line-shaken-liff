/**
 * V4.92 deterministic, strictly pinned, standalone HTML builder.
 * Extends immutable V4.89 bytes with V4.91 firewall and V4.92 UI modules.
 * No remote dependencies, external scripts, form submission or live services.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildCar02StandaloneHtmlR489} from './car02-standalone-preview-builder-r489.mjs';

export const CAR02_V492_BUILDER_RELEASE_LOCK=true;
export const CAR02_V492_OUTPUT='CAR02_V492_FIREWALLED_STANDALONE_OFFLINE_PREVIEW.html';
export const CAR02_V492_ACCEPTED_BASE_SHA256='6b07eacfb56aaf2004fdf4bbddb2e40563a3e957304fad3c9abcd763a5ebbc38';
export const CAR02_V492_NEW_SOURCES=Object.freeze([
  Object.freeze({file:'car02-booking-input-firewall-r491.mjs',sha256:'e92bf70eb9cd06cf4a2da0c2547dec5973e5c6204016f4e3925049ef1f7f69d7'}),
  Object.freeze({file:'car02-booking-firewalled-day-r492.mjs',sha256:'8d2ec63f438781264829f03e27e96d6812ec51240158388d6ef2759a2653c016'}),
  Object.freeze({file:'car02-booking-calendar-firewalled-r492.mjs',sha256:'ef9535d55ff7da5fbf019245db618a9fc9f68f1a5a32a4e02a7b9ef94e980dd6'})
]);

const digest=value=>createHash('sha256').update(value).digest('hex');
const base=new URL('./',import.meta.url);
const importRe=/^import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/[^'"\n]+['"];?\s*$/gm;
const exportRe=/^export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/gm;

function checkedSource(spec){
  const source=readFileSync(new URL(spec.file,base),'utf8');
  if(digest(source)!==spec.sha256)throw Error(`V492_SOURCE_HASH_MISMATCH:${spec.file}`);
  return source;
}

/** The V4.89 bundle has five immutable source closures: indices 0–4. */
function wrap(source,index){
  if(/\bimport\s*\(/.test(source)||/\bexport\s*\{/.test(source)||/\bexport\s+default\b/.test(source))
    throw Error('V492_DYNAMIC_IMPORT_OR_EXPORT_REFUSED');
  const deps=[];
  const code=source.replace(importRe,(_,specifiers)=>{
    for(const part of specifiers.split(',')){
      const name=part.trim();
      if(!/^[A-Za-z_$][\w$]*$/.test(name))throw Error('V492_IMPORT_FORMAT_REFUSED');
      deps.push(name);
    }
    return '';
  });
  if(/^\s*import\b/m.test(code))throw Error('V492_UNKNOWN_IMPORT_REFUSED');
  const exports=[...code.matchAll(exportRe)].map(x=>x[1]);
  if(!exports.length||new Set(exports).size!==exports.length)throw Error('V492_EXPORT_FORMAT_REFUSED');
  const body=code.replace(/^export\s+(?=const|function)/gm,'');
  if(/^\s*export\b/m.test(body))throw Error('V492_UNKNOWN_EXPORT_REFUSED');
  const available=Array.from({length:index},(_,i)=>`...__car02_m${i}`).join(',');
  return `const __car02_m${index}=(()=>{'use strict';\nconst {${deps.join(',')}}={${available}};\n${body}\nreturn {${exports.join(',')}};\n})();`;
}

export function buildCar02StandaloneHtmlR492(){
  const old=buildCar02StandaloneHtmlR489();
  if(digest(old)!==CAR02_V492_ACCEPTED_BASE_SHA256)
    throw Error('V492_ACCEPTED_V489_HTML_BYTES_CHANGED');
  const scripts=[...old.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if(scripts.length!==1)throw Error('V492_BASE_SCRIPT_COUNT_INVALID');
  const oldScript=scripts[0][1];
  const baseCsp=`script-src 'sha256-${createHash('sha256').update(oldScript).digest('base64')}'`;
  if(!old.includes(baseCsp))throw Error('V492_BASE_CSP_HASH_MISMATCH');
  const additional=CAR02_V492_NEW_SOURCES.map((spec,i)=>wrap(checkedSource(spec),i+5));
  const script=oldScript+'\n'+additional.join('\n\n')+'\n';
  if(/<\/script/i.test(script))throw Error('V492_SCRIPT_BREAKOUT_REFUSED');
  const nextCsp=`script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`;
  let html=old.replace(scripts[0][0],`<script>${script}</script>`)
    .replace(baseCsp,nextCsp)
    .replace('<body data-car02-r488-preview data-car02-r489-standalone>',
      '<body data-car02-r492-preview data-car02-r492-standalone>')
    .replace('DPRO CAR02 V4.89 | ダブルクリックで開くオフライン隔離デモ',
      'DPRO CAR02 V4.92 | 入力防御付きオフライン予約画面デモ')
    .replace('V4.89 オフライン単体カレンダー／UI確認用',
      'V4.92 入力防御付き・単体カレンダー／UI確認用')
    .replace('DPRO CAR02 V4.89 | STANDALONE OFFLINE DEMO',
      'DPRO CAR02 V4.92 | INPUT-FIREWALLED OFFLINE DEMO')
    .replace('V4.85の休日・時刻判定とV4.86の候補時間判定を使用しています。',
      'V4.85の休日・時刻判定、V4.86の候補時間判定、V4.91の入力防御をすべて通過した架空候補のみ表示します。');
  if(!html.includes(nextCsp)||!html.includes('<body data-car02-r492-preview')||
     /<body[^>]*data-car02-r488-preview/.test(html)||!html.includes("connect-src 'none'")||
     !html.includes("form-action 'none'"))throw Error('V492_OFFLINE_MARKER_OR_CSP_FAILED');
  if(/<script\s+[^>]*src=|<form\b|<input\b/i.test(html)||
     /\b(?:fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB)\b/.test(script))
    throw Error('V492_NETWORK_STORAGE_OR_FORM_REFUSED');
  return html;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const html=buildCar02StandaloneHtmlR492();
  writeFileSync(new URL(CAR02_V492_OUTPUT,base),html,'utf8');
  process.stdout.write(`V492_FIREWALLED_STANDALONE_BUILD_PASS sha256=${digest(html)} bytes=${Buffer.byteLength(html)}\n`);
}

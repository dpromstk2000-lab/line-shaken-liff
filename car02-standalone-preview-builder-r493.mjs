/** V4.93 deterministic, offline-only extension of accepted V4.92 HTML. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildCar02StandaloneHtmlR492} from './car02-standalone-preview-builder-r492.mjs';

export const CAR02_V493_BUILDER_RELEASE_LOCK=true;
export const CAR02_V493_OUTPUT='CAR02_V493_RESILIENT_STANDALONE_OFFLINE_PREVIEW.html';
export const CAR02_V493_ACCEPTED_BASE_SHA256='9ca5d6576c2ebc56f364a5e46e436df1231c0b67030e9e2969ef15681a3a4b09';
export const CAR02_V493_RESILIENCE_SHA256='b356ca831082938bc93875be621895ea5d74b8fa111aa515abfa552644135e32';

const digest=value=>createHash('sha256').update(value).digest('hex');

export function buildCar02StandaloneHtmlR493(){
  const html=buildCar02StandaloneHtmlR492();
  if(digest(html)!==CAR02_V493_ACCEPTED_BASE_SHA256)
    throw Error('V493_ACCEPTED_V492_HTML_CHANGED');
  const source=readFileSync(new URL('./car02-booking-calendar-resilient-r493.mjs',import.meta.url),'utf8');
  if(digest(source)!==CAR02_V493_RESILIENCE_SHA256)
    throw Error('V493_RESILIENCE_SOURCE_CHANGED');
  if(/\bimport\s*\(|\bexport\s*\{|\bexport\s+default\b/.test(source))
    throw Error('V493_UNSAFE_ESM_SHAPE');
  const imports=[];
  const stripped=source.replace(/^import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/[^'"\n]+['"];?\s*$/gm,(_,names)=>{
    for(const part of names.split(',')){
      const name=part.trim();
      if(!/^[A-Za-z_$][\w$]*$/.test(name))throw Error('V493_IMPORT_FORMAT_REFUSED');
      imports.push(name);
    }
    return '';
  });
  if(/^\s*import\b/m.test(stripped))throw Error('V493_UNKNOWN_IMPORT_REFUSED');
  const exports=[...stripped.matchAll(/^export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/gm)]
    .map(x=>x[1]);
  if(exports.length!==2||new Set(exports).size!==exports.length)
    throw Error('V493_UNEXPECTED_EXPORTS');
  const code=stripped.replace(/^export\s+(?=const|function)/gm,'');
  if(/^\s*export\b/m.test(code))throw Error('V493_UNKNOWN_EXPORT_REFUSED');
  const available=Array.from({length:8},(_,i)=>`...__car02_m${i}`).join(',');
  const newClosure=`const __car02_m8=(()=>{'use strict';\nconst {${imports.join(',')}}={${available}};\n${code}\nreturn {${exports.join(',')}};\n})();`;
  const match=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if(match.length!==1)throw Error('V493_BASE_SCRIPT_COUNT_INVALID');
  const oldScript=match[0][1];
  const oldCsp=`script-src 'sha256-${createHash('sha256').update(oldScript).digest('base64')}'`;
  if(!html.includes(oldCsp))throw Error('V493_BASE_CSP_INVALID');
  const script=oldScript+'\n'+newClosure+'\n';
  if(/<\/script/i.test(script))throw Error('V493_SCRIPT_BREAKOUT_REFUSED');
  const newCsp=`script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`;
  const output=html.replace(match[0][0],`<script>${script}</script>`)
    .replace(oldCsp,newCsp)
    .replace('<body data-car02-r492-preview data-car02-r492-standalone>',
      '<body data-car02-r493-preview data-car02-r493-standalone>')
    .replace('DPRO CAR02 V4.92 | 入力防御付きオフライン予約画面デモ',
      'DPRO CAR02 V4.93 | 異常入力対応・オフライン予約画面デモ')
    .replace('V4.92 入力防御付き・単体カレンダー／UI確認用',
      'V4.93 異常時安全停止付き・オフラインUI確認用')
    .replace('DPRO CAR02 V4.92 | INPUT-FIREWALLED OFFLINE DEMO',
      'DPRO CAR02 V4.93 | RESILIENT OFFLINE DEMO')
    .replace('V4.91の入力防御をすべて通過した架空候補のみ表示します。',
      'V4.91の入力防御をすべて通過した架空候補のみ表示し、V4.93では異常時に安全停止します。');
  if(!output.includes(newCsp)||
     !output.includes('<body data-car02-r493-preview data-car02-r493-standalone>')||
     /<body[^>]*data-car02-r492-preview/.test(output)||
     !output.includes("connect-src 'none'")||!output.includes("form-action 'none'"))
    throw Error('V493_MARKER_OR_OFFLINE_CSP_MISSING');
  if(/<script\s+[^>]*src=|<form\b|<input\b/i.test(output)||
     /\b(?:fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB)\b/.test(script))
    throw Error('V493_FORBIDDEN_BROWSER_CAPABILITY');
  return output;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const html=buildCar02StandaloneHtmlR493();
  writeFileSync(new URL(CAR02_V493_OUTPUT,import.meta.url),html,'utf8');
  process.stdout.write(`V493_RESILIENT_OFFLINE_BUILD_PASS sha256=${digest(html)} bytes=${Buffer.byteLength(html)}\n`);
}

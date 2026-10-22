/**
 * V4.89 offline-only single HTML bundler (no npm, CDN, server or network).
 * Input source hashes are pinned: changed policy/UI code fails the build.
 * Does not touch GitHub, providers, databases, LINE, staging or production.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CAR02_V489_RELEASE_LOCK=true;
export const CAR02_V489_OUTPUT='CAR02_V489_STANDALONE_OFFLINE_BOOKING_PREVIEW.html';
export const CAR02_V489_INPUTS=Object.freeze([
  Object.freeze({file:'car02-booking-calendar-policy-r485.mjs',
    sha256:'5ab6593e67614d82b133bdbeeb3d0b7efd1d196c22a414c4eb59127e8846adc2'}),
  Object.freeze({file:'car02-booking-day-view-r486.mjs',
    sha256:'4c34e3e4fae232fa392b9acc12d67e8b9823834683ae71d46ffce5e640f83819'}),
  Object.freeze({file:'car02-booking-month-grid-r487.mjs',
    sha256:'b61c943ff73e689be805063a3d6b96bae19f3d81263c1966f58f9a85b84369de'}),
  Object.freeze({file:'car02-booking-calendar-preview-r487.mjs',
    sha256:'89ea2a2d7609ac58b703e2c2405dedf46bf2ef34cc68018a9f30e869c9ae0922'}),
  Object.freeze({file:'car02-booking-calendar-accessible-r488.mjs',
    sha256:'5a5c89b035c17f506fcd21c0ab3beb20048a01d35e49ff54beb1d1ac271e8170'}),
  Object.freeze({file:'CAR02_V488_ACCESSIBLE_BOOKING_CALENDAR_READONLY_PREVIEW.html',
    sha256:'4408d5864dc6963624b33889dd07dfa851e0b91588778b54c586fb0a34aafd62'})
]);

const digest=value=>createHash('sha256').update(value).digest('hex');
const base=new URL('./',import.meta.url);
const importRe=/^import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/[^'"\n]+['"];?\s*$/gm;
const exportRe=/^export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/gm;

function pinnedSource(input){
  const source=readFileSync(new URL(input.file,base),'utf8');
  if(digest(source)!==input.sha256) throw Error(`V489_SOURCE_HASH_MISMATCH:${input.file}`);
  return source;
}

/** Transform only the known static ESM subset, in separate closures. */
function wrapStaticModule(source,index){
  if(/\bimport\s*\(/.test(source)||/\bexport\s*\{/.test(source)||/\bexport\s+default\b/.test(source))
    throw Error('V489_DYNAMIC_MODULE_OR_REEXPORT_REFUSED');
  const imported=[];
  const withoutImports=source.replace(importRe,(_,specifiers)=>{
    for(const part of specifiers.split(',')){
      const trimmed=part.trim();
      if(!/^[A-Za-z_$][\w$]*$/.test(trimmed)) throw Error('V489_IMPORT_FORMAT_REFUSED');
      imported.push(trimmed);
    }
    return '';
  });
  if(/^\s*import\b/m.test(withoutImports)) throw Error('V489_UNKNOWN_IMPORT_REFUSED');
  const names=[...withoutImports.matchAll(exportRe)].map(x=>x[1]);
  if(names.length===0||new Set(names).size!==names.length) throw Error('V489_EXPORT_SHAPE_REFUSED');
  const code=withoutImports.replace(/^export\s+(?=const|function)/gm,'');
  if(/^\s*export\b/m.test(code)) throw Error('V489_UNKNOWN_EXPORT_REFUSED');
  const available=index>0?Array.from({length:index},(_,i)=>`...__car02_m${i}`).join(','):'';
  const deps=imported.length?`const {${imported.join(',')}}={${available}};\n`:'';
  return `const __car02_m${index}=(()=>{'use strict';\n${deps}${code}\nreturn {${names.join(',')}};\n})();`;
}

/** Returns deterministic static HTML; contains only validated embedded code. */
export function buildCar02StandaloneHtmlR489(){
  const sources=CAR02_V489_INPUTS.map(pinnedSource);
  const scripts=sources.slice(0,-1).map(wrapStaticModule).join('\n\n');
  if(/<\/script/i.test(scripts))
    throw Error('V489_SCRIPT_END_TAG_REFUSED');
  const script=`/* DPRO CAR02 V4.89: LOCAL OFFLINE-ONLY DEMO; NO REAL BOOKINGS */\n${scripts}\n`;
  const shaBase64=createHash('sha256').update(script).digest('base64');
  const shaCsp=`script-src 'sha256-${shaBase64}'`;
  let html=sources.at(-1);
  const expectedSrc='<script type="module" src="./car02-booking-calendar-accessible-r488.mjs"></script>';
  if(!html.includes(expectedSrc)) throw Error('V489_ENTRY_SCRIPT_MISSING');
  html=html.replace(expectedSrc,`<script>${script}</script>`);
  html=html.replace("default-src 'self'","default-src 'none'")
    .replace("script-src 'self'",shaCsp)
    .replace("style-src 'self' 'unsafe-inline'","style-src 'unsafe-inline'")
    .replace('<body data-car02-r488-preview>',
      '<body data-car02-r488-preview data-car02-r489-standalone>')
    .replace('DPRO CAR02 V4.88 | キーボード対応・予約カレンダー隔離プレビュー',
      'DPRO CAR02 V4.89 | ダブルクリックで開くオフライン隔離デモ')
    .replace('V4.88 キーボード対応カレンダー／UI確認用',
      'V4.89 オフライン単体カレンダー／UI確認用')
    .replace('DPRO CAR02 V4.88 | ACCESSIBLE ISOLATED UI',
      'DPRO CAR02 V4.89 | STANDALONE OFFLINE DEMO');
  if(!html.includes(shaCsp)||!html.includes('data-car02-r489-standalone')||
     !html.includes("connect-src 'none'")) throw Error('V489_CSP_OR_MARKER_MISSING');
  if(/\b(?:fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage)\b/.test(script))
    throw Error('V489_NETWORK_OR_STORAGE_SOURCE_REFUSED');
  if(/<script\s+[^>]*src=/.test(html)||/<form\b|<input\b/i.test(html))
    throw Error('V489_EXTERNAL_SCRIPT_OR_DATA_FORM_REFUSED');
  return html;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const html=buildCar02StandaloneHtmlR489();
  writeFileSync(new URL(CAR02_V489_OUTPUT,base),html,'utf8');
  process.stdout.write(`V489_STANDALONE_OFFLINE_BUILD_PASS sha256=${digest(html)} bytes=${Buffer.byteLength(html)}\n`);
}

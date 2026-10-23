/** CAR02 V4.97: display-only consistency on the accepted V4.94 offline demo. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CAR02_V497_RELEASE_LOCK=true;
export const CAR02_V497_OUTPUT='CAR02_V497_LABEL_CONSISTENT_STANDALONE_OFFLINE_PREVIEW.html';
export const CAR02_V497_ACCEPTED_V494_SHA256='ac2d04c351892d218894926ea3fd2e45fef399e996b177778f94baadf5be663e';

const digest=(value,encoding='hex')=>createHash('sha256').update(value).digest(encoding);

function replaceOnce(source,from,to){
  if(source.split(from).length!==2)throw Error(`V497_UNEXPECTED_REPLACEMENT_COUNT: ${from}`);
  return source.replace(from,to);
}

export function buildCar02PreviewLabelR497(){
  const accepted=readFileSync(new URL('./CAR02_V494_READABLE_STANDALONE_OFFLINE_PREVIEW.html',import.meta.url),'utf8');
  if(digest(accepted)!==CAR02_V497_ACCEPTED_V494_SHA256)
    throw Error('V497_ACCEPTED_V494_HTML_CHANGED');
  const originalScripts=[...accepted.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if(originalScripts.length!==1)throw Error('V497_ACCEPTED_SCRIPT_SHAPE_CHANGED');
  const originalScript=originalScripts[0][1];
  const acceptedHash=`script-src 'sha256-${digest(originalScript,'base64')}'`;
  if(!accepted.includes(acceptedHash)||!accepted.includes("connect-src 'none'")||
     !accepted.includes("form-action 'none'")||!accepted.includes("default-src 'none'"))
    throw Error('V497_ACCEPTED_CSP_UNEXPECTED');

  const fromInitial="announce('V4.92 安全な隔離プレビューです。すべて架空の候補です。');";
  const toInitial="announce('V4.97 安全な隔離プレビューです。すべて架空の候補です。');";
  const adjustedScript=replaceOnce(originalScript,fromInitial,toInitial);
  const newHash=`script-src 'sha256-${digest(adjustedScript,'base64')}'`;

  let html=replaceOnce(accepted,originalScripts[0][0],`<script>${adjustedScript}</script>`);
  html=replaceOnce(html,acceptedHash,newHash);
  html=replaceOnce(html,
    '<title>DPRO CAR02 V4.94 | 読みやすさ改善・オフライン予約画面デモ</title>',
    '<title>DPRO CAR02 V4.97 | 表示ラベル統一・オフライン予約画面デモ</title>');
  html=replaceOnce(html,
    '<small>V4.94 読みやすさ改善・オフラインUI確認用</small>',
    '<small>V4.97 表示ラベル統一・オフラインUI確認用</small>');
  html=replaceOnce(html,
    'DPRO CAR02 V4.94 | READABLE OFFLINE DEMO |',
    'DPRO CAR02 V4.97 | LABEL-CONSISTENT OFFLINE DEMO |');

  const finalScripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if(finalScripts.length!==1||finalScripts[0][1]!==adjustedScript||
     !html.includes(newHash)||html.includes(acceptedHash)||
     !html.includes('REVIEW ONLY · NO_GO')||
     !html.includes('<body data-car02-r493-preview data-car02-r493-standalone>')||
     !html.includes("connect-src 'none'")||!html.includes("form-action 'none'"))
    throw Error('V497_ISOLATED_LABEL_CHANGE_INVALID');
  return html;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const html=buildCar02PreviewLabelR497();
  writeFileSync(new URL(CAR02_V497_OUTPUT,import.meta.url),html,'utf8');
  process.stdout.write(`V497_LABEL_CONSISTENCY_OFFLINE_BUILD_PASS sha256=${digest(html)} bytes=${Buffer.byteLength(html)}\n`);
}

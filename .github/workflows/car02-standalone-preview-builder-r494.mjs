/** V4.94 visual readability layer. Accepted V4.93 behavior is immutable. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CAR02_V494_BUILDER_RELEASE_LOCK=true;
export const CAR02_V494_OUTPUT='CAR02_V494_READABLE_STANDALONE_OFFLINE_PREVIEW.html';
export const CAR02_V494_ACCEPTED_V493_SHA256='e663a41545136a08dbb7f0811885a9c23c7153cdef6f433615e7460398b7c9a3';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const shaBase64=value=>createHash('sha256').update(value).digest('base64');

// This patch only changes local CSS. No script or data/authorization path changes.
const readableCss=`
    /* V4.94: readable touch targets, disabled states and narrow screens */
    :root{font-size:18px}
    .banner{font-size:17px;line-height:1.65}
    .lead,.small,.legend,.footer{font-size:16px;line-height:1.65}
    .week span{font-size:15px}
    .pill,.brand small{font-size:15px}
    .calendar-day,.time{min-height:52px;font-size:18px}
    .calendar-day:disabled{color:#536477;border-color:#bdcbd8;background:#edf1f5}
    .time:disabled{color:#536477;border-color:#bdcbd8;background:#edf1f5}
    .nav:disabled{opacity:1;background:#edf1f5;color:#536477}
    .action:disabled{background:#dce6ee;color:#435b71}
    .status,.warn{font-size:17px;line-height:1.7}
    button:focus-visible{outline:4px solid #a36605;outline-offset:3px}
    @media(max-width:480px){
      :root{font-size:17px}
      .calendar-day,.time{min-height:50px;font-size:17px}
      .wrap{padding-bottom:72px}
      .legend,.small,.lead,.footer{font-size:15px}
    }
    @media(max-width:380px){
      .times{grid-template-columns:repeat(2,minmax(0,1fr))}
      .monthbar strong{font-size:18px}
      .week,.days{gap:3px}
    }
`;

export function buildCar02StandaloneHtmlR494(){
  const base=readFileSync(new URL('./CAR02_V493_RESILIENT_STANDALONE_OFFLINE_PREVIEW.html',import.meta.url),'utf8');
  if(sha256(base)!==CAR02_V494_ACCEPTED_V493_SHA256)
    throw Error('V494_ACCEPTED_V493_HTML_CHANGED');
  if((base.match(/<style>/g)||[]).length!==1||
     (base.match(/<\/style>/g)||[]).length!==1)
    throw Error('V494_BASE_STYLE_SHAPE_INVALID');
  const scripts=[...base.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if(scripts.length!==1)throw Error('V494_BASE_SCRIPT_SHAPE_INVALID');
  const script=scripts[0][1];
  const csp=`script-src 'sha256-${shaBase64(script)}'`;
  if(!base.includes(csp)||!base.includes("connect-src 'none'")||
     !base.includes("form-action 'none'"))
    throw Error('V494_ACCEPTED_CSP_NOT_PRESENT');
  if(/@import|url\s*\(|<\/style|<script|<form|<input/i.test(readableCss))
    throw Error('V494_VISUAL_PATCH_NOT_ISOLATED');
  const output=base
    .replace('</style>',readableCss+'  </style>')
    .replace('DPRO CAR02 V4.93 | 異常入力対応・オフライン予約画面デモ',
      'DPRO CAR02 V4.94 | 読みやすさ改善・オフライン予約画面デモ')
    .replace('V4.93 異常時安全停止付き・オフラインUI確認用',
      'V4.94 読みやすさ改善・オフラインUI確認用')
    .replace('DPRO CAR02 V4.93 | RESILIENT OFFLINE DEMO',
      'DPRO CAR02 V4.94 | READABLE OFFLINE DEMO');
  const newScripts=[...output.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if(newScripts.length!==1||newScripts[0][1]!==script||!output.includes(csp)||
     !output.includes('<body data-car02-r493-preview data-car02-r493-standalone>')||
     !output.includes('DPRO CAR02 V4.94 | READABLE OFFLINE DEMO'))
    throw Error('V494_ACCEPTED_SCRIPT_OR_MARKERS_CHANGED');
  return output;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const html=buildCar02StandaloneHtmlR494();
  writeFileSync(new URL(CAR02_V494_OUTPUT,import.meta.url),html,'utf8');
  process.stdout.write(`V494_READABLE_OFFLINE_BUILD_PASS sha256=${sha256(html)} bytes=${Buffer.byteLength(html)}\n`);
}

/** V4.96: version-fresh, immutable rendering of the formally accepted V4.95 HOLD board. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CAR02_V496_RELEASE_LOCK=true;
export const CAR02_V496_ACCEPTED_V495_RUN=39888313357;
export const CAR02_V496_ACCEPTED_V495_TESTS=1549;
export const CAR02_V496_ACCEPTED_V495_SHA256='1e6b3a6da1c3145cb733bd4596b3bc5ed65d783afa991e1fb8afcac9c6679b0a';
export const CAR02_V496_OUTPUT='CAR02_V496_COMMERCIAL_READINESS_FRESH_OFFLINE_BOARD.html';

const hash=x=>createHash('sha256').update(x).digest('hex');

function replaceOnce(source,oldText,newText){
  const at=source.indexOf(oldText);
  if(at<0||source.indexOf(oldText,at+oldText.length)!==-1)
    throw Error(`V496_EXPECTED_EXACTLY_ONE_ACCEPTED_FIELD: ${oldText}`);
  return source.slice(0,at)+newText+source.slice(at+oldText.length);
}

export function buildCar02ReadinessFreshBoardR496(){
  const baseline=readFileSync(new URL('./CAR02_V495_COMMERCIAL_READINESS_OFFLINE_BOARD.html',import.meta.url));
  if(hash(baseline)!==CAR02_V496_ACCEPTED_V495_SHA256)
    throw Error('V496_V495_FORMALLY_ACCEPTED_BASELINE_CHANGED');
  let html=baseline.toString('utf8');
  const replacements=[
    ['<title>DPRO CAR02 V4.95 |','<title>DPRO CAR02 V4.96 |'],
    ['DPRO CAR02 · V4.95 · REVIEW ONLY','DPRO CAR02 · V4.96 · REVIEW ONLY'],
    ['<strong>1,521 / 1,521</strong>','<strong>1,549 / 1,549</strong>'],
    ['V4.94 GitHub Actions PASS（実サービス試験ではない）','V4.95 GitHub Actions PASS（実サービス試験ではない）'],
    ['V4.94 実端末UI受入','V4.95 実端末UI受入'],
    ['V4.94 GitHub Actions Run #39886974339 を合格基準として固定','V4.95 GitHub Actions Run #39888313357 を合格基準として固定'],
    ['V4.95は現況表示のみ','V4.96は現況表示のみ']
  ];
  for(const [oldText,newText] of replacements) html=replaceOnce(html,oldText,newText);
  return html;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const html=buildCar02ReadinessFreshBoardR496();
  writeFileSync(new URL(CAR02_V496_OUTPUT,import.meta.url),html,'utf8');
  process.stdout.write(`V496_FRESH_ACCEPTED_CI_HOLD_BOARD_PASS sha256=${hash(html)} bytes=${Buffer.byteLength(html)}\n`);
}

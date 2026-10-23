/** V4.95 review-only status board. This is a report, never a commercial gate. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CAR02_V484_REQUIRED_PROOFS} from './car02-evidence-provenance-gate-r484.mjs';

export const CAR02_V495_RELEASE_LOCK=true;
export const CAR02_V495_BASE_RUN=39886974339;
export const CAR02_V495_EXPECTED_BASE_HTML_SHA256='ac2d04c351892d218894926ea3fd2e45fef399e996b177778f94baadf5be663e';
export const CAR02_V495_EXPECTED_R484_GATE_SHA256='360b92c2756cefbb388b874dc862c7cc2ba8d0be8447050e455e0fff9dcd6309';
export const CAR02_V495_OUTPUT='CAR02_V495_COMMERCIAL_READINESS_OFFLINE_BOARD.html';

const sha256=x=>createHash('sha256').update(x).digest('hex');
const escapeHtml=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const proofGuidance=Object.freeze({
  auth_session_revocation: ['Supabase Auth セッション失効', '専用隔離環境で既存セッションが失効することを提供者側で独立確認'],
  staff_worker_store_acl: ['担当者・Worker・店舗境界', '店舗を跨ぐ参照・更新を拒否する実権限検査と監査証跡'],
  transaction_commit_acl_fence: ['確定時の権限・DB境界', '権限変更・同時処理を含む実DB確定時の拒否・ロールバック記録'],
  line_webhook_delivery_retry: ['LINE配送・再送', '真正Webhook・配送結果・再送・重複抑止を実提供者で照合'],
  independent_offsite_worm: ['独立保全された改ざん耐性記録', 'CIとは独立したWORM保管と変更不可性の確認'],
  independent_signature_key_rotation: ['独立署名鍵の検証・更新', 'KMS側の署名検証・失効・ローテーション監査証跡'],
  owner_isolated_staging_acceptance: ['CAR02専用隔離環境・オーナー承認', 'CAR02専用環境の事実確認と、人間による商用化判断の記録']
});

function pinAcceptedInputs(){
  const accepted=readFileSync(new URL('./CAR02_V494_READABLE_STANDALONE_OFFLINE_PREVIEW.html',import.meta.url));
  if(sha256(accepted)!==CAR02_V495_EXPECTED_BASE_HTML_SHA256)
    throw Error('V495_ACCEPTED_V494_HTML_CHANGED');
  const gate=readFileSync(new URL('./car02-evidence-provenance-gate-r484.mjs',import.meta.url));
  if(sha256(gate)!==CAR02_V495_EXPECTED_R484_GATE_SHA256)
    throw Error('V495_ACCEPTED_R484_PROVENANCE_GATE_CHANGED');
  const keys=CAR02_V484_REQUIRED_PROOFS.map(x=>x.key);
  if(keys.length!==7||new Set(keys).size!==7||
     keys.some(k=>!Object.hasOwn(proofGuidance,k))||Object.keys(proofGuidance).some(k=>!keys.includes(k)))
    throw Error('V495_PROVIDER_REQUIREMENTS_UNEXPECTED');
  return CAR02_V484_REQUIRED_PROOFS;
}

export function buildCar02ReadinessBoardR495(){
  const requirements=pinAcceptedInputs();
  const rows=requirements.map(({key,providerFamily},i)=>{
    const [title,criterion]=proofGuidance[key];
    return `<tr><th scope="row">${i+1}. ${escapeHtml(title)}</th><td>${escapeHtml(providerFamily)}</td><td>${escapeHtml(criterion)}</td><td><span class="missing">未確認</span></td></tr>`;
  }).join('\n');
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; img-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'">
<title>DPRO CAR02 V4.95 | 商用化までの確認事項（隔離資料）</title>
<style>
:root{color-scheme:light;font:17px/1.65 system-ui,-apple-system,'Noto Sans JP',Meiryo,sans-serif;color:#233c54;background:#f1f5f9}*{box-sizing:border-box}body{margin:0}.wrap{max-width:1100px;margin:auto;padding:24px 18px 64px}header{background:#142e46;color:#fff;padding:24px 18px}header>div{max-width:1064px;margin:auto}.label{font-size:14px;letter-spacing:.06em;color:#c4e0f9;font-weight:800}h1{font-size:clamp(25px,3vw,36px);line-height:1.4;margin:4px 0 10px}h2{font-size:22px;line-height:1.4}.notice{border:2px solid #e2bd79;background:#fff4db;color:#775011;padding:15px 19px;border-radius:12px;font-weight:850}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px;margin:19px 0}.stat{background:white;border:1px solid #d2deea;border-radius:14px;padding:20px}.stat strong{display:block;font-size:clamp(25px,3vw,35px);line-height:1.4;color:#174e79}.stat strong.pending{color:#9b4b22}.stat span{display:block;font-weight:800}.muted{color:#536a7f}.panel{background:#fff;border:1px solid #d2deea;border-radius:14px;padding:22px;margin-top:20px}.tablewrap{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:650px;font-size:15px}th,td{border-bottom:1px solid #d9e3ec;padding:14px 10px;text-align:left;vertical-align:top}thead{background:#eaf2f9}th[scope=row]{width:25%}td:nth-child(2){width:16%;overflow-wrap:anywhere}td:nth-child(3){width:44%}.missing{display:inline-block;background:#fff1df;color:#87420e;border:1px solid #ebcfa8;border-radius:100px;padding:3px 11px;font-weight:850;white-space:nowrap}.callout{background:#e9f4fe;border:1px solid #c3dced;padding:14px 18px;border-radius:11px}.foot{font-size:14px;color:#51697f;margin-top:25px}.steps{padding-left:24px}.steps li{padding:5px 0}@media(max-width:700px){.stats{grid-template-columns:1fr}.wrap{padding:16px 12px 56px}.panel{padding:16px}table{font-size:14px}h2{font-size:20px}}
</style></head><body>
<header><div><div class="label">DPRO CAR02 · V4.95 · REVIEW ONLY</div><h1>商用化までの確認事項</h1><p>この画面は隔離資料です。実顧客データ、通信、予約、認証、商用承認を扱いません。</p></div></header>
<main class="wrap">
<p class="notice">公開判断：NO_GO / HOLD（固定）　｜　R52 releaseLock=true　｜　オーナー正式許可なし</p>
<div class="stats"><section class="stat" aria-label="隔離QA"><span>GitHub隔離QA</span><strong>1,521 / 1,521</strong><span class="muted">V4.94 GitHub Actions PASS（実サービス試験ではない）</span></section>
<section class="stat" aria-label="商用証拠"><span>独立確認された商用証拠</span><strong class="pending">0 / 7</strong><span class="muted">実提供者での独立照合が必要</span></section>
<section class="stat" aria-label="実端末"><span>V4.94 実端末UI受入</span><strong class="pending">未完了</strong><span class="muted">PC・スマートフォンでの人間による確認待ち</span></section></div>
<section class="panel"><h2>実サービス側で確認が必要な7項目</h2><p class="muted">以下は未収集・未検証です。CI検査やハッシュ、申告だけでは実証済みに変更できません。</p>
<div class="tablewrap"><table><caption>商用提供者証拠：0/7、全項目未確認</caption><thead><tr><th scope="col">対象</th><th scope="col">確認先</th><th scope="col">必要な実証内容</th><th scope="col">現在</th></tr></thead><tbody>
${rows}
</tbody></table></div></section>
<section class="panel"><h2>次に進むための順番</h2><ol class="steps"><li>隔離デモを実端末で読みやすさ・操作性・横はみ出しまで確認</li><li>実サービスごとに費用と隔離環境の利用可否を確認し、必要な操作は別途承認を得る</li><li>7分類の証拠を提供者側で独立検証し、既存顧客・本番環境とは分離して記録</li><li>オーナーが結果を確認し、正式な公開可否を別途判断する</li></ol>
<p class="callout">現時点では、本番Worker・共有Supabase・LINE・GitHub mainの変更、課金、メッセージ配信、実予約は一切許可されていません。</p></section>
<p class="foot">根拠：V4.84の7項目定義を固定、V4.94 GitHub Actions Run #${CAR02_V495_BASE_RUN} を合格基準として固定。V4.95は現況表示のみで、外部認証・証拠の真正性確認・公開権限の付与を行いません。</p>
</main></body></html>\n`;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const html=buildCar02ReadinessBoardR495();
  writeFileSync(new URL(CAR02_V495_OUTPUT,import.meta.url),html,'utf8');
  process.stdout.write(`V495_READINESS_HOLD_BOARD_PASS sha256=${sha256(html)} bytes=${Buffer.byteLength(html)}\n`);
}

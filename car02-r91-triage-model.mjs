// CAR02 R91 — offline triage of a strictly validated R90 self-check record.
// REVIEW ONLY. Does not authenticate or authorize any release or database migration.
import {QA_ITEMS} from './car02-r89-acceptance-model.mjs';
import {parseReviewImport,reviewStats,RECORD_IDS} from './car02-company-pc-record-r90.mjs';
const REQUIRED=Object.freeze(['issue','pending','ok']);
export const R91_VERSION='CAR02-R91-ISOLATED-TRIAGE-20261011';
export const R91_LOCKED_GATES=Object.freeze(QA_ITEMS.filter(x=>!x.safe).map(x=>Object.freeze({id:x.id,label:x.label,state:'UNVERIFIED'})));
export function makeR91Triage(input){
 const states=typeof input==='string'?parseReviewImport(input):input;
 // For an object caller, normalize via the existing strict serializer/parser.
 // No R91-specific code may bypass the R90 field/choice validation.
 const stats=reviewStats(states);
 const records=QA_ITEMS.filter(x=>x.safe).map(x=>Object.freeze({
    id:x.id,group:x.group,label:x.label,state:states[x.id],
    stateLabel:states[x.id]==='issue'?'要修正':states[x.id]==='ok'?'問題なし':'未確認'
 }));
 const actionable=Object.freeze(REQUIRED.flatMap(state=>records.filter(x=>x.state===state)));
 const issue=records.filter(x=>x.state==='issue');
 const pending=records.filter(x=>x.state==='pending');
 const ok=records.filter(x=>x.state==='ok');
 return Object.freeze({version:R91_VERSION,authority:'SELF_REPORTED_ONLY',
    totals:Object.freeze({total:RECORD_IDS.length,issue:issue.length,pending:pending.length,ok:ok.length}),
    actionable,lockedGates:R91_LOCKED_GATES,
    releaseDecision:'NO_GO',migrationDecision:'HOLD',productionReady:false,
    humanSignoff:false,verifiedBackup:false,
    issueIds:Object.freeze(issue.map(x=>x.id)),pendingIds:Object.freeze(pending.map(x=>x.id)),
    allChecked:stats.pending===0,needsFollowUp:stats.issue>0||stats.pending>0
 });
}
export function formatR91Report(review){
 // Deterministically revalidate input; never interpolate arbitrary user-supplied text.
 const safe=makeR91Triage(Object.fromEntries(review.actionable.map(x=>[x.id,x.state])));
 const lines=['DPRO CAR02 会社PC確認 — 結果整理（隔離・自己申告）',
 'この記録は正式QA・本人確認・本番公開承認を示すものではありません。',
 '公開判定：NO_GO / DB移行：HOLD',
 `要修正：${safe.totals.issue}件 / 未確認：${safe.totals.pending}件 / 問題なし：${safe.totals.ok}件`,
 '', '■ 確認項目（要修正 → 未確認 → 問題なし）'];
 for (const x of safe.actionable)lines.push(`・[${x.stateLabel}] ${x.group} / ${x.label}`);
 lines.push('','■ 本番リリース前の未解除ゲート');
 for(const gate of R91_LOCKED_GATES)lines.push(`・[未承認] ${gate.label}`);
 lines.push('','本番DB変更・SQL実行・Cloudflare Deployは禁止。個人情報・パスワード・トークンは入力しない。');
 return lines.join('\n')+'\n';
}

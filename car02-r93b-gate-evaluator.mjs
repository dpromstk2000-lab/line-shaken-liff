// DPRO CAR02 R93B — evidence-only offline pre-production gate review.
// WARNING: This is not a production approval tool. It can NEVER return GO.
// No network, no secrets, no SQL, no writes outside caller-provided report path.
const EXPECTED='DPRO_CAR02_R93B_READONLY_EVIDENCE_V1';
const blocked=(id,owner,requirement,priority='P0')=>Object.freeze({id,priority,state:'BLOCKED',owner,requirement});
const gates=Object.freeze([
 blocked('PRODUCTION_BACKUP_RESTORE','DB管理者','共有本番DBの復元可能バックアップを実施し、別環境での復元QA証跡を確認'),
 blocked('COMPANY_PC_HUMAN_QA','店舗・開発担当','火曜日の会社PCでR92→R90→R91を確認し、R90 JSONを引き継ぐ'),
 blocked('DB_MIGRATION_AUTHORIZATION','DB管理者・開発責任者','R13の移行前検査・追加DDLの安全性・バックアップ状態・適用手順を承認'),
 blocked('INITIAL_OWNER_IDENTITY','店舗責任者・開発責任者','本人確認・二者承認・初期オーナー登録の安全な実装と権限監査を確認'),
 blocked('STAFF_API_PRODUCTION_WIRING','開発責任者','R70/R85の実店舗権限情報への結合を別環境で検証し、R50/R52はロックを維持'),
 blocked('PRIVATE_PHOTO_PRODUCTION_STORAGE','開発責任者','R47/R82/R83/R84の非公開Storage・DB・失敗時清掃を本番相当隔離環境で再確認'),
 blocked('CONTRACT_LINE_NOTIFICATION_APPROVAL','契約・店舗責任者','契約・通知・LINE配信要件と顧客同意・公開承認を確認'),
 blocked('ROLLBACK_POST_DEPLOY_QA','運用責任者','段階公開・ロールバック・操作ログ・本番監視設計の承認','P1'),
]);
const requiredKeys=['schema','checkedAt','gitHead','runId','pagesReadiness','testPass','testFail','sourceHashEvidence','baseline','verified'];
function fail(code){throw Object.assign(new Error(code),{code});}
function exactKeys(value,keys){return Object.keys(value).sort().join('|')===keys.slice().sort().join('|');}
function isPlain(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;}
export function evaluateR93BGates(evidence){
 if(!isPlain(evidence)||!exactKeys(evidence,requiredKeys))fail('R93B_EVIDENCE_SCHEMA_INVALID');
 if(evidence.schema!==EXPECTED||!/^20\d\d-\d\d-\d\dT/.test(evidence.checkedAt)||!Number.isFinite(Date.parse(evidence.checkedAt))||
   !/^[a-f\d]{40}$/.test(evidence.gitHead)||!Number.isInteger(evidence.runId)||evidence.runId<=0||
   evidence.pagesReadiness!=='STATIC_PAGES_VERIFIED'||evidence.testPass!==42||evidence.testFail!==0||
   !isPlain(evidence.sourceHashEvidence)||!isPlain(evidence.baseline)||!isPlain(evidence.verified))
   fail('R93B_EVIDENCE_INVALID');
 const reqHash={
  'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302',
  'car02-unified-runtime-r50.mjs':'76e4e8cae27599f27e3d887118148718c32ebb80',
  'car02-edge-boundary-r51.mjs':'6614f2ed1933aa787576cb8074cb7d4bc704efa0',
  'car02-initial-owner-r81.mjs':'61d61c503451511857a5b5c89adbc66f8b2ea6cc',
  'car02-photo-pipeline-isolated-r84.mjs':'75282ba42c87debaf27c13d490bad6d80aa4e89b',
  'car02-staff-access-http-r85.mjs':'1bd21520f3d17039af0415e34a7da13a92b3dcfd',
  'car02-staff-permissions-r70.mjs':'f551977e831269bc3e31900b4cb71d0f8d1fa3fc',
  'car02-private-photo-r47.mjs':'e0f3abec6bcf57830d9f3b72fe2eee099b1dff1d',
  'car02-pg-photo-repository-r83.mjs':'546b56e6dceddac767532d2309d4098d2feeed4c',
  'R13_MIGRATION_QA_ONLY.sql':'5136872276b3403f036bae768410c937119398b2',
  'R79_EVIDENCE_SNAPSHOT.json':'9dfb49832f738afd5e5cadfa421ddf9829d79ce6',
  'car02-integration-audit-r80.mjs':'da751061b7e05bc74624307d55b593b4bb00caff',
  'car02-r93-pages-readonly-audit.mjs':'188f066e9fb3bd96b0fd02b6f35cd97645196b19',
 };
 if(!exactKeys(evidence.sourceHashEvidence,Object.keys(reqHash)) ||
     Object.entries(reqHash).some(([file,sha])=>evidence.sourceHashEvidence[file]!==sha))
    fail('R93B_SOURCE_DRIFT');
 const expectedBaseline={car02Tables:0,car02PhotoBuckets:0,liveBackupCompleted:false,separateRestoreVerified:false,releaseDecision:'NO_GO',migrationDecision:'HOLD_BACKUP_AND_RESTORE'};
 if(!exactKeys(evidence.baseline,Object.keys(expectedBaseline)) ||
     Object.entries(expectedBaseline).some(([k,v])=>evidence.baseline[k]!==v))
   fail('R93B_BASELINE_DRIFT');
 const expectedVerified={releaseLockEnabled:true,staffHttpNotProductionWired:true,photoQaNotProductionWired:true,ownerBootstrapQaOnly:true,photoStorageSimulated:true,photoDbDisposable:true};
 if(!exactKeys(evidence.verified,Object.keys(expectedVerified)) ||
     Object.entries(expectedVerified).some(([k,v])=>evidence.verified[k]!==v))
   fail('R93B_SOURCE_CONTRACT_DRIFT');
 if(evidence.gitHead!=='ce9013e05249240e25bc373ed3123d28ec9755c8'||evidence.runId!==38112804868)
   fail('R93B_GITHUB_RUN_DRIFT');
 return Object.freeze({schema:'DPRO_CAR02_R93B_RELEASE_GAPS',source:'R93_GITHUB_QA_AND_READONLY_GITHUB_SOURCE',
  checkedAt:evidence.checkedAt,gitHead:evidence.gitHead,githubRun:'https://github.com/dpromstk2000-lab/line-shaken-liff/actions/runs/'+evidence.runId,
  pagesReadiness:evidence.pagesReadiness,pagesStatus:'STATIC_ONLY',sourceFilesReviewed:Object.keys(reqHash).length,
  gateCount:gates.length,blockedCount:gates.length,blockedGates:gates,
  releaseDecision:'NO_GO',migrationDecision:'HOLD',productionReady:false,
  disclaimer:'Read-only historical evidence. No production DB or Worker state was queried by this evaluator. It is never an authorization to deploy.'});
}
export function renderR93BTxt(x){
 if(!isPlain(x)||x.schema!=='DPRO_CAR02_R93B_RELEASE_GAPS'||x.releaseDecision!=='NO_GO'||x.migrationDecision!=='HOLD'||x.productionReady!==false||x.blockedCount!==8)fail('R93B_REPORT_INVALID');
 return ['DPRO CAR02 公開前残課題一覧 (R93B / READ ONLY)',
 'R93はGitHub Pages静的QA合格。本番公開の承認ではありません。',
 '現判定: NO_GO / 移行: HOLD / 本番DB変更なし',
 'GitHub evidence: '+x.githubRun,
 '',...x.blockedGates.map((g,i)=>`${i+1}. [${g.priority}] ${g.id} — ${g.state}\n   担当: ${g.owner}\n   完了条件: ${g.requirement}`),
 '', '次工程: 10/13の会社PC確認(R94 HUMAN CHECK)。R90 JSONを引き継ぎ、安全に残課題を解消。',
 '既存CAR02公開ロックは解除しない。既存予約・顧客・LINE・デモデータを保護。',''].join('\n');
}
export const R93B_VERSION='R93B-EVIDENCE-ONLY-20261011';

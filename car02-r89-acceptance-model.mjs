// DPRO CAR02 R89: entirely synthetic company-PC acceptance checklist.
// Nothing in this module is a production release approval, attestation or DB write.
export const QA_ITEMS=Object.freeze([
  Object.freeze({id:'ui_desktop',group:'管理画面',label:'会社PCでメニュー・スタッフ一覧・文字サイズを確認',safe:true}),
  Object.freeze({id:'ui_mobile',group:'管理画面',label:'スマホ幅で横スクロールが発生しないことを確認',safe:true}),
  Object.freeze({id:'ui_search',group:'管理画面',label:'スタッフ検索・絞り込み・本人操作禁止を確認',safe:true}),
  Object.freeze({id:'ui_preview',group:'管理画面',label:'変更理由・確認画面・履歴表示を試す（送信しない）',safe:true}),
  Object.freeze({id:'ui_keyboard',group:'管理画面',label:'キーボード操作・入力エラー表示を確認',safe:true}),
  Object.freeze({id:'booking_calendar',group:'予約・HP・LINE',label:'予約カレンダーがDPRO標準の視認性・時間枠表示になっているか確認',safe:true}),
  Object.freeze({id:'booking_paths',group:'予約・HP・LINE',label:'予約WEB・HP・LINEの画面導線を閲覧のみで確認',safe:true}),
  Object.freeze({id:'car02_demo',group:'整備情報',label:'隔離デモの整備報告・見積・写真の見え方を確認',safe:true}),
  Object.freeze({id:'backup',group:'本番リリース前の必須ゲート',label:'本番DBの復元可能なバックアップと別環境での復元検証',safe:false}),
  Object.freeze({id:'identity',group:'本番リリース前の必須ゲート',label:'認証・店舗分離・初期オーナー本人確認・権限監査の承認',safe:false}),
  Object.freeze({id:'contract',group:'本番リリース前の必須ゲート',label:'契約・LINE通知・公開判定の正式な承認',safe:false}),
]);
export const REQUIRED_RELEASE='NO_GO';
export const REQUIRED_MIGRATION='HOLD';
export function qaProgress(ids) {
  const safe=QA_ITEMS.filter(x=>x.safe);
  const valid=ids instanceof Set?ids:new Set();
  const checked=safe.filter(x=>valid.has(x.id)).length;
  return Object.freeze({checked,total:safe.length,pending:safe.length-checked,
    releaseDecision:REQUIRED_RELEASE,migrationDecision:REQUIRED_MIGRATION,
    productionReady:false,blockedGates:QA_ITEMS.filter(x=>!x.safe).length});
}
export function qaSafeId(id){return QA_ITEMS.some(x=>x.safe&&x.id===id);}

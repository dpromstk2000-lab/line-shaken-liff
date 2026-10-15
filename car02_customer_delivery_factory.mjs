/**
 * DPRO CAR02 customer build plan factory V2.
 * Local file generation and SHA checks ONLY. Does not create tenants, make network calls,
 * deploy Workers, apply DB migrations, or authorize a release.
 * Supported CLI: node car02_customer_delivery_factory.mjs --intake <json> --out <NEW_DIR> [--repo <repo_root>]
 */
import {createHash} from 'node:crypto';
import {readFile, lstat, mkdir, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateDraft, assessDraft, hashAsGitBlob, protectedDecision} from './car02_customer_provisioning_readonly.mjs';

export const FACTORY='DPRO_CAR02_CUSTOMER_DELIVERY_FACTORY_V2';
export const PINNED={
 'car02-private-photo-r47.mjs':'e0f3abec6bcf57830d9f3b72fe2eee099b1dff1d',
 'car02-unified-runtime-r50.mjs':'76e4e8cae27599f27e3d887118148718c32ebb80',
 'car02-edge-boundary-r51.mjs':'6614f2ed1933aa787576cb8074cb7d4bc704efa0',
 'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302',
 'car02-private-photo-upload-http-r82.mjs':'78f8b0f80fcc1f89d15fd25e4593c660cd197ea3',
 'car02-r93q-single-schema-lifecycle-isolated.mjs':'be1cd3feb78e26fb4759d9a86ecbd835d7ada144',
 'car02-r93s-durable-upload-intent-isolated.mjs':'64e907008448264512594573cdcd8773c4c29d'
};
const FEATURES=Object.freeze({
 HP:{entry:'index.html',require:['CUSTOMER_DOMAIN','HP_ROUTE_QA'],note:'既存画面の存在はCAR02用HP公開の確認ではない'},
 LINE_OFFICIAL:{entry:'index.html',require:['LINE_IF_ENABLED','LINE_LIFF_REAL_AUTH_QA'],note:'LINE実配信と本人確認は未承認'},
 RESERVATION_WEB:{entry:'CAR02_R133_INTEGRATED_JOURNEY_ISOLATED_DEMO.html',require:['BOOKING_E2E','BOOKING_ATOMICITY_REAL_QA'],note:'R133は一時状態デモ。実予約書込みなし'},
 CAR02_MANAGEMENT:{entry:'CAR02_DEMO.html',require:['REPORT_ESTIMATE_E2E','STAFF_API_PRODUCTION_WIRING'],note:'R8デモは本番管理機能の証明ではない'},
 PRIVATE_PHOTO:{entry:'CAR02_R112_QUARANTINE_REVIEW_DEMO.html',require:['PHOTO_STORAGE_IF_ENABLED','PHOTO_RECONCILIATION_REAL_QA'],note:'保存/削除・暗号化・利用権限は実環境で未検証'}
});
const SECURITY_IMPROVEMENTS=Object.freeze([
 {id:'BOOKING_CONCURRENT_IDEMPOTENCY',from:'R139-R181',apply:'ACCEPTANCE_TEST',reason:'本番予約APIへの自動配線は未確認'},
 {id:'TENANT_OWNER_RLS_ROW_SCOPE',from:'R182-R245',apply:'ACCEPTANCE_TEST',reason:'合成DBのRLS検査を顧客DBへ直接流用しない'},
 {id:'DB_SESSION_PREPARED_PLAN',from:'R246-R251',apply:'ACCEPTANCE_TEST',reason:'実DB接続プール・本番認証で再確認が必要'},
 {id:'RESET_DISCARD_SESSION',from:'R252-R254',apply:'PENDING_OFFICIAL_QA',reason:'GitHub正式QAは本パッケージ時点で未確認'},
 {id:'SAFE_PHOTO_DELETE_QUARANTINE',from:'R93D-R114',apply:'SEPARATE_STAGING_REVIEW',reason:'R47実装は未修正。実Storageでの検証必須'}
]);
const PHOTO_BLOCKERS=Object.freeze([
 'R50_UPLOAD_COMPOSITION','R51_UPLOAD_ROUTE','R51_BODY_CAP_CONFLICT',
 'R82_DURABLE_INTENT_KEY','R47_DIRECT_STORAGE_DELETE','R93Q_PROCESS_LOCAL_RECEIPTS'
]);
const CORE_BLOCKERS=Object.freeze([
 'CUSTOMER_TENANT_STAGING_AND_AUTH', 'WORKER_API_DB_WIRING',
 'REAL_BOOKING_AND_ESTIMATE_E2E', 'HUMAN_ACCEPTANCE',
 'BACKUP_RESTORE_PROOF','OWNER_RELEASE_SIGNOFF'
]);
const HAZARDOUS_FIELDS=/secret|password|access.?token|service.?role|private.?key|api.?key|jwt|client.?secret/i;
function fail(message){throw Object.assign(new Error('CAR02_FACTORY_'+message),{code:'CAR02_FACTORY_'+message});}
const sha256=x=>createHash('sha256').update(x).digest('hex');
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
function assertNoSecrets(draft){
 // Exact draft validation is first: no extra fields, nested credential names, etc.
 validateDraft(draft);
 for(const name of Object.keys(draft))if(HAZARDOUS_FIELDS.test(name))fail('SENSITIVE_FIELD');
}
function pathsFor(service){const f=FEATURES[service];if(!f)fail('UNKNOWN_SERVICE');return {...f,service,status:'STAGING_IMPLEMENTATION_REQUIRED',realLiveProof:false};}
export function makeBuildPlan(draft,{sourceAudit=null}={}){
 assertNoSecrets(draft);
 const base=assessDraft(draft);
 const selected=draft.services.map(pathsFor);
 const gates=[...new Set([...CORE_BLOCKERS,...selected.flatMap(x=>x.require),
   ...(draft.services.includes('PRIVATE_PHOTO')?PHOTO_BLOCKERS:[])])];
 return {
  schema:'DPRO_CAR02_CUSTOMER_BUILD_PLAN_V2',schemaVersion:2,
  facilityCode:draft.facilityCode,customerType:draft.customerType,domainPlan:draft.domainPlan,
  bookingMinutes:draft.bookingMinutes,selectedServices:[...draft.services],
  sourceState:sourceAudit===null?'NOT_CHECKED':sourceAudit.allMatch?'PINNED_SOURCES_MATCH':'SOURCE_DRIFT_OR_MISSING',
  sourceAudit,
  // Presence of an approval tickbox in the sales worksheet is never proof of real implementation.
  intakeComplete:base.orderIntakeComplete,selected,
  adoption:[...SECURITY_IMPROVEMENTS],
  pendingGates:gates.map(id=>({id,state:'NOT_VERIFIED',evidenceRequired:true})),
  workSequence:[
   '1. 契約範囲・名義・顧客保管先を確定（実情報は公開GitHub禁止）',
   '2. ステージング専用の店舗・認証・API・DB・Workerを用意',
   '3. 予約→整備報告→見積→顧客判断→完了の実データ保存E2E',
   '4. 選択した写真・LINEのみ、実権限を保護して隔離連携試験',
   '5. バックアップを別環境へ復元・実機QA・監視とロールバック審査',
   '6. オーナーと運用責任者が明示的に公開承認するまでNO_GO'
  ],
  customerEnvironmentCreated:false,workerDeployed:false,databaseMigrated:false,
  realAuthenticationVerified:false,realBookingVerified:false,releaseAuthorized:false,
  releaseDecision:'NO_GO',migrationDecision:'HOLD',customerGoLiveReady:false,
  preservedReleaseLock:true,productionTouched:false
 };
}
export function auditSourceText(sources){
 if(!plain(sources))fail('SOURCE_AUDIT_OBJECT');
 const expectedNames=Object.keys(PINNED).sort();
 if(Object.keys(sources).sort().join('|')!==expectedNames.join('|'))fail('SOURCE_AUDIT_KEYS');
 const items=expectedNames.map(name=>{
  const src=sources[name];
  if(typeof src!=='string'||src.length<20)fail('SOURCE_CONTENT');
  const sha=hashAsGitBlob(src);
  return {path:name,actual:sha,expected:PINNED[name],matched:sha===PINNED[name]};
 });
 return {schema:'CAR02_PINNED_SOURCE_AUDIT_V1',allMatch:items.every(x=>x.matched),
   checked:items.length,items,releaseDecision:'NO_GO'};
}
export function buildFiles(draft,{sourceAudit=null}={}){
 const plan=makeBuildPlan(draft,{sourceAudit});
 const safeName=draft.facilityCode??'new_customer';
 // Client-sensitive identifiers stay local and are never written to a public repository by this tool.
 const checklist=['# DPRO CAR02 お客様専用構築チェック','',
  `管理用識別子: ${safeName}`,'',
  '## ステージングで実際に確認すること',...plan.pendingGates.map((g,i)=>`${i+1}. [ ] ${g.id} — 証拠未確認`),'',
  '## 判定','公開: NO_GO','DB移行: HOLD','',
  '※ チェックを手作業で付けても公開を自動許可しません。','※ 公開には別途承認・復元・実機証拠が必要です。',''].join('\n');
 const go=['# DPRO CAR02 納品対象・作業順序','',
  '選択した提供機能:',...plan.selected.map(x=>`- ${x.service}: ${x.entry} (確認用原本) — ${x.note}`),'',
  '受注準備の次工程:',...plan.workSequence,'',
  '次回の改善反映:',...plan.adoption.map(x=>`- ${x.id} (${x.from}) — ${x.apply}`),'',
  '本番Worker・DB・LINEをこのパッケージから操作しません。',''].join('\n');
 const manifest={schema:'CAR02_DELIVERY_OUTPUT_MANIFEST_V1',facilityCode:safeName,
  files:['DELIVERY_PLAN.json','CHECKLIST.md','BUILD_STEPS.md'],
  releaseDecision:'NO_GO',migrationDecision:'HOLD',noLiveOperation:true};
 const contents={
  'DELIVERY_PLAN.json':JSON.stringify(plan,null,2)+'\n',
  'CHECKLIST.md':checklist,
  'BUILD_STEPS.md':go
 };
 manifest.sha256=Object.fromEntries(Object.entries(contents).map(([name,c])=>[name,sha256(c)]));
 contents['MANIFEST_SHA256.json']=JSON.stringify(manifest,null,2)+'\n';
 return Object.freeze({plan,contents});
}
export async function auditWorkingTree(repoRoot){
 if(typeof repoRoot!=='string'||!path.isAbsolute(repoRoot))fail('REPO_PATH');
 const sources={};
 for(const name of Object.keys(PINNED)){
  try{const raw=await readFile(path.join(repoRoot,name),'utf8');sources[name]=raw;}
  catch {return {schema:'CAR02_PINNED_SOURCE_AUDIT_V1',allMatch:false,checked:0,
    missing:name,items:[],releaseDecision:'NO_GO'};}
 }
 return auditSourceText(sources);
}
export async function writeBuildPack(outdir,draft,{repoRoot=null}={}){
 if(typeof outdir!=='string'||!path.isAbsolute(outdir))fail('OUT_PATH');
 const norm=path.resolve(outdir);if(norm==='/'||norm===path.parse(norm).root)fail('OUT_ROOT');
 const sourceAudit=repoRoot?await auditWorkingTree(repoRoot):null;
 if(repoRoot && sourceAudit?.allMatch!==true)fail('PINNED_SOURCE_DRIFT');
 const {plan,contents}=buildFiles(draft,{sourceAudit});
 // Prevent accidental overwrite of someone else's prior customer pack or a symlink.
 try{const meta=await lstat(norm);if(!meta.isDirectory()||meta.isSymbolicLink()||(await readdir(norm)).length)fail('OUT_EXISTS');}
 catch(e){if(e?.code!=='ENOENT')throw e;}
 await mkdir(norm,{recursive:true});
 for(const [name,content] of Object.entries(contents)){
  await writeFile(path.join(norm,name),content,{flag:'wx',mode:0o600});
 }
 return {plan,outdir:norm,generatedFiles:Object.keys(contents)};
}
const asScript=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(asScript){
 try{
  const args=process.argv.slice(2);const values={};
  if(args.length<4||args.length%2)fail('CLI_ARGS');
  for(let i=0;i<args.length;i+=2){if(!['--intake','--out','--repo'].includes(args[i])||values[args[i]])fail('CLI_ARGS');values[args[i]]=args[i+1];}
  if(!values['--intake']||!values['--out'])fail('CLI_REQUIRED');
  if(Object.values(values).some(v=>v==='--intake'||v==='--out'||v==='--repo'))fail('CLI_ARGS');
  const raw=await readFile(values['--intake'],'utf8');if(Buffer.byteLength(raw,'utf8')>12000)fail('INTAKE_TOO_LARGE');
  const data=JSON.parse(raw);
  const result=await writeBuildPack(path.resolve(values['--out']),data,{repoRoot:values['--repo']?path.resolve(values['--repo']):null});
  console.log(JSON.stringify({ok:true,scope:'OFFLINE_ONLY',files:result.generatedFiles,
   sourceState:result.plan.sourceState,releaseDecision:result.plan.releaseDecision,
   customerGoLiveReady:false},null,2));
 }catch(e){console.error(e?.code||'CAR02_FACTORY_INPUT_DENIED');process.exitCode=1;}
}

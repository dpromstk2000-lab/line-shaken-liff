/**
 * DPRO CAR02 R126 / OFFLINE synthetic chain snapshot attestation.
 * This is neither a real DB backup verification nor production signing.
 * Signature's public key MUST be independently trusted in a future implementation.
 * All records are synthetic R123 decisions. No network, DB, Storage or Worker.
 */
import assert from 'node:assert/strict';
import {createHash, sign, verify, generateKeyPairSync} from 'node:crypto';

export const POLICY=Object.freeze({version:'R126',sourceVersion:'R125',sourceDb:'car02_r125_qa_ci',release:'NO_GO',migration:'HOLD',productionReady:false,storageTested:false,realAuthTested:false});
const HEX=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const SHOPS=new Set(['shop_a','shop_b']);
const h=s=>createHash('sha256').update(s,'utf8').digest('hex');
const canonical=x=>JSON.stringify(x);
function require_(condition,code){if(!condition)throw Error('R126_'+code)}
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
function exactKeys(value,keys,code){require_(value&&typeof value==='object'&&!Array.isArray(value),code);require_(Object.keys(value).length===keys.length&&keys.every(k=>own(value,k)),code)}
function verifyOriginalRecord(record){
 require_(record&&typeof record==='object'&&!Array.isArray(record),'RECORD');
 require_(Object.keys(record).length===20,'RECORD_FIELDS');
 require_(record.version==='R123'&&record.release==='NO_GO'&&record.migration==='HOLD','RELEASE');
 require_(record.quarantineState==='QUARANTINED'&&record.decision==='MANUAL_STAGING_VALIDATION_PENDING','QUARANTINE');
 for(const field of ['mutationAllowed','deleteAllowed','markReadyAllowed','realStorageTested','realAuthTested']) require_(record[field]===false,'NO_MUTATION');
 require_(SHOPS.has(record.shop)&&UUID.test(record.intentKey)&&UUID.test(record.evidenceId),'RECORD_ID');
 require_(Number.isInteger(record.quarantineRevision)&&record.quarantineRevision>=1,'REVISION');
 require_(HEX.test(record.recordHash),'RECORD_HASH_FORMAT');
 // JavaScript JSON.stringify preserves the R123 record property order.
 const body=Object.fromEntries(Object.entries(record).filter(([k])=>k!=='recordHash'));
 require_(h(canonical(body))===record.recordHash,'RECORD_HASH');
 require_(Array.isArray(record.reviewers)&&record.reviewers.length===2,'REVIEWERS');
 const rev=record.reviewers;
 require_(rev.every(r=>UUID.test(r.reviewId)&&['staff','owner'].includes(r.role)&&r.decision==='request_manual_staging_validation')&&rev.some(r=>r.role==='owner')&&rev[0].subject!==rev[1].subject&&rev[0].reviewId!==rev[1].reviewId,'REVIEW_INDEPENDENCE');
 return true;
}
/** Rows represent extracted synthetic R125 ledger data (not a live SQL query). */
export function createSyntheticRows(records){
 require_(Array.isArray(records)&&records.length>0&&records.length<=50,'COUNT');
 let prev='0'.repeat(64);
 return records.map((record,i)=>{
  verifyOriginalRecord(record);
  const eventHash=h(`${prev}:${record.recordHash}:${record.shop}:${record.intentKey}:${record.quarantineRevision}`);
  const row={seq:i+1,shop:record.shop,intentKey:record.intentKey,revision:record.quarantineRevision,
   evidenceId:record.evidenceId,recordHash:record.recordHash,payload:canonical(record),
   previousHash:prev,eventHash,reviewerIds:record.reviewers.map(x=>x.reviewId),
   auditAction:'MANUAL_STAGING_VALIDATION_PENDING'};
  prev=eventHash; return row;
 });
}
const KEYS=['seq','shop','intentKey','revision','evidenceId','recordHash','payload','previousHash','eventHash','reviewerIds','auditAction'];
export function inspectSyntheticRows(rows){
 require_(Array.isArray(rows)&&rows.length>0&&rows.length<=50,'ROWS');
 let prev='0'.repeat(64);const keys=new Set(), evidence=new Set(), reviewers=new Set(), shops={shop_a:0,shop_b:0};
 for(let i=0;i<rows.length;i++){
  const r=rows[i];exactKeys(r,KEYS,'ROW_SHAPE');
  require_(r.seq===i+1,'SEQ');
  require_(typeof r.payload==='string','PAYLOAD');
  let doc;try{doc=JSON.parse(r.payload)}catch{throw Error('R126_PAYLOAD_JSON')}
  require_(canonical(doc)===r.payload,'PAYLOAD_CANONICAL');verifyOriginalRecord(doc);
  require_(r.shop===doc.shop&&r.intentKey===doc.intentKey&&r.revision===doc.quarantineRevision&&r.evidenceId===doc.evidenceId&&r.recordHash===doc.recordHash,'ROW_BINDING');
  require_(r.previousHash===prev,'CHAIN_PREV');
  const computed=h(`${prev}:${r.recordHash}:${r.shop}:${r.intentKey}:${r.revision}`);
  require_(r.eventHash===computed,'CHAIN_HASH');
  require_(r.auditAction==='MANUAL_STAGING_VALIDATION_PENDING','AUDIT_ACTION');
  require_(Array.isArray(r.reviewerIds)&&r.reviewerIds.length===2&&r.reviewerIds.every((id,j)=>id===doc.reviewers[j].reviewId),'REVIEW_LINKS');
  const requestKey=`${r.shop}/${r.intentKey}/${r.revision}`,evidenceKey=`${r.shop}/${r.evidenceId}`;
  require_(!keys.has(requestKey)&&!evidence.has(evidenceKey),'DUPLICATE'); keys.add(requestKey);evidence.add(evidenceKey);
  for(const id of r.reviewerIds){const k=`${r.shop}/${id}`;require_(!reviewers.has(k),'REVIEW_REUSE');reviewers.add(k)}
  shops[r.shop]++;prev=r.eventHash;
 }
 return {count:rows.length,head:prev,shops};
}
const MANIFEST_KEYS=['version','sourceVersion','sourceDb','release','migration','productionReady','storageTested','realAuthTested','snapshotId','createdAtMs','expiresAtMs','count','shops','chainHead','snapshotDigest'];
export function makeManifest(rows,{snapshotId,createdAtMs,expiresAtMs}){
 const c=inspectSyntheticRows(rows);
 require_(typeof snapshotId==='string'&&/^r126-[a-z0-9-]{12,56}$/.test(snapshotId),'SNAPSHOT_ID');
 require_(Number.isSafeInteger(createdAtMs)&&createdAtMs>=0&&Number.isSafeInteger(expiresAtMs)&&expiresAtMs>createdAtMs&&expiresAtMs-createdAtMs<=86400000,'TIME_WINDOW');
 return {...POLICY,snapshotId,createdAtMs,expiresAtMs,count:c.count,shops:c.shops,chainHead:c.head,snapshotDigest:h(canonical(rows))};
}
export function ephemeralTestKeys(){return generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})}
export function signSyntheticManifest(manifest,privateKey){exactKeys(manifest,MANIFEST_KEYS,'MANIFEST_KEYS');const payload=canonical(manifest);const signature=sign(null,Buffer.from(payload),privateKey).toString('base64url');return {manifest,signature}}
/** trustedPublicKey is provided by a trusted verification channel, not by the bundle itself. */
export function verifySyntheticBundle(bundle,rows,{trustedPublicKey,nowMs,expectedSnapshotId,expectedSourceDb='car02_r125_qa_ci'}){
 exactKeys(bundle,['manifest','signature'],'BUNDLE_SHAPE');
 exactKeys(bundle.manifest,MANIFEST_KEYS,'MANIFEST_KEYS');
 const m=bundle.manifest;
 require_(typeof trustedPublicKey==='string'&&trustedPublicKey.includes('BEGIN PUBLIC KEY'),'TRUSTED_KEY');
 require_(typeof bundle.signature==='string'&&/^[A-Za-z0-9_-]{80,100}$/.test(bundle.signature),'SIGNATURE_FORMAT');
 let valid=false;try{valid=verify(null,Buffer.from(canonical(m)),trustedPublicKey,Buffer.from(bundle.signature,'base64url'))}catch{valid=false}
 require_(valid,'SIGNATURE');
 for(const [k,v] of Object.entries(POLICY))require_(m[k]===v,'POLICY');
 require_(m.sourceDb===expectedSourceDb,'SOURCE_DB');
 require_(m.snapshotId===expectedSnapshotId,'SNAPSHOT_ID');
 require_(Number.isSafeInteger(nowMs)&&nowMs>=m.createdAtMs&&nowMs<=m.expiresAtMs&&m.expiresAtMs-m.createdAtMs<=86400000,'EXPIRED');
 const c=inspectSyntheticRows(rows);
 require_(m.count===c.count&&m.chainHead===c.head,'CHAIN_ANCHOR');
 require_(m.shops&&m.shops.shop_a===c.shops.shop_a&&m.shops.shop_b===c.shops.shop_b&&Object.keys(m.shops).length===2,'TENANT_COUNTS');
 require_(m.snapshotDigest===h(canonical(rows)),'SNAPSHOT_DIGEST');
 return {status:'VERIFIED_SYNTHETIC_ONLY',count:c.count,shops:c.shops,chainHead:c.head,release:'NO_GO',migration:'HOLD',productionReady:false};
}

/**
 * CAR02 V4.57 OFFLINE signed cross-ledger evidence export contract.
 * Source: V456 read-only consistency + V457 digest of complete disposable rows.
 * NOT independent WORM, LINE delivery, provider session proof or production IAM.
 * Public key pin, key custody and monotonic cursor require INDEPENDENT services;
 * all are synthetic fixtures here. R44/R46/R50/R52 remain HARD RELEASE LOCKED.
 * NEVER DEPLOY OR CLAIM BUSINESS DELIVERY.
 */
import {createHash, createPrivateKey, createPublicKey, sign, verify} from 'node:crypto';
export const CAR02_V457_RELEASE_LOCK = true;
export const CAR02_V457_READ_SQL =
 'SELECT event_id,integrity_state,review_stage,audit_steps,evidence_sha256 FROM v457_private.qa_review_evidence($1::text,$2::uuid)';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const KEY_ID=/^[A-Za-z0-9_-]{3,64}$/;
const ZERO='0'.repeat(64);
const isUuid=s=>typeof s==='string'&&UUID.test(s);
const isEpoch=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;
const isSeq=n=>Number.isSafeInteger(n)&&n>0&&n<Number.MAX_SAFE_INTEGER;
const hash=data=>createHash('sha256').update(data).digest('hex');
const deny=()=>{const e=Error('CAR02_EVIDENCE_UNVERIFIED');e.code='CAR02_EVIDENCE_UNVERIFIED';e.status=403;throw e;};
const fields=['v','shopCode','eventId','integrityState','reviewStage','auditSteps','evidenceSha256','keyId','keyEpoch','sequence','previousDigest','signedAtMs'];
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&
 Object.keys(v).sort().join('|')===keys.slice().sort().join('|');
function validPayload(p){return exact(p,fields)&&p.v===457&&typeof p.shopCode==='string'&&SHOP.test(p.shopCode)&&
 isUuid(p.eventId)&&p.integrityState==='consistent_closed'&&p.reviewStage==='closed_without_delivery_assertion'&&
 p.auditSteps===2&&typeof p.evidenceSha256==='string'&&HEX.test(p.evidenceSha256)&&
 typeof p.keyId==='string'&&KEY_ID.test(p.keyId)&&isEpoch(p.keyEpoch)&&isSeq(p.sequence)&&
 typeof p.previousDigest==='string'&&HEX.test(p.previousDigest)&&
 Number.isSafeInteger(p.signedAtMs)&&p.signedAtMs>0;}
function canonical(p){return Buffer.from(JSON.stringify(fields.map(k=>p[k])),'utf8');}
function edPrivate(k){try{const a=k?.type==='private'?k:createPrivateKey(k);return a?.type==='private'&&a.asymmetricKeyType==='ed25519'?a:null;}catch{return null;}}
function edPublic(k){try{const a=k?.type==='public'?k:createPublicKey(k);return a?.type==='public'&&a.asymmetricKeyType==='ed25519'?a:null;}catch{return null;}}
function verifyEnvelopeStructure(e){return exact(e,['payload','signature','envelopeDigest'])&&validPayload(e.payload)&&
 typeof e.signature==='string'&&/^[A-Za-z0-9_-]{86}$/.test(e.signature)&&
 typeof e.envelopeDigest==='string'&&HEX.test(e.envelopeDigest);}
/** Operator identity, signer private-key custody and snapshot provider are OFFLINE mocks. */
export function createCar02OfflineReviewEvidenceSealR457({readSnapshot,authorizeAuditor,privateKey,keyId,keyEpoch,nowMs=()=>Date.now()}={}){
 const sk=edPrivate(privateKey);
 if(CAR02_V457_RELEASE_LOCK!==true||typeof readSnapshot!=='function'||typeof authorizeAuditor!=='function'||
  !sk||typeof keyId!=='string'||!KEY_ID.test(keyId)||!isEpoch(keyEpoch)||typeof nowMs!=='function')
  throw Error('CAR02_V457_OFFLINE_TRUSTED_SIGNER_REQUIRED');
 async function seal({request,eventId,sequence,previousDigest=ZERO}={}){
  try{
   if(!isUuid(eventId)||!isSeq(sequence)||typeof previousDigest!=='string'||!HEX.test(previousDigest))deny();
   const op=await authorizeAuditor({request});
   if(op?.verified!==true||op.mode!=='isolated_qa'||op.role!=='auditor'||typeof op.shopCode!=='string'||!SHOP.test(op.shopCode))deny();
   const result=await readSnapshot({sql:CAR02_V457_READ_SQL,params:[op.shopCode,eventId]});
   if(!Array.isArray(result?.rows)||result.rows.length!==1)deny();
   const r=result.rows[0];
   if(!exact(r,['event_id','integrity_state','review_stage','audit_steps','evidence_sha256'])||
      r.event_id!==eventId||r.integrity_state!=='consistent_closed'||
      r.review_stage!=='closed_without_delivery_assertion'||r.audit_steps!==2||
      typeof r.evidence_sha256!=='string'||!HEX.test(r.evidence_sha256))deny();
   const now=nowMs();if(!Number.isSafeInteger(now)||now<=0)deny();
   const payload=Object.freeze({v:457,shopCode:op.shopCode,eventId,integrityState:r.integrity_state,
    reviewStage:r.review_stage,auditSteps:2,evidenceSha256:r.evidence_sha256,
    keyId,keyEpoch,sequence,previousDigest,signedAtMs:now});
   const signature=sign(null,canonical(payload),sk).toString('base64url');
   const envelopeDigest=hash(Buffer.concat([canonical(payload),Buffer.from('.'+signature)]));
   return Object.freeze({payload,signature,envelopeDigest});
  }catch{deny();}
 }
 return Object.freeze({seal});
}
/** expected cursor is OWNED externally; verification does not advance or persist it. */
export function verifyCar02OfflineReviewEvidenceR457({envelope,expectedShopCode,expectedEventId,
 pinnedPublicKey,expectedKeyId,minimumKeyEpoch,expectedSequence,expectedPreviousDigest,
 nowMs=Date.now(),maxAgeMs=300000}={}){
 try{
  const pk=edPublic(pinnedPublicKey),p=envelope?.payload;
  if(!pk||!verifyEnvelopeStructure(envelope)||!SHOP.test(expectedShopCode)||!isUuid(expectedEventId)||
   typeof expectedKeyId!=='string'||!KEY_ID.test(expectedKeyId)||!isEpoch(minimumKeyEpoch)||
   !isSeq(expectedSequence)||typeof expectedPreviousDigest!=='string'||!HEX.test(expectedPreviousDigest)||
   !Number.isSafeInteger(nowMs)||nowMs<=0||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<=0)deny();
  if(p.shopCode!==expectedShopCode||p.eventId!==expectedEventId||p.keyId!==expectedKeyId||
    p.keyEpoch<minimumKeyEpoch||p.sequence!==expectedSequence||
    p.previousDigest!==expectedPreviousDigest||p.signedAtMs>nowMs||
    nowMs-p.signedAtMs>maxAgeMs)deny();
  const bytes=canonical(p);
  const sig=Buffer.from(envelope.signature,'base64url');
  if(sig.length!==64||!verify(null,bytes,pk,sig)||
     envelope.envelopeDigest!==hash(Buffer.concat([bytes,Buffer.from('.'+envelope.signature)])))deny();
  return Object.freeze({status:'verified_review_only',envelopeDigest:envelope.envelopeDigest});
 }catch{deny();}
}

/**
 * CAR02 V4.58 — OFFLINE independent witness checkpoint verifier.
 * V457 publisher signatures can be replayed if the publisher owns the cursor.
 * This verifier requires a SECOND Ed25519 trust domain and an independently
 * stored, CURRENT checkpoint/cursor; envelope-supplied cursor is NOT authority.
 * Both signer and witness private keys in tests are ephemeral synthetic keys.
 * Store/IAM/separate custody must be built and audited before production.
 * No LINE delivery, Supabase Auth, Worker, shared database, or production wiring.
 * The original R52 release lock remains TRUE. NEVER DEPLOY.
 */
import {createHash,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {verifyCar02OfflineReviewEvidenceR457} from './car02-review-evidence-seal-r457.mjs';
export const CAR02_V458_RELEASE_LOCK=true;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const ID=/^[A-Za-z0-9_-]{3,64}$/;
const N=n=>Number.isSafeInteger(n)&&n>0&&n<Number.MAX_SAFE_INTEGER;
const KEYS=['v','shopCode','eventId','envelopeDigest','evidenceSequence','evidencePreviousDigest','evidenceKeyEpoch','witnessSequence','previousWitnessDigest','witnessKeyId','witnessKeyEpoch','witnessedAtMs'];
const eq=(x,k)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype&&Object.keys(x).sort().join('|')===k.slice().sort().join('|');
const canonical=p=>Buffer.from(JSON.stringify(KEYS.map(k=>p[k])),'utf8');
const sha=b=>createHash('sha256').update(b).digest('hex');
const denied=()=>{const e=new Error('CAR02_WITNESS_UNVERIFIED');e.code='CAR02_WITNESS_UNVERIFIED';e.status=403;throw e;};
function edkey(key,kind){try{const k=key?.type===kind?key:(kind==='private'?createPrivateKey(key):createPublicKey(key));return k?.asymmetricKeyType==='ed25519'&&k.type===kind?k:null;}catch{return null;}}
function validPayload(p){return eq(p,KEYS)&&p.v===458&&typeof p.shopCode==='string'&&SHOP.test(p.shopCode)&&
 typeof p.eventId==='string'&&UUID.test(p.eventId)&&
 typeof p.envelopeDigest==='string'&&HEX.test(p.envelopeDigest)&&N(p.evidenceSequence)&&
 typeof p.evidencePreviousDigest==='string'&&HEX.test(p.evidencePreviousDigest)&&N(p.evidenceKeyEpoch)&&
 N(p.witnessSequence)&&typeof p.previousWitnessDigest==='string'&&HEX.test(p.previousWitnessDigest)&&
 typeof p.witnessKeyId==='string'&&ID.test(p.witnessKeyId)&&N(p.witnessKeyEpoch)&&N(p.witnessedAtMs);}
function validCheckpoint(c){return eq(c,['payload','signature','checkpointDigest'])&&validPayload(c.payload)&&
 typeof c.signature==='string'&&/^[A-Za-z0-9_-]{86}$/.test(c.signature)&&
 typeof c.checkpointDigest==='string'&&HEX.test(c.checkpointDigest);}
/** OFFLINE ONLY: creates synthetic witness attestation for deterministic QA. */
export function signCar02OfflineCheckpointR458({envelope,privateKey,witnessKeyId,witnessKeyEpoch,
 witnessSequence,previousWitnessDigest,witnessedAtMs}={}){
 const p=envelope?.payload,sk=edkey(privateKey,'private');
 if(!sk||typeof witnessKeyId!=='string'||!ID.test(witnessKeyId)||!N(witnessKeyEpoch)||!N(witnessSequence)||
  !HEX.test(previousWitnessDigest??'')||!N(witnessedAtMs)||
  !p||typeof envelope.envelopeDigest!=='string'||!HEX.test(envelope.envelopeDigest))
  throw Error('CAR02_V458_OFFLINE_WITNESS_INPUT_REQUIRED');
 const payload={v:458,shopCode:p.shopCode,eventId:p.eventId,envelopeDigest:envelope.envelopeDigest,
   evidenceSequence:p.sequence,evidencePreviousDigest:p.previousDigest,evidenceKeyEpoch:p.keyEpoch,
   witnessSequence,previousWitnessDigest,witnessKeyId,witnessKeyEpoch,witnessedAtMs};
 if(!validPayload(payload))throw Error('CAR02_V458_OFFLINE_WITNESS_INPUT_REQUIRED');
 const sig=sign(null,canonical(payload),sk).toString('base64url');
 const checkpointDigest=sha(Buffer.concat([canonical(payload),Buffer.from('.'+sig)]));
 return Object.freeze({payload:Object.freeze(payload),signature:sig,checkpointDigest});
}
/**
 * trustedRead MUST be server-owned and read from INDEPENDENT witness storage.
 * It returns {checkpoint,cursor}; cursor is separately persisted CURRENT state,
 * never caller-supplied. This prototype cannot guarantee that independence.
 */
export function createCar02OfflineWitnessVerifierR458({trustedRead,pinnedEvidencePublicKey,
 pinnedWitnessPublicKey,expectedEvidenceKeyId,minEvidenceKeyEpoch,expectedWitnessKeyId,
 minWitnessKeyEpoch,nowMs=()=>Date.now(),maxAgeMs=300000}={}){
 if(!CAR02_V458_RELEASE_LOCK||typeof trustedRead!=='function'||
  !edkey(pinnedEvidencePublicKey,'public')||!edkey(pinnedWitnessPublicKey,'public')||
  typeof expectedEvidenceKeyId!=='string'||!ID.test(expectedEvidenceKeyId)||
  typeof expectedWitnessKeyId!=='string'||!ID.test(expectedWitnessKeyId)||
  !N(minEvidenceKeyEpoch)||!N(minWitnessKeyEpoch)||typeof nowMs!=='function'||
  !N(maxAgeMs))throw Error('CAR02_V458_INDEPENDENT_TRUST_REQUIRED');
 async function verifyEvidence({shopCode,eventId,envelope}={}){
  try{
   if(typeof shopCode!=='string'||!SHOP.test(shopCode)||typeof eventId!=='string'||!UUID.test(eventId))denied();
   const reading=await trustedRead({shopCode,eventId});
   const c=reading?.checkpoint,st=reading?.cursor,p=c?.payload,now=nowMs();
   if(!validCheckpoint(c)||!st||!eq(st,['sequence','digest','previousDigest'])||
     !N(st.sequence)||!HEX.test(st.digest??'')||!HEX.test(st.previousDigest??'')||
     !N(now)||c.checkpointDigest!==st.digest||p.witnessSequence!==st.sequence||
     p.previousWitnessDigest!==st.previousDigest||p.shopCode!==shopCode||p.eventId!==eventId||
     p.envelopeDigest!==envelope?.envelopeDigest||p.witnessKeyId!==expectedWitnessKeyId||
     p.witnessKeyEpoch<minWitnessKeyEpoch||p.evidenceKeyEpoch<minEvidenceKeyEpoch||
     p.witnessedAtMs>now||now-p.witnessedAtMs>maxAgeMs)denied();
   const witnessSignature=Buffer.from(c.signature,'base64url');
   if(witnessSignature.length!==64||!verify(null,canonical(p),pinnedWitnessPublicKey,witnessSignature)||
      c.checkpointDigest!==sha(Buffer.concat([canonical(p),Buffer.from('.'+c.signature)])))denied();
   verifyCar02OfflineReviewEvidenceR457({envelope,expectedShopCode:shopCode,expectedEventId:eventId,
      pinnedPublicKey:pinnedEvidencePublicKey,expectedKeyId:expectedEvidenceKeyId,
      minimumKeyEpoch:minEvidenceKeyEpoch,expectedSequence:p.evidenceSequence,
      expectedPreviousDigest:p.evidencePreviousDigest,nowMs:now,maxAgeMs});
   if(envelope.payload.keyEpoch!==p.evidenceKeyEpoch)denied();
   return Object.freeze({status:'witnessed_review_only',checkpointDigest:c.checkpointDigest,
      witnessSequence:p.witnessSequence});
  }catch{denied()}
 }
 return Object.freeze({verifyEvidence});
}

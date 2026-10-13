/**
 * DPRO CAR02 R127 / OFFLINE ONLY: independent trust, snapshot key rotation,
 * revocation and anti-rollback for synthetic R126 audit checkpoints.
 * This models a read-only VERIFICATION policy, never a live key service.
 * Pinned auditor public keys and minimum-checkpoint pin MUST arrive separately.
 * No persistence, API, database, network, object Storage, or production mutation.
 */
import {createHash, createPublicKey, sign, verify} from 'node:crypto';
import {verifySyntheticBundle} from './car02-r126-signed-chain-isolated.mjs';

const fatal=(code)=>{throw Error('R127_'+code)};
const must=(ok,code)=>{if(!ok)fatal(code)};
const hash=(s)=>createHash('sha256').update(s,'utf8').digest('hex');
const HEX=/^[0-9a-f]{64}$/;
const ID=/^r126-[a-z0-9-]{12,56}$/;
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
function shape(x,fields,code){must(x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===fields.length&&fields.every(k=>own(x,k)),code)}
const ENTRY_FIELDS=['version','epoch','previousHash','createdAtMs','expiresAtMs','action','snapshotId','signingKeyId','signingPublicKey','snapshotDigest','chainHead','count','shops','revokedKeys','release','migration','productionReady','storageTested','realAuthTested'];
const RECORD_FIELDS=['checkpoint','auditorSignatures'];
const SIGNER_FIELDS=['auditorId','signature'];
const AUDITORS=['auditorA','auditorB'];
const encode=x=>JSON.stringify(x);
export const POLICY=Object.freeze({release:'NO_GO',migration:'HOLD',productionReady:false,storageTested:false,realAuthTested:false});
export function publicKeyId(pem){
 must(typeof pem==='string','PUBLIC_KEY_FORMAT');
 let key;try{key=createPublicKey(pem)}catch{fatal('PUBLIC_KEY_FORMAT')}
 must(key.asymmetricKeyType==='ed25519','PUBLIC_KEY_TYPE');
 return hash(key.export({type:'spki',format:'der'}).toString('base64'));
}
function validateKeyMap(trustedAuditors){
 shape(trustedAuditors,AUDITORS,'TRUST_CONFIG');
 must(publicKeyId(trustedAuditors.auditorA)!==publicKeyId(trustedAuditors.auditorB),'TRUST_INDEPENDENCE');
}
export function createCheckpoint({epoch,previousHash,createdAtMs,expiresAtMs,action,manifest=null,signingPublicKey=null,revokedKeys=[]}){
 must(Number.isSafeInteger(epoch)&&epoch>=1,'EPOCH');
 must(typeof previousHash==='string'&&HEX.test(previousHash),'PREVIOUS_HASH');
 must(Number.isSafeInteger(createdAtMs)&&Number.isSafeInteger(expiresAtMs)&&createdAtMs>=0&&expiresAtMs>createdAtMs&&expiresAtMs-createdAtMs<=86_400_000,'WINDOW');
 must(action==='ANCHOR'||action==='REVOKE','ACTION');
 must(Array.isArray(revokedKeys)&&revokedKeys.length<=10&&new Set(revokedKeys).size===revokedKeys.length&&revokedKeys.every(x=>typeof x==='string'&&HEX.test(x)),'REVOKE_LIST');
 let anchor={snapshotId:null,signingKeyId:null,signingPublicKey:null,snapshotDigest:null,chainHead:null,count:null,shops:null};
 if(action==='ANCHOR'){
  must(revokedKeys.length===0&&manifest!==null&&signingPublicKey!==null,'ANCHOR_INPUT');
  must(manifest.version==='R126'&&manifest.release==='NO_GO'&&manifest.migration==='HOLD'&&manifest.productionReady===false&&manifest.storageTested===false&&manifest.realAuthTested===false,'MANIFEST_POLICY');
  must(ID.test(manifest.snapshotId)&&HEX.test(manifest.snapshotDigest)&&HEX.test(manifest.chainHead),'MANIFEST_SHAPE');
  must(Number.isInteger(manifest.count)&&manifest.count>0&&manifest.count<=50&&manifest.shops&&Number.isInteger(manifest.shops.shop_a)&&Number.isInteger(manifest.shops.shop_b)&&Object.keys(manifest.shops).length===2,'MANIFEST_SHOPS');
  anchor={snapshotId:manifest.snapshotId,signingKeyId:publicKeyId(signingPublicKey),signingPublicKey,snapshotDigest:manifest.snapshotDigest,chainHead:manifest.chainHead,count:manifest.count,shops:{shop_a:manifest.shops.shop_a,shop_b:manifest.shops.shop_b}};
 }else must(manifest===null&&signingPublicKey===null&&revokedKeys.length>0,'REVOKE_INPUT');
 return {version:'R127',epoch,previousHash,createdAtMs,expiresAtMs,action,...anchor,revokedKeys:[...revokedKeys],...POLICY};
}
export function cosignCheckpoint(checkpoint,privateAuditors){
 shape(checkpoint,ENTRY_FIELDS,'CHECKPOINT_SHAPE');
 shape(privateAuditors,AUDITORS,'TEST_SIGNERS');
 // PRIVATE AUDITOR KEYS ARE ONLY EPHEMERAL FIXTURES IN CI. Never ship or store them.
 const payload=Buffer.from(encode(checkpoint));
 return {checkpoint,auditorSignatures:AUDITORS.map(auditorId=>({auditorId,signature:sign(null,payload,privateAuditors[auditorId]).toString('base64url')}))};
}
export const checkpointHash=record=>hash(encode(record));
function verifyEntry(record,trustedAuditors){
 shape(record,RECORD_FIELDS,'RECORD_SHAPE');
 shape(record.checkpoint,ENTRY_FIELDS,'CHECKPOINT_SHAPE');
 must(Array.isArray(record.auditorSignatures)&&record.auditorSignatures.length===2,'SIGNATURE_QUORUM');
 const payload=Buffer.from(encode(record.checkpoint));
 for(let i=0;i<AUDITORS.length;i++){
  const s=record.auditorSignatures[i];shape(s,SIGNER_FIELDS,'SIGNATURE_SHAPE');
  must(s.auditorId===AUDITORS[i]&&typeof s.signature==='string'&&/^[A-Za-z0-9_-]{80,100}$/.test(s.signature),'SIGNATURE_QUORUM');
  let result=false;try{result=verify(null,payload,trustedAuditors[s.auditorId],Buffer.from(s.signature,'base64url'))}catch{result=false}
  must(result,'AUDITOR_SIGNATURE');
 }
 const c=record.checkpoint;
 must(c.version==='R127'&&c.release==='NO_GO'&&c.migration==='HOLD'&&c.productionReady===false&&c.storageTested===false&&c.realAuthTested===false,'POLICY');
 must(Number.isSafeInteger(c.epoch)&&c.epoch>0&&HEX.test(c.previousHash),'CHECKPOINT_ID');
 must(Number.isSafeInteger(c.createdAtMs)&&Number.isSafeInteger(c.expiresAtMs)&&c.createdAtMs>=0&&c.expiresAtMs>c.createdAtMs&&c.expiresAtMs-c.createdAtMs<=86_400_000,'WINDOW');
 must(Array.isArray(c.revokedKeys)&&c.revokedKeys.length<=10&&c.revokedKeys.every(x=>HEX.test(x))&&new Set(c.revokedKeys).size===c.revokedKeys.length,'REVOKE_LIST');
 if(c.action==='ANCHOR'){
  must(c.revokedKeys.length===0&&typeof c.signingPublicKey==='string'&&publicKeyId(c.signingPublicKey)===c.signingKeyId,'ANCHOR_KEY');
  must(ID.test(c.snapshotId)&&HEX.test(c.snapshotDigest)&&HEX.test(c.chainHead)&&Number.isInteger(c.count)&&c.count>0&&c.count<=50,'ANCHOR_FIELDS');
  shape(c.shops,['shop_a','shop_b'],'SHOPS');
  must(Number.isInteger(c.shops.shop_a)&&Number.isInteger(c.shops.shop_b)&&c.shops.shop_a>=0&&c.shops.shop_b>=0&&c.shops.shop_a+c.shops.shop_b===c.count,'SHOPS_COUNT');
 }else if(c.action==='REVOKE'){
  must(c.revokedKeys.length>0&&['snapshotId','signingKeyId','signingPublicKey','snapshotDigest','chainHead','count','shops'].every(k=>c[k]===null),'REVOKE_FIELDS');
 }else fatal('ACTION');
}
/**
 * `trustedAuditors` and `independentPin` come from separately controlled input.
 * The pin binds an already-known epoch hash, detecting rollback/fork at that epoch.
 * A brand-new unpinned chain is not an established historical trust proof.
 */
export function inspectRegistry(records,{trustedAuditors,independentPin,nowMs}){
 validateKeyMap(trustedAuditors);
 must(Array.isArray(records)&&records.length>0&&records.length<=100,'CHAIN_LENGTH');
 shape(independentPin,['epoch','hash'],'INDEPENDENT_PIN');
 must(Number.isSafeInteger(independentPin.epoch)&&independentPin.epoch>0&&HEX.test(independentPin.hash),'INDEPENDENT_PIN');
 must(Number.isSafeInteger(nowMs)&&nowMs>=0,'CLOCK');
 const snapshots=new Set(),revoked=new Set();let prev='0'.repeat(64),lastTime=-1,pinMet=false;
 let current=null;const anchors=[];
 for(let i=0;i<records.length;i++){
  const entry=records[i];verifyEntry(entry,trustedAuditors);
  const c=entry.checkpoint;
  must(c.epoch===i+1,'EPOCH_SEQUENCE');
  must(c.previousHash===prev,'HASH_CHAIN');
  must(c.createdAtMs>=lastTime,'TIME_ORDER');lastTime=c.createdAtMs;
  prev=checkpointHash(entry);
  if(c.epoch===independentPin.epoch){must(prev===independentPin.hash,'PIN_FORK');pinMet=true}
  if(c.action==='REVOKE'){
   for(const keyId of c.revokedKeys){must(!revoked.has(keyId),'DUPLICATE_REVOCATION');revoked.add(keyId)}
  }else{
   must(!snapshots.has(c.snapshotId),'DUPLICATE_SNAPSHOT');snapshots.add(c.snapshotId);
   must(!revoked.has(c.signingKeyId),'KEY_ALREADY_REVOKED');
   current=c;anchors.push(c);
  }
 }
 must(pinMet,'PIN_ROLLBACK');
 must(nowMs>=records.at(-1).checkpoint.createdAtMs&&nowMs<=records.at(-1).checkpoint.expiresAtMs,'EXPIRED_CHECKPOINT');
 must(current!==null,'NO_ANCHOR');
 return {status:'SIGNED_TEST_REGISTRY_ONLY',head:prev,epoch:records.length,lastAnchor:current,revoked,anchors};
}
export function verifyCurrentSyntheticSnapshot(bundle,rows,records,context){
 const state=inspectRegistry(records,context);
 const c=state.lastAnchor;
 must(!state.revoked.has(c.signingKeyId),'KEY_REVOKED');
 must(bundle&&bundle.manifest&&bundle.manifest.snapshotId===c.snapshotId,'SNAPSHOT_MISMATCH');
 must(bundle.manifest.snapshotDigest===c.snapshotDigest&&bundle.manifest.chainHead===c.chainHead&&bundle.manifest.count===c.count&&JSON.stringify(bundle.manifest.shops)===JSON.stringify(c.shops),'ANCHOR_MISMATCH');
 const result=verifySyntheticBundle(bundle,rows,{trustedPublicKey:c.signingPublicKey,nowMs:context.nowMs,expectedSnapshotId:c.snapshotId});
 must(result.productionReady===false,'PRODUCTION');
 return {status:'VERIFIED_SYNTHETIC_WITH_INDEPENDENT_TEST_PIN',epoch:state.epoch,head:state.head,release:'NO_GO',migration:'HOLD',productionReady:false};
}

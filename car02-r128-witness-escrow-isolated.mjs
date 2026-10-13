/**
 * DPRO CAR02 R128: OFFLINE ONLY independent-witness receipt chain and pinned restore.
 * No network, database, Storage, Worker, production credentials, mutation, or deploy.
 * Both witness logs are SYNTHETIC TEST COPIES on the same CI runner. Production
 * separation / durable external anchoring is not established by this module.
 * All trusted public keys, R127 pin, and minimum witness pin MUST arrive via
 * separately controlled channels. A bundle never establishes its own trust.
 */
import {createHash, createPublicKey, sign, verify} from 'node:crypto';
import {inspectRegistry, checkpointHash, publicKeyId} from './car02-r127-independent-trust-isolated.mjs';

export const POLICY=Object.freeze({version:'R128',scope:'CAR02_SYNTHETIC_QA_ONLY',release:'NO_GO',migration:'HOLD',productionReady:false,realStorageTested:false,realDBTested:false,realAuthTested:false});
const WITNESSES=['witnessA','witnessB'];
const ROOT='0'.repeat(64), HEX=/^[0-9a-f]{64}$/;
const PAYLOAD_KEYS=['version','scope','witnessId','epoch','registryHead','previousReceiptHash','observedAtMs','expiresAtMs','release','migration','productionReady','realStorageTested','realDBTested','realAuthTested'];
const fail=code=>{throw Error('R128_'+code)};
const ensure=(ok,code)=>{if(!ok)fail(code)};
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const shape=(x,ks,c)=>ensure(x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===ks.length&&ks.every(k=>own(x,k)),c);
const encode=x=>JSON.stringify(x);
const hash=x=>createHash('sha256').update(encode(x),'utf8').digest('hex');
function publicId(value){let k;try{k=createPublicKey(value)}catch{fail('WITNESS_KEY')};ensure(k.asymmetricKeyType==='ed25519','WITNESS_KEY');return publicKeyId(value)}
function checkTrust(trust){shape(trust,WITNESSES,'TRUST_CONFIG');ensure(publicId(trust.witnessA)!==publicId(trust.witnessB),'NOT_INDEPENDENT');}
export const receiptHash=receipt=>hash(receipt);
export function issueSyntheticWitnessReceipt({witnessId,epoch,registryHead,previousReceiptHash,observedAtMs,expiresAtMs},privateKey){
 ensure(WITNESSES.includes(witnessId),'WITNESS_ID');
 ensure(Number.isSafeInteger(epoch)&&epoch>0&&HEX.test(registryHead)&&HEX.test(previousReceiptHash),'RECEIPT_ID');
 ensure(Number.isSafeInteger(observedAtMs)&&observedAtMs>=0&&Number.isSafeInteger(expiresAtMs)&&expiresAtMs>observedAtMs&&expiresAtMs-observedAtMs<=86_400_000,'TIME_WINDOW');
 const payload={...POLICY,witnessId,epoch,registryHead,previousReceiptHash,observedAtMs,expiresAtMs};
 // Rebuild with explicit property order to ensure canonical byte-identical signing.
 const canonical=Object.fromEntries(PAYLOAD_KEYS.map(k=>[k,payload[k]]));
 let signature;try{signature=sign(null,Buffer.from(encode(canonical)),privateKey).toString('base64url')}catch{fail('SIGN_KEY')}
 return {payload:canonical,signature};
}
function validateRecord(receipt,expectedWitness,expectedEpoch,prev,registryHead,publicKey,previousTime){
 shape(receipt,['payload','signature'],'RECEIPT_SHAPE');shape(receipt.payload,PAYLOAD_KEYS,'PAYLOAD_SHAPE');
 const p=receipt.payload;
 ensure(p.witnessId===expectedWitness&&p.epoch===expectedEpoch&&p.registryHead===registryHead&&p.previousReceiptHash===prev,'RECEIPT_LINK');
 for(const [k,v] of Object.entries(POLICY))ensure(p[k]===v,'POLICY');
 ensure(Number.isSafeInteger(p.observedAtMs)&&p.observedAtMs>=0&&p.observedAtMs>=previousTime,'TIME_ORDER');
 ensure(Number.isSafeInteger(p.expiresAtMs)&&p.expiresAtMs>p.observedAtMs&&p.expiresAtMs-p.observedAtMs<=86_400_000,'TIME_WINDOW');
 ensure(typeof receipt.signature==='string'&&/^[a-zA-Z0-9_-]{80,100}$/.test(receipt.signature),'SIGNATURE_SHAPE');
 let verified=false;try{verified=verify(null,Buffer.from(encode(p)),publicKey,Buffer.from(receipt.signature,'base64url'))}catch{verified=false}
 ensure(verified,'SIGNATURE');
 return p.observedAtMs;
}
/**
 * The minPin is an *out-of-band* witness receipt hash pair for a known epoch.
 * Same-run copies of both witness files do not constitute external independence.
 * Old checkpoints beyond the latest out-of-band pin can still be rolled back.
 */
export function inspectIndependentEscrow({registryRecords,trustedAuditors,r127Pin,receiptChains,trustedWitnesses,minimumWitnessPin,nowMs}){
 checkTrust(trustedWitnesses);
 shape(receiptChains,WITNESSES,'RECEIPT_CHAINS');
 shape(minimumWitnessPin,['epoch','registryHead','receiptHashes'],'MINIMUM_PIN');
 shape(minimumWitnessPin.receiptHashes,WITNESSES,'MINIMUM_PIN');
 ensure(Number.isSafeInteger(minimumWitnessPin.epoch)&&minimumWitnessPin.epoch>=1&&HEX.test(minimumWitnessPin.registryHead)&&WITNESSES.every(w=>HEX.test(minimumWitnessPin.receiptHashes[w])),'MINIMUM_PIN');
 ensure(Number.isSafeInteger(nowMs)&&nowMs>=0,'CLOCK');
 // First, validate actual R127 auditor checkpoint signatures and independent R127 pin.
 const r127=inspectRegistry(registryRecords,{trustedAuditors,independentPin:r127Pin,nowMs});
 ensure(minimumWitnessPin.epoch<=r127.epoch,'ESCROW_ROLLBACK');
 const registryHashes=registryRecords.map(checkpointHash);
 const pinHash=registryHashes[minimumWitnessPin.epoch-1];
 ensure(pinHash===minimumWitnessPin.registryHead,'MINIMUM_FORK');
 const receiptHeads={};
 for(const witnessId of WITNESSES){
  const chain=receiptChains[witnessId];
  ensure(Array.isArray(chain)&&chain.length===r127.epoch,'WITNESS_ROLLBACK');
  let prev=ROOT,previousTime=-1;
  for(let i=0;i<chain.length;i++){
   previousTime=validateRecord(chain[i],witnessId,i+1,prev,registryHashes[i],trustedWitnesses[witnessId],previousTime);
   prev=receiptHash(chain[i]);
   if(i+1===minimumWitnessPin.epoch)ensure(prev===minimumWitnessPin.receiptHashes[witnessId],'PIN_FORK');
  }
  ensure(nowMs>=chain.at(-1).payload.observedAtMs&&nowMs<=chain.at(-1).payload.expiresAtMs,'WITNESS_EXPIRED');
  receiptHeads[witnessId]=prev;
 }
 return {status:'VERIFIED_SYNTHETIC_ESCROW_ONLY',epoch:r127.epoch,registryHead:r127.head,receiptHeads,
  independentlyPinnedEpoch:minimumWitnessPin.epoch,release:'NO_GO',migration:'HOLD',productionReady:false,
  realExternalStorageVerified:false,realAuthVerified:false};
}

/**
 * CAR02 R129, disposable/offline evidence-update simulation ONLY.
 * Two mock files under one temporary directory are NOT two independent stores.
 * No network, Supabase, Worker, Storage, release, or destructive photo actions.
 * Signed R127/R128 proof is checked before accepting an update. This demo
 * deliberately HOLDS any in-doubt/partial update until an identical retry.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectIndependentEscrow,receiptHash} from './car02-r128-witness-escrow-isolated.mjs';
import {checkpointHash} from './car02-r127-independent-trust-isolated.mjs';

export const R129_POLICY=Object.freeze({release:'NO_GO',migration:'HOLD',productionReady:false,realExternalWitnesses:false,realAuthTested:false,realDBTested:false});
const W=['witnessA','witnessB'];
const fail=code=>{throw new Error('R129_'+code)};
const requireOk=(v,code)=>{if(!v)fail(code)};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const isHex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function rootCheck(root){
 requireOk(process.env.R129_OFFLINE_QA==='yes'&&process.env.CAR02_RELEASE_LOCK==='true','ISOLATION_REQUIRED');
 requireOk(typeof root==='string'&&path.isAbsolute(root),'TEMP_ROOT');
 const p=fs.realpathSync(root), tmp=fs.realpathSync(os.tmpdir());
 requireOk(path.dirname(p)===tmp&&path.basename(p).startsWith('car02-r129-'),'TEMP_ROOT');
 return p;
}
function readJson(root,name){
 const p=path.join(root,name);const st=fs.lstatSync(p);
 requireOk(st.isFile()&&!st.isSymbolicLink()&&st.size<=1_000_000,'UNSAFE_FILE');
 return JSON.parse(fs.readFileSync(p,'utf8'));
}
function maybeJson(root,name){try{return readJson(root,name)}catch(e){if(e?.code==='ENOENT')return null;throw e}}
function writeAtomic(root,name,value){
 const p=path.join(root,name),temp=path.join(root,`.r129-${name}-${process.pid}-${Date.now()}.tmp`);
 try{
  const fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  fs.renameSync(temp,p);
  const d=fs.openSync(root,'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
 }finally{if(fs.existsSync(temp))fs.unlinkSync(temp)}
}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function grabLock(root){
 const lock=path.join(root,'.r129-lock');
 try{fs.mkdirSync(lock,0o700)}catch(e){if(e?.code==='EEXIST')fail('LOCKED');throw e}
 return ()=>{fs.rmdirSync(lock)};
}
function candidatePin(registryRecords,chains){
 const epoch=registryRecords.length;
 return {epoch,registryHead:checkpointHash(registryRecords.at(-1)),receiptHashes:Object.fromEntries(W.map(w=>[w,receiptHash(chains[w].at(-1))]))};
}
function inspect({registryRecords,trustedAuditors,r127Pin,receiptChains,trustedWitnesses,minimumWitnessPin,nowMs}){
 return inspectIndependentEscrow({registryRecords,trustedAuditors,r127Pin,receiptChains,trustedWitnesses,minimumWitnessPin,nowMs});
}
export function readVerifiedEscrow({root,...proof}){
 const dir=rootCheck(root);
 const intent=maybeJson(dir,'intent.json');
 requireOk(!intent||intent.status==='DONE','PENDING_MANUAL_HOLD');
 const receiptChains=Object.fromEntries(W.map(w=>[w,readJson(dir,`${w}.json`)]));
 const result=inspect({...proof,receiptChains});
 return {...result,operationStatus:intent?'DONE':'GENESIS',...R129_POLICY};
}
/**
 * signed additions and auditor registry come from trusted, separately controlled
 * test input. No private signing keys are ever needed by this module.
 * An external updated minimum pin MUST be published before any later change;
 * a returned candidate pin is not itself independently trusted.
 */
export function applySignedEscrowEpoch({root,operationId,registryRecords,trustedAuditors,r127Pin,trustedWitnesses,minimumWitnessPin,nowMs,newReceipts,injectFailure=null}){
 const dir=rootCheck(root);
 requireOk(typeof operationId==='string'&&/^r129-[a-z0-9-]{5,64}$/.test(operationId),'OPERATION_ID');
 requireOk(injectFailure===null||['AFTER_INTENT','AFTER_A','AFTER_B'].includes(injectFailure),'INJECTION');
 requireOk(Array.isArray(registryRecords)&&registryRecords.length>=2&&registryRecords.length<=100,'REGISTRY_COUNT');
 requireOk(newReceipts!==null&&typeof newReceipts==='object'&&Object.keys(newReceipts).sort().join('|')==='witnessA|witnessB','RECEIPT_SET');
 const unlock=grabLock(dir);
 try{
  const old=Object.fromEntries(W.map(w=>[w,readJson(dir,`${w}.json`)]));
  const expectedEpoch=registryRecords.length;
  const projected={};
  for(const w of W){
   requireOk(Array.isArray(old[w])&&[expectedEpoch-1,expectedEpoch].includes(old[w].length),'UNEXPECTED_EPOCH');
   const base=old[w].slice(0,expectedEpoch-1);
   projected[w]=[...base,newReceipts[w]];
   requireOk(equal(old[w],base)||equal(old[w],projected[w]),'WITNESS_CONFLICT');
  }
  const verified=inspect({registryRecords,trustedAuditors,r127Pin,receiptChains:projected,trustedWitnesses,minimumWitnessPin,nowMs});
  requireOk(verified.epoch===expectedEpoch,'EPOCH_MISMATCH');
  const fingerprint=hash({version:'R129',operationId,registryRecords,projected});
  let intent=maybeJson(dir,'intent.json');
  if(intent){
   requireOk(intent.version==='R129'&&intent.operationId===operationId&&intent.fingerprint===fingerprint&&intent.epoch===expectedEpoch&&['PENDING','DONE'].includes(intent.status),'OPERATION_CONFLICT');
  }else{
   requireOk(W.every(w=>old[w].length===expectedEpoch-1),'UNRECORDED_PARTIAL');
   intent={version:'R129',operationId,fingerprint,epoch:expectedEpoch,status:'PENDING',...R129_POLICY};
   writeAtomic(dir,'intent.json',intent);
  }
  if(intent.status==='DONE'){
   requireOk(W.every(w=>equal(old[w],projected[w])),'DONE_STATE_MISMATCH');
   return {status:'REPLAY',epoch:expectedEpoch,verified:verified.status,independentlyPinned:false,candidatePin:candidatePin(registryRecords,projected),...R129_POLICY};
  }
  if(injectFailure==='AFTER_INTENT')fail('INJECTED_AFTER_INTENT');
  for(const [idx,w] of W.entries()){
   if(old[w].length!==expectedEpoch)writeAtomic(dir,`${w}.json`,projected[w]);
   if(injectFailure===(idx===0?'AFTER_A':'AFTER_B'))fail(`INJECTED_${injectFailure}`);
  }
  const persisted=Object.fromEntries(W.map(w=>[w,readJson(dir,`${w}.json`)]));
  requireOk(W.every(w=>equal(persisted[w],projected[w])),'VERIFY_WRITE');
  inspect({registryRecords,trustedAuditors,r127Pin,receiptChains:persisted,trustedWitnesses,minimumWitnessPin,nowMs});
  writeAtomic(dir,'intent.json',{...intent,status:'DONE'});
  return {status:'APPLIED',epoch:expectedEpoch,verified:verified.status,independentlyPinned:false,candidatePin:candidatePin(registryRecords,projected),...R129_POLICY};
 }finally{unlock()}
}

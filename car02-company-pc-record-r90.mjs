// DPRO CAR02 R90 local-only company-PC QA notes: no approval and no network.
// Export/import is a SELF-REPORTED checking memo, not independent acceptance evidence.
import {QA_ITEMS} from './car02-r89-acceptance-model.mjs';
export const RECORD_SCHEMA='DPRO_CAR02_R90_PC_SELF_CHECK_V1';
export const CHOICES=Object.freeze(['pending','ok','issue']);
const K=QA_ITEMS.filter(x=>x.safe).map(x=>x.id);
export const RECORD_IDS=Object.freeze(K);
const codes=new Set(CHOICES), allow=new Set(K);
const fail=(code)=>{const e=new Error(code);e.code=code;throw e;};
export function blankReview(){return Object.fromEntries(K.map(id=>[id,'pending']));}
function validStates(states){
 if(!states||typeof states!=='object'||Array.isArray(states)||Object.keys(states).length!==K.length)fail('R90_RECORD_INVALID');
 const out=Object.create(null);
 for(const id of K){if(!Object.hasOwn(states,id)||!codes.has(states[id]))fail('R90_RECORD_INVALID');out[id]=states[id];}
 if(Object.keys(states).some(id=>!allow.has(id)))fail('R90_RECORD_INVALID');
 return out;
}
export function setReviewState(states,id,value){
 if(!allow.has(id)||!codes.has(value))fail('R90_ITEM_INVALID');
 return Object.freeze({...validStates(states),[id]:value});
}
export function reviewStats(states){
 const values=Object.values(validStates(states));
 const ok=values.filter(v=>v==='ok').length,issue=values.filter(v=>v==='issue').length,pending=values.filter(v=>v==='pending').length;
 return Object.freeze({ok,issue,pending,total:K.length,reviewed:ok+issue,
  releaseDecision:'NO_GO',migrationDecision:'HOLD',productionReady:false,
  humanSignoff:false,verifiedBackup:false,authority:'SELF_REPORTED_ONLY'});
}
export function createReviewExport(states,now=new Date()){
 const safe=validStates(states);
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))fail('R90_TIME_INVALID');
 // Fixed keys and states only. No staff names, user IDs, screenshots, tokens or freeform notes.
 return Object.freeze({schema:RECORD_SCHEMA,source:'ISOLATED_UI_SELF_REPORT',
  generatedAt:now.toISOString(),states:{...safe},
  releaseDecision:'NO_GO',migrationDecision:'HOLD',productionReady:false});
}
export function parseReviewImport(input){
 if(typeof input!=='string'||new TextEncoder().encode(input).length>16384||input.length===0)fail('R90_IMPORT_INVALID');
 let x;try{x=JSON.parse(input)}catch{fail('R90_IMPORT_INVALID')}
 if(!x||typeof x!=='object'||Array.isArray(x)||
  Object.keys(x).sort().join(',')!==['schema','source','generatedAt','states','releaseDecision','migrationDecision','productionReady'].sort().join(',')||
  x.schema!==RECORD_SCHEMA||x.source!=='ISOLATED_UI_SELF_REPORT'||
  typeof x.generatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x.generatedAt)||
  !Number.isFinite(Date.parse(x.generatedAt))||
  x.releaseDecision!=='NO_GO'||x.migrationDecision!=='HOLD'||x.productionReady!==false)fail('R90_IMPORT_INVALID');
 return Object.freeze({...validStates(x.states)});
}

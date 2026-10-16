/** DPRO CAR02 basic UI -> R45 transport integration candidate.
 * ISOLATED TEST ONLY. No fetch, token creation, Supabase/LINE/Worker or UI deployment.
 * Accept an R57-compatible client only from the disposable synthetic QA harness.
 * This module does NOT create reservations, customers, vehicles or authorize actors.
 */
import {prepareWorkOrderCreate} from './car02-basic-api-contract-isolated.mjs';

export const CAR02_BASIC_UI_PORT_MODE=Object.freeze({
 environment:'disposable_qa',productionReady:false,liveConnection:false,
 release:'NO_GO',migration:'HOLD',realAuth:false,bookingWrite:false,photoUpload:false
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES=Object.freeze({draft:'整備報告待ち',pending:'お客様承認待ち',approved:'承認済み',declined:'見送り',completed:'作業完了'});
const METHOD_NAMES=['create','get','history','saveReport','presentQuote','decision','complete'];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const error=code=>{throw Object.assign(new Error(code),{code})};
const exact=(x,keys)=>plain(x)&&Object.keys(x).every(k=>keys.includes(k));
const uuid=id=>typeof id==='string'&&UUID.test(id);
const version=x=>Number.isSafeInteger(x)&&x>0;
const nonblank=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const keyOK=k=>typeof k==='string'&&k.length>=12&&k.length<=150&&k.trim()===k&&/^[A-Za-z0-9_-]+$/.test(k);
function requireCase(id,expectedVersion,requestId){
 if(!uuid(id))error('CAR02_UI_CASE_ID_REQUIRED');
 if(!version(expectedVersion))error('CAR02_UI_VERSION_REQUIRED');
 if(!keyOK(requestId))error('CAR02_UI_IDEMPOTENCY_REQUIRED');
}
export function projectCar02R45Order(record){
 if(!plain(record)||!uuid(record.id)||!uuid(record.customerId)||!uuid(record.vehicleId)||
    (record.reservationId!=null&&!uuid(record.reservationId))||!version(record.version)||
    !Object.hasOwn(STATES,record.status))error('CAR02_UI_RESPONSE_INVALID');
 const q=record.quote;
 if(q!==null&&q!==undefined&&(!plain(q)||!Number.isSafeInteger(q.subtotal)||q.subtotal<0||
   !Number.isSafeInteger(q.tax)||q.tax<0||!Number.isSafeInteger(q.total)||q.total!==q.subtotal+q.tax))
   error('CAR02_UI_QUOTE_INVALID');
 const reportReady=nonblank(record.observation,10000);
 const status=record.status==='draft'&&reportReady?'見積作成待ち':STATES[record.status];
 return Object.freeze({id:record.id,reservationLinked:uuid(record.reservationId),
   state:record.status,statusLabel:status,version:record.version,
   reportReady,hasQuote:!!q,quoteRevision:q?.revision??0,
   subtotalYen:q?.subtotal??null,taxYen:q?.tax??null,totalYen:q?.total??null,
   canReport:record.status==='draft',canPresent:record.status==='draft'&&reportReady,
   canDecide:record.status==='pending',canComplete:record.status==='approved',
   // NEVER expose shopCode, actor, tokens, customer/vehicle IDs or photo storage paths in the view DTO.
   info:'隔離環境のみ。表示はサーバー検査済みデータを前提としたUI投影であり、本人認証ではありません。'
 });
}
export function createCar02BasicUiR45Port({environment,allowIsolatedQa=false,client}={}){
 if(environment!=='disposable_qa'||allowIsolatedQa!==true||
    !client||METHOD_NAMES.some(n=>typeof client[n]!=='function'))error('CAR02_UI_ISOLATION_REQUIRED');
 return Object.freeze({
   async createFromResolvedReferences(input){
     // R13 references MUST already be server-resolved; this is never a booking-creation endpoint.
     const d=prepareWorkOrderCreate(input);
     return projectCar02R45Order(await client.create(d.body,d.idempotencyKey));
   },
   async read(id){if(!uuid(id))error('CAR02_UI_CASE_ID_REQUIRED');return projectCar02R45Order(await client.get(id));},
   async saveReport({id,observation,expectedVersion,requestId,photos=[]}={}){
     requireCase(id,expectedVersion,requestId);
     if(!nonblank(observation,10000)||!Array.isArray(photos)||photos.length!==0)error('CAR02_UI_REPORT_INVALID');
     return projectCar02R45Order(await client.saveReport(id,{observation:observation.trim(),photos:[],expectedVersion},requestId));
   },
   async presentQuote({id,items,expectedVersion,requestId}={}){
     requireCase(id,expectedVersion,requestId);
     if(!Array.isArray(items)||items.length<1||items.length>30||!items.every(it=>exact(it,['name','price'])&&
       nonblank(it.name,160)&&Number.isSafeInteger(it.price)&&it.price>=0&&it.price<=100_000_000))error('CAR02_UI_QUOTE_INVALID');
     return projectCar02R45Order(await client.presentQuote(id,{items:items.map(it=>({name:it.name.trim(),price:it.price})),expectedVersion},requestId));
   },
   async decide({id,decision,reason='',expectedVersion,requestId}={}){
     requireCase(id,expectedVersion,requestId);
     if(!['approved','declined'].includes(decision)||typeof reason!=='string'||reason.length>2000||
       (decision==='declined'&&!reason.trim()))error('CAR02_UI_DECISION_INVALID');
     return projectCar02R45Order(await client.decision(id,{decision,reason,expectedVersion},requestId));
   },
   async complete({id,expectedVersion,requestId}={}){
     requireCase(id,expectedVersion,requestId);
     return projectCar02R45Order(await client.complete(id,{expectedVersion},requestId));
   },
   async history(id){
     if(!uuid(id))error('CAR02_UI_CASE_ID_REQUIRED');
     const value=await client.history(id);
     if(!Array.isArray(value)||value.length>1000||!value.every(x=>plain(x)&&typeof x.event_type==='string'&&x.event_type.length<=80))
       error('CAR02_UI_HISTORY_INVALID');
     return Object.freeze(value.map(x=>Object.freeze({event:x.event_type,role:['owner','staff','customer'].includes(x.actor_role)?x.actor_role:'unknown',
       createdAt:typeof x.created_at==='string'?x.created_at:String(x.created_at??'')})));
   },
 });
}

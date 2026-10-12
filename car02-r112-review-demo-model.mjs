// DPRO CAR02 R112: entirely synthetic, browser-only demonstration of R111 public fields.
// NOT an API, authentication, production interface, or privileged storage integration.
// Browser cannot import R111's Node-only 'node:assert'; tests compare these keys to R111.
export const R112_PUBLIC_KEYS=Object.freeze(['jobId','state','reason','createdAt','reviewCount','escalated','latestEventKind','latestRecordedAt']);
export const R112_STATUS=Object.freeze({mode:'SYNTHETIC_OFFLINE_DEMO',productionReady:false,
  dataConnection:false,mutationsAuthorized:false,storageDeleteAuthorized:false,
  releaseDecision:'NO_GO',migrationDecision:'HOLD'});
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const reasons=Object.freeze({UPLOAD_UNCERTAIN:'アップロード結果が未確定',STORAGE_DELETE_UNVERIFIED:'削除状態を確認できません',ACK_LOST:'確認応答を受信できません'});
const events=Object.freeze({EVIDENCE_HASH_RECORDED:'確認記録あり',ESCALATED_FOR_REVIEW:'確認担当へ連絡済み'});
const keys=[...R112_PUBLIC_KEYS].sort().join('|');
function deny(code){throw Object.assign(new Error(code),{code})}
const iso=(v)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function validateR112Item(item){
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.getPrototypeOf(item)!==Object.prototype||
    Object.keys(item).sort().join('|')!==keys||!UUID.test(item.jobId)||item.state!=='QUARANTINED'||
    !Object.hasOwn(reasons,item.reason)||!iso(item.createdAt)||!Number.isInteger(item.reviewCount)||
    item.reviewCount<0||typeof item.escalated!=='boolean'||
    (item.latestEventKind!==null&&!Object.hasOwn(events,item.latestEventKind))||
    (item.latestRecordedAt!==null&&!iso(item.latestRecordedAt)))deny('R112_UNSAFE_PUBLIC_ITEM');
  if(item.reviewCount===0 ? (item.latestEventKind!==null||item.latestRecordedAt!==null) : (item.latestEventKind===null||item.latestRecordedAt===null))deny('R112_EVENT_COUNT_DRIFT');
  if(item.escalated&&item.reviewCount===0)deny('R112_ESCALATION_DRIFT');
  return Object.freeze({...item});
}
export const R112_REASON=Object.freeze(reasons);
export const R112_EVENT=Object.freeze(events);
const mk=(id,reason,time,count,escalated,kind)=>({jobId:`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,
 state:'QUARANTINED',reason,createdAt:`2026-10-${String(10+(id%3)).padStart(2,'0')}T${String(8+id%10).padStart(2,'0')}:1${id%6}:00.000Z`,
 reviewCount:count,escalated,latestEventKind:kind,latestRecordedAt:count?`2026-10-${String(10+(id%3)).padStart(2,'0')}T${String(8+id%10).padStart(2,'0')}:3${id%6}:00.000Z`:null});
const input=[mk(1,'UPLOAD_UNCERTAIN',0,2,true,'ESCALATED_FOR_REVIEW'),mk(2,'ACK_LOST',0,0,false,null),
 mk(3,'STORAGE_DELETE_UNVERIFIED',0,1,false,'EVIDENCE_HASH_RECORDED'),mk(4,'UPLOAD_UNCERTAIN',0,0,false,null),
 mk(5,'ACK_LOST',0,3,true,'ESCALATED_FOR_REVIEW'),mk(6,'STORAGE_DELETE_UNVERIFIED',0,1,true,'ESCALATED_FOR_REVIEW'),
 mk(7,'UPLOAD_UNCERTAIN',0,0,false,null),mk(8,'ACK_LOST',0,2,false,'EVIDENCE_HASH_RECORDED'),
 mk(9,'STORAGE_DELETE_UNVERIFIED',0,0,false,null),mk(10,'UPLOAD_UNCERTAIN',0,1,true,'ESCALATED_FOR_REVIEW'),
 mk(11,'ACK_LOST',0,0,false,null)];
export const R112_DEMO_ITEMS=Object.freeze(input.map(validateR112Item));
export function formatR112Date(date){if(!iso(date))deny('R112_DATE_INVALID');return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(date));}
export function deriveR112Inbox({items=R112_DEMO_ITEMS,filter='all',reason='all',search='',page=1,pageSize=5}={}){
 if(!Array.isArray(items)||items.length>500||!['all','escalated','unreviewed'].includes(filter)||
  !['all',...Object.keys(reasons)].includes(reason)||typeof search!=='string'||search.length>80||
  !Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>50)deny('R112_QUERY_INVALID');
 const valid=items.map(validateR112Item);const q=search.trim().toLowerCase();
 const selected=valid.filter(x=>(filter==='all'||(filter==='escalated'&&x.escalated)||(filter==='unreviewed'&&x.reviewCount===0))&&
   (reason==='all'||x.reason===reason)&&(!q||x.jobId.toLowerCase().includes(q)));
 selected.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.jobId.localeCompare(a.jobId));
 const totalPages=Math.max(1,Math.ceil(selected.length/pageSize)),currentPage=Math.min(page,totalPages);
 const stats=Object.freeze({total:valid.length,escalated:valid.filter(x=>x.escalated).length,
  unreviewed:valid.filter(x=>x.reviewCount===0).length,reviewed:valid.filter(x=>x.reviewCount>0).length});
 return Object.freeze({items:Object.freeze(selected.slice((currentPage-1)*pageSize,currentPage*pageSize)),
  matchCount:selected.length,currentPage,totalPages,stats,hasPrevious:currentPage>1,hasNext:currentPage<totalPages,
  ...R112_STATUS});
}

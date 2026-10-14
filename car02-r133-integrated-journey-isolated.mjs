/**
 * DPRO CAR02 R133: offline-only synthetic customer journey.
 * Booking entrance -> slot -> inspection -> quote -> customer choice -> work completion.
 * NO network, storage, server calls, personal data, LINE, payments, booking or deployment.
 * All displayed state is ephemeral and lost on reload; never imply a real booking.
 */
export const R133_POLICY=Object.freeze({
 version:'R133',mode:'OFFLINE_SYNTHETIC_UX',release:'NO_GO',migration:'HOLD',
 productionReady:false,externalProofVerified:false,productionBooking:false,
 bookingPersisted:false,lineDispatched:false,customerIdentityVerified:false,
 paymentsProcessed:false,photosUploaded:false,
});
export const SOURCES=Object.freeze(['WEB','HP','LINE']);
export const STATUSES=Object.freeze(['START','SLOT_SELECTED','BOOKING_DEMO','REPORT_DRAFT','QUOTE_PRESENTED','CUSTOMER_APPROVED','CUSTOMER_DECLINED','WORK_COMPLETED','CANCELLED']);
const fail=(code)=>{throw new Error(`R133_${code}`)};
const ensure=(x,code)=>{if(!x)fail(code)};
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const dateRE=/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const timeRE=/^(09|1[0-7]):(00|30)$/;
const isPlain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const jstDate=x=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x));
function dayNumber(s){
 ensure(typeof s==='string'&&dateRE.test(s),'DATE_FORMAT');
 const [y,m,d]=s.split('-').map(Number);
 const dt=new Date(Date.UTC(y,m-1,d));
 ensure(dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d,'DATE_INVALID');
 return Math.floor(dt.getTime()/86400000);
}
function jstStartMs(date,time){return Date.parse(`${date}T${time}:00+09:00`)}
export function slotIsAllowed({date,time,nowMs,busy=[]}){
 ensure(Number.isSafeInteger(nowMs)&&nowMs>=0,'CLOCK');
 ensure(typeof time==='string'&&timeRE.test(time),'TIME_FORMAT');
 ensure(Array.isArray(busy)&&busy.length<=500&&busy.every(x=>typeof x==='string'),'BUSY_SHAPE');
 const day=dayNumber(date),today=dayNumber(jstDate(nowMs));
 if(day<today||day>today+60)return {ok:false,reason:'OUT_OF_WINDOW'};
 if(new Date(`${date}T00:00:00Z`).getUTCDay()===0)return {ok:false,reason:'SUNDAY_CLOSED'};
 if(jstStartMs(date,time)<=nowMs)return {ok:false,reason:'PAST_TIME'};
 if(busy.includes(`${date} ${time}`))return {ok:false,reason:'BUSY'};
 return {ok:true,reason:'AVAILABLE_DEMO_ONLY'};
}
const clone=x=>structuredClone(x);
export function initialJourney(source='WEB'){
 ensure(SOURCES.includes(source),'SOURCE');
 return {version:'R133',source,status:'START',slot:null,report:null,quote:null,decision:null,
   history:[],...R133_POLICY};
}
function checkState(s){
 ensure(isPlain(s)&&s.version==='R133'&&SOURCES.includes(s.source)&&STATUSES.includes(s.status),'STATE');
 for(const [k,v] of Object.entries(R133_POLICY))ensure(s[k]===v,'POLICY');
 ensure(Array.isArray(s.history)&&s.history.length<150,'HISTORY');
}
function noteOK(t){return typeof t==='string'&&t.trim().length>=8&&t.trim().length<=300&& !/[\u0000-\u001f\u007f]/.test(t)}
function linesOK(x){return Array.isArray(x)&&x.length>=1&&x.length<=8&&x.every(y=>isPlain(y)&&Object.keys(y).sort().join()==='label,yen'&&typeof y.label==='string'&&y.label.trim().length>=2&&y.label.length<=60&&Number.isSafeInteger(y.yen)&&y.yen>=0&&y.yen<=1000000)}
export function calculateQuote(lines){
 ensure(linesOK(lines),'QUOTE_LINES');
 const subtotal=lines.reduce((s,r)=>s+r.yen,0);
 const tax=Math.floor(subtotal/10); // demonstration only; tax rules remain real-world gate
 return {lines:clone(lines),subtotal,tax,total:subtotal+tax,taxDisclaimer:'10% demo calculation only'};
}
/** A pure in-memory reducer. No production state, fetch, external IO or persistent storage. */
export function advanceJourney(state,action,{nowMs,busy=[]}={}){
 checkState(state);
 ensure(isPlain(action)&&typeof action.type==='string','ACTION');
 ensure(Number.isSafeInteger(nowMs)&&nowMs>=0,'CLOCK');
 const next=clone(state);
 const previous=next.status;
 switch(action.type){
 case 'SELECT_SLOT': {
   ensure(['START','SLOT_SELECTED','CANCELLED'].includes(previous),'TRANSITION');
   const v=slotIsAllowed({date:action.date,time:action.time,nowMs,busy});ensure(v.ok,v.reason);
   next.slot={date:action.date,time:action.time,durationMinutes:30};next.report=null;next.quote=null;next.decision=null;
   next.status='SLOT_SELECTED';break;
 }
 case 'CONFIRM_DEMO': {
   ensure(previous==='SLOT_SELECTED'&&next.slot,'TRANSITION');
   ensure(slotIsAllowed({date:next.slot.date,time:next.slot.time,nowMs,busy}).ok,'SLOT_RECHECK');
   next.status='BOOKING_DEMO';break;
 }
 case 'REPORT': {
   ensure(['BOOKING_DEMO','REPORT_DRAFT'].includes(previous),'TRANSITION');
   ensure(noteOK(action.note),'REPORT_NOTE');
   next.report={note:action.note.trim(),photos:0};next.status='REPORT_DRAFT';break;
 }
 case 'PRESENT_QUOTE': {
   ensure(previous==='REPORT_DRAFT'&&next.report,'TRANSITION');
   ensure(noteOK(action.explanation),'QUOTE_EXPLANATION');
   next.quote={...calculateQuote(action.lines),explanation:action.explanation.trim(),edition:1};next.status='QUOTE_PRESENTED';break;
 }
 case 'CUSTOMER_DECISION': {
   ensure(previous==='QUOTE_PRESENTED','TRANSITION');
   ensure(action.choice==='APPROVE'||action.choice==='DECLINE','CHOICE');
   if(action.choice==='DECLINE')ensure(noteOK(action.reason),'DECLINE_REASON');
   next.decision={choice:action.choice,reason:action.choice==='DECLINE'?action.reason.trim():null};
   next.status=action.choice==='APPROVE'?'CUSTOMER_APPROVED':'CUSTOMER_DECLINED';break;
 }
 case 'COMPLETE_WORK': {
   ensure(previous==='CUSTOMER_APPROVED'&&next.decision?.choice==='APPROVE','TRANSITION');
   next.status='WORK_COMPLETED';break;
 }
 case 'CANCEL_DEMO': {
   ensure(['SLOT_SELECTED','BOOKING_DEMO','REPORT_DRAFT','QUOTE_PRESENTED','CUSTOMER_DECLINED'].includes(previous),'TRANSITION');
   next.status='CANCELLED';next.decision=null;break;
 }
 case 'RESET_DEMO': {
   return initialJourney(next.source);
 }
 default:fail('ACTION_UNKNOWN');
 }
 next.history.push({step:action.type,from:previous,to:next.status,atMs:nowMs,synthetic:true});
 return next;
}
export const R133_PRIORITY_WORKSTREAMS=Object.freeze([
 {order:1,id:'ACCESS_TENANT',title:'認証・店舗分離',gates:['OWNER_AUTH','TENANT_RLS'],owner:'Developer + authorized staging tester',deliverable:'実認証・権限別操作とテナント分離のステージング証拠',status:'NOT_VERIFIED'},
 {order:2,id:'BOOKING_JOURNEY',title:'予約カレンダー・予約受付',gates:['BOOKING_ATOMICITY'],owner:'Developer + authorized staging tester',deliverable:'予約/重複防止/取消/再予約の実DB隔離ステージング試験',status:'NOT_VERIFIED'},
 {order:3,id:'SHOP_CUSTOMER',title:'整備報告・見積・顧客判断',gates:['CUSTOMER_CONSENT','PHOTO_STORAGE'],owner:'Developer + authorized staging tester',deliverable:'写真権限・見積版管理・承認証拠・個人情報同意の試験',status:'NOT_VERIFIED'},
 {order:4,id:'CHANNEL_ROUTING',title:'HP・LINE予約導線',gates:['HP_ROUTING','LINE_LIFF'],owner:'Developer + authorized owner',deliverable:'実HPとLINE導線の検証、送信同意、重複通知防止',status:'NOT_VERIFIED'},
 {order:5,id:'RECOVERY_RELEASE',title:'復旧・信頼証拠・運用',gates:['BACKUP_RESTORE','EXTERNAL_WITNESS','TRUST_ANCHOR','TRUSTED_CLOCK','OPERATIONS'],owner:'Developer + authorized release reviewers',deliverable:'バックアップ復元・外部署名・信頼時刻・運用手順・公開判定',status:'NOT_VERIFIED'},
]);
/** No component from this phase may authorize production. */
export function journeySummary(s){checkState(s);return {source:s.source,status:s.status,historyCount:s.history.length,quoteTotal:s.quote?.total??null,release:'NO_GO',migration:'HOLD',productionReady:false,allExternalGatesOpen:12,realBookingMade:false}}

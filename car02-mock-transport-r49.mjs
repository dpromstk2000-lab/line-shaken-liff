// CAR02 R49: IN-MEMORY QA MOCK. Never transmits requests. No real accounts or personal data.
const SHOP='street_house_kitsuki';
const ORDER='11111111-1111-4111-8111-111111111111';
const C='22222222-2222-4222-8222-222222222222';
const V='33333333-3333-4333-8333-333333333333';
export const CAR02_R49_DEMO_IDS=Object.freeze({orderId:ORDER,customerId:C,vehicleId:V});
export function createCar02MockTransportR49(){
 let state,processed;
 const initial=()=>({id:ORDER,shop:SHOP,customerId:C,vehicleId:V,status:'draft',version:1,revision:0,observation:'',photos:[],quote:null,decision:null,events:[{type:'created',actor:'demo:staff',time:'10:00'}]});
 const reset=()=>{state=initial();processed=new Map();};reset();
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
 const ok=data=>json({ok:true,data});const fail=(code,status=400)=>json({ok:false,code},status);
 const snapshot=()=>structuredClone(state);
 const event=(type,role)=>state.events.push({type,actor:'demo:'+role,time:new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(new Date())});
 async function fetchImpl(input,opts={}){
  const url=new URL(input),m=opts.method||'GET',path=url.pathname;
  if(url.origin!=='https://car02-stage.invalid'||url.search)return fail('CAR02_ROUTE_INVALID',400);
  let role=null;
  if(opts.headers?.get('Authorization')==='Bearer demo-staff-token')role='staff';
  if(opts.headers?.get('X-Line-ID-Token')==='demo-customer-token'){
   if(role)return fail('CAR02_UNAUTHORIZED',401);
   role='customer';
  }
  if(!role)return fail('CAR02_UNAUTHORIZED',401);
  if(m==='GET'&&path===`/api/car02/${ORDER}`)return ok(snapshot());
  if(m==='GET'&&path===`/api/car02/${ORDER}/history`)return ok(structuredClone(state.events));
  if(m!=='POST')return fail('CAR02_NOT_FOUND',404);
  const key=opts.headers?.get('Idempotency-Key')||'';
  if(key.length<12)return fail('CAR02_IDEMPOTENCY_REQUIRED',422);
  if(processed.has(key))return ok(structuredClone(processed.get(key)));
  let data;try{data=JSON.parse(opts.body)}catch{return fail('CAR02_JSON_INVALID',400)}
  if(path===`/api/car02/${ORDER}/report`){
   if(role!=='staff')return fail('CAR02_UNAUTHORIZED',403);
   if(state.status!=='draft'||state.version!==data.expectedVersion)return fail('CAR02_VERSION_CONFLICT',409);
   if(typeof data.observation!=='string'||!data.observation.trim()||!Array.isArray(data.photos)||data.photos.length)return fail('CAR02_REPORT_INVALID',422);
   state.observation=data.observation.trim();state.version++;event('report_saved',role);
  }else if(path===`/api/car02/${ORDER}/quote`){
   if(role!=='staff')return fail('CAR02_UNAUTHORIZED',403);
   if(state.status!=='draft'||state.version!==data.expectedVersion)return fail('CAR02_VERSION_CONFLICT',409);
   if(!state.observation)return fail('CAR02_REPORT_REQUIRED',409);
   const subtotal=data.items.reduce((n,x)=>n+x.price,0);const tax=Math.floor(subtotal*.1);
   state.quote={revision:++state.revision,items:data.items,observation:state.observation,photos:[],subtotal,tax,total:subtotal+tax};
   state.status='pending';state.version++;event('quote_presented',role);
  }else if(path===`/api/car02/${ORDER}/decision`){
   if(role!=='customer')return fail('CAR02_UNAUTHORIZED',403);
   if(state.status!=='pending'||state.version!==data.expectedVersion)return fail('CAR02_VERSION_CONFLICT',409);
   state.decision={value:data.decision,reason:data.reason||'',revision:state.revision};state.status=data.decision;state.version++;event('quote_'+data.decision,role);
  }else if(path===`/api/car02/${ORDER}/complete`){
   if(role!=='staff')return fail('CAR02_UNAUTHORIZED',403);
   if(state.status!=='approved'||state.version!==data.expectedVersion)return fail('CAR02_VERSION_CONFLICT',409);
   state.status='completed';state.version++;event('completed',role);
  }else return fail('CAR02_NOT_FOUND',404);
  const result=snapshot();processed.set(key,result);return ok(result);
 }
 return Object.freeze({fetchImpl,reset,inspect:snapshot});
}

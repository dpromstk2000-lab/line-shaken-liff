/**
 * DPRO CAR02 V4.69 — OFFLINE R44/R46/R468 principal+session state stability observation.
 * All six adapters must be injected from disposable mocks in QA. Neither a prior
 * nor a subsequent read can atomically authorize a real write; it is only a
 * regression probe identifying missing transaction-scoped authorization wiring.
 * No real Supabase, LINE, Worker, production database or release decision.
 * All real R44/R46/R50/R52 sources remain unchanged, locked and never deployed.
 */
export const CAR02_V469_RELEASE_LOCK=true;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const bad=(reason,checks=0)=>Object.freeze({status:'no_go',reason,checksObserved:checks,
 releasePermitted:false,writeAuthorized:false,lineDispatchAllowed:false,
 realSupabaseVerified:false,transactionFenceProven:false});
const integer=n=>Number.isSafeInteger(n)&&n>0;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.getPrototypeOf(v)===Object.prototype&&
 Object.keys(v).sort().join('|')===keys.slice().sort().join('|');
const COLUMNS=['source','shopCode','userSub','sessionId','staffRole','generation','fenceDigest','active','observedAtMs'];
function good(s,shop,sub,sid){return exact(s,COLUMNS)&&s.source==='offline_disposable_session_fence'&&
 s.shopCode===shop&&s.userSub===sub&&s.sessionId===sid&&
 ['staff','owner'].includes(s.staffRole)&&integer(s.generation)&&integer(s.observedAtMs)&&
 s.active===true&&typeof s.fenceDigest==='string'&&SHA.test(s.fenceDigest);}
function jwtClaims(bearer){
 try{
  if(typeof bearer!=='string'||!/^Bearer [A-Za-z0-9_.-]{8,8192}$/.test(bearer))return null;
  const token=bearer.slice(7),pieces=token.split('.');
  if(pieces.length!==3||!pieces.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))return null;
  const payload=Buffer.from(pieces[1],'base64url');
  if(payload.length>2048)return null;
  const v=JSON.parse(payload.toString('utf8'));
  return v&&typeof v==='object'&&!Array.isArray(v)&&
   typeof v.sub==='string'&&UUID.test(v.sub)&&typeof v.session_id==='string'&&UUID.test(v.session_id)&&
   v.aud==='authenticated'&&v.role==='authenticated'&&integer(v.exp)?
   {sub:v.sub,sid:v.session_id,exp:v.exp}:null;
 }catch{return null;}
}
export function createCar02OfflineAuthChainR469({authorizeReviewer,inspectIsolation,authenticateR44,
 inspectR468,readFenceSnapshot,nowSeconds=()=>Math.floor(Date.now()/1000)}={}){
 if(CAR02_V469_RELEASE_LOCK!==true||![authorizeReviewer,inspectIsolation,authenticateR44,
    inspectR468,readFenceSnapshot,nowSeconds].every(f=>typeof f==='function'))
  throw Error('CAR02_V469_OFFLINE_ONLY_ADAPTERS_REQUIRED');
 async function inspect({request}={}){
  let reviewer,isolated;
  try{
   [reviewer,isolated]=await Promise.all([authorizeReviewer({request}),inspectIsolation()]);
  }catch{return bad('independent_review_required');}
  if(reviewer?.verified!==true||reviewer?.role!=='chain_auditor'||reviewer.mode!=='isolated_qa'||
    typeof reviewer.shopCode!=='string'||!SHOP.test(reviewer.shopCode)||
    isolated?.verified!==true||isolated.environment!=='offline_mock_only'||isolated.testOnly!==true)
    return bad('independent_review_required');
  try{
   const bearer=request?.headers?.get?.('authorization');
   if(request?.headers?.has?.('x-line-id-token'))return bad('line_credential_not_staff');
   const untrusted=jwtClaims(bearer),now=nowSeconds();
   if(!untrusted||!integer(now)||untrusted.exp<=now)return bad('bearer_session_claim_unusable');
   const principal=await authenticateR44(request);
   if(principal?.verified!==true||principal.shopCode!==reviewer.shopCode||
    !['staff','owner'].includes(principal.role)||principal.subject!==`staff:${untrusted.sub}`)
    return bad('r44_staff_identity_not_confirmed');
   const params=Object.freeze({shopCode:reviewer.shopCode,userSub:untrusted.sub,sessionId:untrusted.sid});
   const before=await readFenceSnapshot({...params,phase:'before'});
   if(!good(before,reviewer.shopCode,untrusted.sub,untrusted.sid)||before.staffRole!==principal.role)
    return bad('initial_offline_fence_not_observed',1);
   const bridge=await inspectR468({request});
   if(bridge?.status!=='no_go'||bridge.reason!=='offline_bridge_consistent_still_no_go'||
    bridge.checksObserved!==3||bridge.releasePermitted!==false||
    bridge.realSupabaseSessionVerified!==false||bridge.businessWriteAllowed!==false||
    bridge.lineDispatchAllowed!==false)
    return bad('independent_r468_bridge_not_confirmed',2);
   const after=await readFenceSnapshot({...params,phase:'after'});
   if(!good(after,reviewer.shopCode,untrusted.sub,untrusted.sid)||
      after.staffRole!==principal.role||after.generation!==before.generation||
      after.fenceDigest!==before.fenceDigest||after.observedAtMs<before.observedAtMs)
    return bad('state_changed_or_second_fence_untrusted',3);
   return bad('offline_identity_session_chain_consistent_still_no_go',4);
  }catch{return bad('offline_dependency_rejected');}
 }
 return Object.freeze({inspect});
}

/**
 * DPRO CAR02 V4.40 — OFFLINE stranded-dispatch quarantine/inspection model.
 * REVIEW ONLY; do NOT deploy, wire into R44/R46/R50/R52 or use real tokens.
 * No send API, retries, notification delivery, customer data or live network access.
 * Server-provided store must use a disposable QA database and must not be request-controlled.
 * Quarantine is NOT proof the provider did not deliver: it requires human reconciliation.
 * The model cannot grant delivery or return dispatchable payloads.
 */
export const CAR02_V440_RELEASE_LOCK=true;
export const CAR02_V440_QUARANTINE_SQL='SELECT event_id,review_state FROM public.v440_qa_quarantine_next($1::text)';
export const CAR02_V440_COUNTS_SQL='SELECT status,total FROM public.v440_qa_status_counts($1::text)';
const allowedShop=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const known=new Set(['pending','dispatching','delivered','manual_review']);
export function createCar02OfflineOutboxRecoveryR440({store}={}) {
 if(CAR02_V440_RELEASE_LOCK!==true||typeof store?.query!=='function')
   throw Error('CAR02_V440_REVIEW_STORE_REQUIRED');
 async function quarantineOne(shopCode) {
   if(!allowedShop(shopCode))return Object.freeze({status:'denied'});
   try {
     const r=await store.query(CAR02_V440_QUARANTINE_SQL,[shopCode]);
     if(!Array.isArray(r?.rows)||r.rows.length>1)return Object.freeze({status:'indeterminate'});
     if(r.rows.length===0)return Object.freeze({status:'idle'});
     const x=r.rows[0];
     if(!uuid(x?.event_id)||x.review_state!=='manual_review')return Object.freeze({status:'indeterminate'});
     return Object.freeze({status:'manual_review',eventId:x.event_id});
   }catch {return Object.freeze({status:'indeterminate'});}
 }
 async function statusCounts(shopCode) {
   if(!allowedShop(shopCode))return Object.freeze({status:'denied'});
   try{
     const r=await store.query(CAR02_V440_COUNTS_SQL,[shopCode]);
     if(!Array.isArray(r?.rows)||r.rows.length!==4)return Object.freeze({status:'indeterminate'});
     const counts=Object.create(null);
     for(const x of r.rows){
       const total=Number(x?.total);
       if(!known.has(x?.status)||Object.hasOwn(counts,x.status)||!Number.isSafeInteger(total)||total<0)
         return Object.freeze({status:'indeterminate'});
       counts[x.status]=total;
     }
     if(known.size!==Object.keys(counts).length)return Object.freeze({status:'indeterminate'});
     return Object.freeze({status:'ok',counts:Object.freeze({...counts})});
   }catch{return Object.freeze({status:'indeterminate'});}
 }
 return Object.freeze({quarantineOne,statusCounts});
}

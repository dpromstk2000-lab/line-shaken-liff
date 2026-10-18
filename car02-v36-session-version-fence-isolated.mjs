/**
 * DPRO CAR02 V3.6: synthetic session-to-membership version fence, QA ONLY.
 * No JWT signature verification, DB access, row lock, production routes or writes.
 * The callbacks are TEST FAKES and must never be wired to production code.
 */
import {createV35QaStaffMutationGate} from './car02-v35-tx-time-membership-isolated.mjs';
export const V36_MODE=Object.freeze({environment:'isolated_qa',signedSessionBound:false,
  realMembershipDbBound:false,realPgLockBound:false,liveAuthVersionPropagation:false,
  deployable:false,productionReady:false,release:'NO_GO',migration:'HOLD'});
const deny=()=>{throw Object.assign(new Error('CAR02_V36_QA_DENIED'),{code:'CAR02_V36_QA_DENIED'});};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const sec=v=>Number.isSafeInteger(v)&&v>0;
const clean=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v&&!/\s/.test(v);
const ops=new Set(['create','report','present','complete']);
/**
 * Source-authoritative session is re-read for EACH synthetic write. The V3.5
 * simulated lock re-reads the membership before work and its authVersion MUST
 * match that separate synthetic verified session. It does NOT guarantee an
 * atomic real database transaction; that requires backend implementation.
 */
export function createV36QaSessionVersionFence({environment,allowIsolatedQa=false,
  readVerifiedSession,lockMembershipRow,nowSeconds=()=>Math.floor(Date.now()/1000)}={}) {
 if(environment!=='isolated_qa'||allowIsolatedQa!==true||typeof readVerifiedSession!=='function'||
    typeof lockMembershipRow!=='function'||typeof nowSeconds!=='function')deny();
 const v35=createV35QaStaffMutationGate({environment,allowIsolatedQa,nowSeconds,
   lockMembershipRow:async q=>{
     // Session version is checked against the membership returned by the same synthetic read.
     let session,clock,locked;
     try {clock=nowSeconds();session=await readVerifiedSession({userSub:q.userSub,shopCode:q.shopCode});
       locked=await lockMembershipRow(q);}catch{deny();}
     if(!sec(clock)||!plain(session)||session.verified!==true||!clean(session.sub)||
       session.sub!==q.userSub||!sec(session.exp)||session.exp<=clock||
       !Number.isSafeInteger(session.authVersion)||session.authVersion<1||
       !plain(locked)||locked.lockHeld!==true||!Array.isArray(locked.rows)||
       locked.rows.length!==1||!plain(locked.rows[0])||
       locked.rows[0].authVersion!==session.authVersion)deny();
     return locked;
   }});
 return async function simulate({actor,shopCode,operation,work}={}) {
   if(!plain(actor)||actor.verified!==true||!clean(actor.subject)||
      !actor.subject.startsWith('staff:')||!clean(actor.subject.slice(6))||
      !clean(shopCode)||actor.shopCode!==shopCode||!['staff','owner'].includes(actor.role)||
      !ops.has(operation)||typeof work!=='function')deny();
   try{return await v35({actor,shopCode,operation,work});}catch{deny();}
 };
}

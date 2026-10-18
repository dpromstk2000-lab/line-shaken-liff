/** DPRO CAR02 V4.4 — asynchronous expiry-boundary regression fence, QA ONLY.
 * Investigates a demonstrable V4.3 isolated-model gap: a verified session may
 * expire during await readReplay / mutate, after the earlier authorize call.
 * Important: this wrapper does NOT lock PostgreSQL or roll back side effects.
 * DO NOT import into Worker or deploy. Dedicated live transaction with rollback,
 * signer, issuer and durable revocation is still required before any release.
 */
import {V42_MODE} from './car02-v42-signed-session-binding-isolated.mjs';
import {v43QaSignedTxReplay} from './car02-v43-signed-transaction-replay-isolated.mjs';
export const V44_MODE=Object.freeze({environment:'isolated_qa',deployable:false,usesSyntheticSignedSessions:true,
  realDatabase:false,realRowLockProven:false,rollbackProven:false,release:'NO_GO'});
const deny=()=>{const e=Error('CAR02_V44_QA_DENIED');e.code='CAR02_V44_QA_DENIED';throw e;};
/** In V4.4, the trusted session is rechecked after every await boundary.
 * authorize() on the original V4.2 lab checks its private WeakSet brand, expiry,
 * tenant, role, active membership and authoritative auth_version.
 */
export async function v44QaExpiryFencedReplay(args={}) {
 if(!args || args.environment!=='isolated_qa'||args.allowIsolatedQa!==true||
   !args.lab||args.lab.mode!==V42_MODE||typeof args.lab.verify!=='function'||
   typeof args.lab.authorize!=='function'||typeof args.lockMembership!=='function'||
   typeof args.readReplay!=='function'||typeof args.mutate!=='function'||
   !args.tx||args.tx.state!=='open')deny();
 const lab=args.lab;
 let verified=null,locked=null;
 function fresh(){
   if(!verified||!locked||args.tx.state!=='open')deny();
   try{lab.authorize({verifiedIdentity:verified,lockedMembership:locked,shopCode:args.shopCode});}
   catch{deny();}
 }
 const guardedLab=Object.freeze({mode:V42_MODE,
   verify(token){const v=lab.verify(token);verified=v;return v;},
   authorize(params){const result=lab.authorize(params);locked=params.lockedMembership;return result;}
 });
 try {
   const result=await v43QaSignedTxReplay({...args,lab:guardedLab,
     readReplay:async ctx=>{fresh();const value=await args.readReplay(ctx);fresh();return value;},
     mutate:async ctx=>{fresh();const value=await args.mutate(ctx);fresh();return value;}
   });
   fresh(); // Also fence the final response boundary.
   return result;
 }catch{deny();}
}

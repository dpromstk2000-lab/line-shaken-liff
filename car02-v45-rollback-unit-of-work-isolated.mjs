/**
 * DPRO CAR02 V4.5 - isolated IN-MEMORY rollback unit-of-work review.
 * Not deployable. No PG connection, lock serialization, durable ledger, signer,
 * network, Worker integration, external side effects or SQL execution.
 * This is evidence for proposed ordering, NOT a PostgreSQL rollback proof.
 */
import {V42_MODE} from './car02-v42-signed-session-binding-isolated.mjs';
import {v44QaExpiryFencedReplay} from './car02-v44-async-expiry-fence-isolated.mjs';
export const V45_MODE=Object.freeze({environment:'isolated_qa',deployable:false,
  realDatabase:false,realRollbackProven:false,realRowLockProven:false,
  externalSideEffectsReversible:false,release:'NO_GO',reviewOnly:true});
const STAGES=new Set(['afterBegin','afterLock','afterRead','afterStage','beforeCommit']);
const faultNames=new Set(['begin','lock','read','mutate','commit','rollback']);
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
function fail(message='CAR02_V45_QA_DENIED'){
 const e=new Error(message);e.code=message;throw e;
}
const copy=x=>structuredClone(x);
/** A closed, transactional *simulation* for negative QA only.
 * Mutations are not externally observable until in-memory commit.
 * Hook execution is a test seam and MUST NOT touch external resources.
 */
export function createV45InMemoryRollbackLab(){
 const committed=new Map(),receipts=[];let serial=0;
 function inspect(){return Object.freeze({records:copy([...committed.entries()]),receipts:copy(receipts)});}
 async function execute(args={}){
  const {environment,allowIsolatedQa,lab,token,shopCode,operation,idempotencyKey,
    intentDigest,membership,mutationResult,hook,faultAt}=args;
  if(environment!=='isolated_qa'||allowIsolatedQa!==true||!lab||lab.mode!==V42_MODE||
    typeof lab.verify!=='function'||typeof lab.authorize!=='function'||
    !plain(membership)||typeof hook!=='undefined'&&typeof hook!=='function'||
    typeof faultAt!=='undefined'&&!faultNames.has(faultAt))fail();
  if(faultAt==='begin')fail('CAR02_V45_BEGIN_DENIED');
  const tx={id:`v45-synthetic-tx-${++serial}`,state:'open'};
  const staged=new Map(committed);const record={id:tx.id,steps:['BEGIN'],outcome:'pending'};
  let writeCount=0;receipts.push(record);
  const runHook=async(step)=>{
   if(!STAGES.has(step))fail();
   if(hook)await hook(step,Object.freeze({txId:tx.id,stage:step}));
   if(tx.state!=='open')fail();
  };
  try {
   await runHook('afterBegin');
   const result=await v44QaExpiryFencedReplay({environment,allowIsolatedQa,lab,token,tx,
    shopCode,operation,idempotencyKey,intentDigest,
    lockMembership:async({txId})=>{
      if(faultAt==='lock')fail();
      const row=copy(membership);
      await runHook('afterLock');
      return {txId,lockKind:'FOR_UPDATE',row};
    },
    readReplay:async({scopeDigest})=>{
      if(faultAt==='read')fail();
      await runHook('afterRead');
      return staged.has(scopeDigest)?copy(staged.get(scopeDigest)):null;
    },
    mutate:async({shopCode:shop,subject,role,authVersion,scopeDigest,intentDigest:intent})=>{
      if(faultAt==='mutate')fail();
      if(staged.has(scopeDigest))fail();
      const value=copy(mutationResult);
      staged.set(scopeDigest,{completed:true,shopCode:shop,subject,role,
        authVersion,scopeDigest,intentDigest:intent,snapshot:value});
      writeCount++;
      await runHook('afterStage');
      return value;
    }
   });
   await runHook('beforeCommit');
   // Re-evaluate current authoritative *synthetic* row and token before committing.
   // A PostgreSQL implementation must hold a conflicting row lock and do this in DB.
   try{lab.authorize({verifiedIdentity:lab.verify(token),lockedMembership:copy(membership),shopCode});}
   catch{fail();}
   if(faultAt==='commit')fail('CAR02_V45_COMMIT_FAILED');
   if(tx.state!=='open')fail();
   committed.clear();for(const [k,v] of staged)committed.set(k,copy(v));
   tx.state='committed';record.steps.push('COMMIT');record.outcome='committed';
   return Object.freeze({...result,transactionId:tx.id,writeCount,reviewOnly:true});
  }catch(err){
   if(tx.state==='open'){
    // Never publish the staged map on abort. A rollback fault remains an error.
    staged.clear();tx.state='aborted';record.steps.push('ROLLBACK');
    if(faultAt==='rollback'){
      record.outcome='rollback_unconfirmed';
      fail('CAR02_V45_ROLLBACK_UNCONFIRMED');
    }
    record.outcome='rolled_back';
   }
   fail('CAR02_V45_TRANSACTION_REJECTED');
  }
 }
 return Object.freeze({mode:V45_MODE,execute,inspect});
}

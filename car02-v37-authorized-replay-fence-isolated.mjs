/**
 * DPRO CAR02 V3.7 — synthetic replay / idempotency authorization boundary.
 * REVIEW / ISOLATED QA ONLY; no real JWT, DB transaction, outbox or HTTP.
 * Per-attempt staff reauthorization executes BEFORE even reading a prior result.
 * All storage here is an ephemeral test Map, never durable or deployable.
 */
import {createHash} from 'node:crypto';
import {createV36QaSessionVersionFence} from './car02-v36-session-version-fence-isolated.mjs';
export const V37_MODE = Object.freeze({environment:'isolated_qa',productionReady:false,
  deployable:false,realDbTransaction:false,realIdempotencyPersistence:false,
  realSignedJwtVerifierBound:false,realMembershipLockBound:false,release:'NO_GO',migration:'HOLD'});
const denied=()=>{const e=new Error('CAR02_V37_QA_DENIED');e.code=e.message;throw e;};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const clean=x=>typeof x==='string'&&x.length>0&&x.length<=256&&x.trim()===x&&!/\s/.test(x);
const operations=new Set(['create','report','present','complete']);
const forbidden=new Set(['__proto__','prototype','constructor']);
const validKey=s=>typeof s==='string'&&s.length>=12&&s.length<=150&&/^[A-Za-z0-9_-]+$/.test(s);
// Deterministic JSON canonicalization rejects undefined, prototype pollution, cycles,
// malformed numbers, functions, nested or excessively large request bodies.
function canonical(x,depth=0,seen=new Set()) {
 if(depth>8)denied();
 if(x===null||typeof x==='boolean'||typeof x==='string'&&x.length<=4096)return x;
 if(typeof x==='number'&&Number.isSafeInteger(x))return x;
 if(typeof x!=='object'||x===null||seen.has(x))denied();
 seen.add(x);
 let value;
 if(Array.isArray(x)) {
   if(x.length>40||Object.keys(x).length!==x.length)denied();
   value=x.map(y=>canonical(y,depth+1,seen));
 } else if(plain(x)) {
   const keys=Object.keys(x).sort();if(keys.length>40)denied();
   value=Object.create(null);
   for(const k of keys) {
     if(!k||k.length>80||forbidden.has(k))denied();
     value[k]=canonical(x[k],depth+1,seen);
   }
 } else denied();
 seen.delete(x);
 return value;
}
const hex=x=>createHash('sha256').update(x).digest('hex');
export function createV37QaAuthorizedReplayFence({environment,allowIsolatedQa=false,
 readVerifiedSession,lockMembershipRow,nowSeconds=()=>Math.floor(Date.now()/1000)}={}) {
 if(environment!=='isolated_qa'||allowIsolatedQa!==true||typeof readVerifiedSession!=='function'||
    typeof lockMembershipRow!=='function'||typeof nowSeconds!=='function')denied();
 const ledger=new Map(),running=new Set();
 // No external APIs for reading or populating the ledger: synthetic private state.
 return async function execute({actor,shopCode,operation,idempotencyKey,payload,work}={}) {
   if(!plain(actor)||actor.verified!==true||!clean(actor.subject)||
      !actor.subject.startsWith('staff:')||!clean(actor.subject.slice(6))||
      !clean(shopCode)||actor.shopCode!==shopCode||!['staff','owner'].includes(actor.role)||
      !operations.has(operation)||!validKey(idempotencyKey)||!plain(payload)||typeof work!=='function')denied();
   let fingerprint;
   try {
     const encoded=JSON.stringify(canonical(payload));
     if(encoded.length>8192)denied();
     fingerprint=hex(encoded);
   } catch {denied();}
   const key=hex(JSON.stringify([shopCode,actor.subject,actor.role,operation,idempotencyKey]));
   // Deny concurrent in-flight same-key calls rather than pretend Map is a real DB lock.
   if(running.has(key))denied();
   running.add(key);
   let observedVersion;
   try {
     // Instantiate per attempt; a version from a different concurrent attempt cannot leak.
     const auth=createV36QaSessionVersionFence({environment,allowIsolatedQa,nowSeconds,
       readVerifiedSession:async q=>{const s=await readVerifiedSession(q);observedVersion=s?.authVersion;return s;},
       lockMembershipRow});
     // Even replay must reauthorize FIRST. No cached snapshot is read before auth.
     return await auth({actor,shopCode,operation,work:async()=>{
       if(!Number.isSafeInteger(observedVersion)||observedVersion<1)denied();
       const prev=ledger.get(key);
       if(prev) {
         if(prev.fingerprint!==fingerprint||prev.authVersion!==observedVersion)denied();
         return structuredClone(prev.snapshot);
       }
       // Trusted synthetic test callback only; never client-supplied HTTP behavior.
       const result=await work(Object.freeze({operation,shopCode,subject:actor.subject,role:actor.role}));
       const snapshot=structuredClone(canonical(result));
       if(JSON.stringify(snapshot).length>8192)denied();
       ledger.set(key,Object.freeze({fingerprint,authVersion:observedVersion,snapshot}));
       return structuredClone(snapshot);
     }});
   } catch {denied();}
   finally {running.delete(key);}
 };
}

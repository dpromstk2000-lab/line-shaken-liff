import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditV38R43TransactionReplaySources,V38_EXPECTED_BLOCKERS,V38_MODE} from './car02-v38-r43-transaction-audit-isolated.mjs';
const fake={
 pg:`// R43 offline implementation candidate ONLY. Never deploy R13
export function createCar02PgAdapter(pool) {
 async transaction({actor,shop,key,intent},fn) {
   const scope=\`\${actor.role}:\${actor.subject}\`;
   await c.query('BEGIN');
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))');
   const existing=await one(c,\`SELECT request_digest,response_snapshot,completed_at FROM ops
     WHERE shop_code=$1 AND actor_scope=$2 AND idempotency_key=$3 FOR UPDATE\`);
   if(existing) {
     if(!existing.completed_at||!existing.response_snapshot) throw Error('DENIED');
     await c.query('COMMIT');
     return obj(existing.response_snapshot);
   }
   await fn();await c.query('COMMIT');
 } catch { await c.query('ROLLBACK'); }
}
`,
 identity:`export function createCar02Authenticator(){
 // verified signed JWT via trusted callback. Not a live verifier in this QA.
 const jwt=await verifyStaffJwt({accessToken:token});
 if(jwt?.verified!==true)throw Error('DENIED');
 const staff=await resolveStaffAccess({userSub:jwt.sub,shopCode});
 return staff; }
`,
 edge:`// R52 staging source
const CAR02_RELEASE_LOCK=true;
async function createRuntime(){if(CAR02_RELEASE_LOCK)throw Error('CAR02_NOT_RELEASED')}
`,
 replay:`// V37 isolated replay test model, never production
export const V37_MODE={environment:'isolated_qa',deployable:false,realDbTransaction:false};`
};
const clean=()=>({...fake});
const audit=(b=clean(),opts={environment:'isolated_qa',allowIsolatedQa:true})=>auditV38R43TransactionReplaySources(b,opts);
test('non-production static review only',()=>{assert.equal(V38_MODE.productionReady,false);assert.equal(V38_MODE.deployable,false);assert.equal(V38_MODE.realDbTransaction,false);assert.equal(V38_MODE.release,'NO_GO');assert.equal(V38_MODE.migration,'HOLD');});
test('baseline confirms known gap but never production ready',()=>{const r=audit();assert.equal(r.passed,11);assert.equal(r.total,11);assert.equal(r.status,'KNOWN_GAPS_CONFIRMED');assert.equal(r.productionReady,false);assert.equal(r.blockerCount,5);});
test('all five named blockers persist',()=>assert.deepEqual([...audit().blockers],[...V38_EXPECTED_BLOCKERS]));
test('results do not expose source text',()=>assert.doesNotMatch(JSON.stringify(audit()),/request_digest|SELECT|Bearer /));
test('immutable result object',()=>{const r=audit();assert.equal(Object.isFrozen(r),true);assert.equal(Object.isFrozen(r.checks),true)});
for(const environment of ['production','staging','live','','readonly'])test('environment rejected '+String(environment),()=>{const o={environment,allowIsolatedQa:true};assert.throws(()=>audit(clean(),o),/CAR02_V38_REVIEW_DENIED/);});
for(const b of [null,{},[],false,'string',0,{'pg':null},Object.create(null)])test('malformed bundle rejected '+typeof b,()=>assert.throws(()=>audit(b),/CAR02_V38_REVIEW_DENIED/));
for(const opt of [{environment:'isolated_qa',allowIsolatedQa:false},{environment:'isolated_qa'},{allowIsolatedQa:true},{environment:'isolated_qa',allowIsolatedQa:1}])test('missing or invalid opt-in denied '+JSON.stringify(opt),()=>assert.throws(()=>audit(clean(),opt),/CAR02_V38_REVIEW_DENIED/));
for(const k of ['pg','identity','edge','replay'])test('missing '+k+' denied',()=>{const x=clean();delete x[k];assert.throws(()=>audit(x),/CAR02_V38_REVIEW_DENIED/);});
for(const k of ['pg','identity','edge','replay'])test('wrong type '+k+' denied',()=>{const x=clean();x[k]=[];assert.throws(()=>audit(x),/CAR02_V38_REVIEW_DENIED/);});
for(const k of ['pg','identity','edge','replay'])test('short source '+k+' denied',()=>{const x=clean();x[k]='x';assert.throws(()=>audit(x),/CAR02_V38_REVIEW_DENIED/);});
test('unexpected key denied',()=>assert.throws(()=>audit({...fake,secret:'x'}),/CAR02_V38_REVIEW_DENIED/));
const changes=[
 ['candidate label removed','pg','offline implementation candidate ONLY','replaced label','r43IsolatedCandidate'],
 ['R43 migration warning removed','pg','Never deploy R13','no warning','r43IsolatedCandidate'],
 ['transaction removed','pg','async transaction({actor,shop,key,intent},fn)','function lost','r43TransactionEntry'],
 ['BEGIN removed','pg',"await c.query('BEGIN')",'no begin','r43TransactionEntry'],
 ['COMMIT removed','pg',"await c.query('COMMIT')",'no commit','r43HasTransactionLifecycle'],
 ['ROLLBACK removed','pg',"await c.query('ROLLBACK')",'no rollback','r43HasTransactionLifecycle'],
 ['advisory lock removed','pg','pg_advisory_xact_lock(hashtextextended($1,0))','no lock','r43HasIdempotencyScopedLock'],
 ['actor scope removed','pg','const scope=`${actor.role}:${actor.subject}`','no actor scope','r43HasIdempotencyScopedLock'],
 ['completed snapshot removed','pg','response_snapshot,completed_at','no completed flag','r43ReadsCompletedSnapshotUnderLock'],
 ['row lock removed','pg','idempotency_key=$3 FOR UPDATE','idempotency_key=$3','r43ReadsCompletedSnapshotUnderLock'],
 ['replay branch removed','pg','if(existing)','if(false)','r43ReturnsCachedSnapshot'],
 ['cached response removed','pg','return obj(existing.response_snapshot);','return null;','r43ReturnsCachedSnapshot'],
 ['staff tx recheck appears','pg','if(existing) {','if(existing) { await resolveStaffAccess({userSub:actor.subject,shopCode:shop});','r43RealTxRecheckNotDemonstrated'],
 ['real membership lock marker appears','pg','if(existing) {','if(existing) { /* CAR02_STAFF_MEMBERSHIP_LOCK */ await resolveStaffAccess();','r43RealTxRecheckNotDemonstrated'],
 ['JWT callback removed','identity','verifyStaffJwt({accessToken:token})','verifyUnknown()', 'r44UsesInjectedJwtVerifier'],
 ['JWT verified evidence removed','identity','jwt?.verified!==true','jwt===null','r44UsesInjectedJwtVerifier'],
 ['trusted resolver removed','identity','resolveStaffAccess({userSub:jwt.sub,shopCode})','resolveStaffAccess({})','r44UsesOutsideTxStaffResolver'],
 ['hardcoded release true removed','edge','CAR02_RELEASE_LOCK=true','CAR02_RELEASE_LOCK=false','r52ReleaseLockHardcoded'],
 ['QA marker removed','replay',"environment:'isolated_qa'","environment:'production'",'v37ReviewModelNondeployable'],
 ['deployable false removed','replay','deployable:false','deployable:true','v37ReviewModelNondeployable'],
 ['realDB false removed','replay','realDbTransaction:false','realDbTransaction:true','v37ReviewModelNondeployable']
];
for(const [label,file,from,to,key] of changes)test('source drift: '+label,()=>{const x=clean();assert.ok(x[file].includes(from),label);x[file]=x[file].replaceAll(from,to);const r=audit(x);assert.equal(r.checks[key],false);assert.equal(r.sourceDriftDetected,true);assert.equal(r.status,'SOURCE_DRIFT_REVIEW_REQUIRED');assert.equal(r.release,'NO_GO');assert.equal(r.productionReady,false);});
for(const field of ['sourceDriftDetected','status','release','productionReady','blockerCount'])test('safe response always includes '+field,()=>assert.ok(Object.hasOwn(audit(),field)));
for(const blocker of V38_EXPECTED_BLOCKERS)test('keeps blocker '+blocker,()=>assert.ok(audit().blockers.includes(blocker)));

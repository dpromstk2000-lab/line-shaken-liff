import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createV36QaSessionVersionFence,V36_MODE} from './car02-v36-session-version-fence-isolated.mjs';
const NOW=1800000000,SHOP='shop-synthetic-a',SUB='synthetic-user',MID='11111111-1111-4111-8111-111111111111';
const actor={verified:true,role:'staff',subject:'staff:'+SUB,shopCode:SHOP};
const row={membershipId:MID,userSub:SUB,shopCode:SHOP,role:'staff',active:true,
 suspended:false,revokedAt:null,authVersion:8,validFrom:NOW-100,validUntil:NOW+500};
const session={verified:true,sub:SUB,authVersion:8,exp:NOW+180};
function harness({a=actor,r=row,s=session,reader,locker,clock=()=>NOW,environment='isolated_qa',allowIsolatedQa=true}={}) {
 let written=0,read=0,locked=0;
 const guard=createV36QaSessionVersionFence({environment,allowIsolatedQa,nowSeconds:clock,
   readVerifiedSession:async q=>{read++;return reader?reader(q):s;},
   lockMembershipRow:async q=>{locked++;return locker?locker(q):{lockHeld:true,rows:[r]};}});
 return {get written(){return written},get read(){return read},get locked(){return locked},
   run:({act=a,shopCode=SHOP,operation='report',work}={})=>guard({actor:act,shopCode,operation,
     work:work??(async()=>{written++;return 'qa-done';})})};
}
async function denied(h,opts){await assert.rejects(()=>h.run(opts),e=>e?.code==='CAR02_V36_QA_DENIED'&&e.message==='CAR02_V36_QA_DENIED');assert.equal(h.written,0);}
test('V36 explicitly NO_GO, disconnected, nondeployable',()=>{assert.equal(V36_MODE.productionReady,false);assert.equal(V36_MODE.realPgLockBound,false);assert.equal(V36_MODE.signedSessionBound,false);assert.equal(V36_MODE.release,'NO_GO');});
for(const op of ['create','report','present','complete'])test('valid operation '+op,async()=>{const h=harness();assert.equal(await h.run({operation:op}),'qa-done');assert.equal(h.read,1);assert.equal(h.locked,1);assert.equal(h.written,1);});
for(const v of [1,2,3,4,5,6,7,8,42])test('matching positive authVersion '+v,async()=>{const h=harness({r:{...row,authVersion:v},s:{...session,authVersion:v}});assert.equal(await h.run(),'qa-done');});
for(const v of [0,-1,1.4,NaN,null,undefined,'8',true,9007199254740992])test('denies invalid session version '+String(v),async()=>denied(harness({s:{...session,authVersion:v}})));
for(const v of [0,-1,1.3,undefined,null,'8',7,9,9007199254740992])test('denies mismatched/invalid row version '+String(v),async()=>denied(harness({r:{...row,authVersion:v}})));
for(const [label,changes] of [['not verified',{verified:false}],['sub foreign',{sub:'foreign'}],['sub blank',{sub:''}],['sub whitespace',{sub:' white '}],['exp now',{exp:NOW}],['exp old',{exp:NOW-1}],['exp string',{exp:String(NOW+10)}],['exp null',{exp:null}],['expired but version correct',{exp:NOW-5}],['missing verified',{verified:undefined}]])test('denies invalid signed synthetic session '+label,async()=>denied(harness({s:{...session,...changes}})));
for(const v of [null,undefined,[],false,'ok',{},{lockHeld:false,rows:[row]},{lockHeld:true,rows:[]},{lockHeld:true,rows:[row,row]}])test('denies missing/corrupt synthetic lock '+String(v),async()=>denied(harness({locker:()=>v})));
for(const v of [null,{},false,'yes',[],{...actor,verified:false},{...actor,role:'customer'},{...actor,shopCode:'other'},{...actor,subject:'line:'+SUB},{...actor,subject:'staff:'}])test('rejects untrusted actor '+JSON.stringify(v),async()=>denied(harness({a:v})));
for(const op of ['decide','delete','read','',null])test('forbidden mutation route '+String(op),async()=>{const h=harness();await denied(h,{operation:op});assert.equal(h.read,0);});
test('version increments invalidate the previous synthetic session',async()=>{const h=harness({r:{...row,authVersion:9}});await denied(h);});
test('previous success does not cache authVersion',async()=>{let version=8;const h=harness({reader:()=>({...session,authVersion:8}),locker:()=>({lockHeld:true,rows:[{...row,authVersion:version}]})});assert.equal(await h.run(),'qa-done');version=9;await assert.rejects(()=>h.run(),/CAR02_V36_QA_DENIED/);assert.equal(h.written,1);assert.equal(h.read,2);});
test('version re-read for each isolated attempt',async()=>{const h=harness();await h.run();await h.run();assert.equal(h.read,2);assert.equal(h.locked,2);});
test('simulated membership revocation denies',async()=>denied(harness({r:{...row,revokedAt:NOW}})));
test('role downgrade between authentication and fake lock denies',async()=>denied(harness({r:{...row,role:'owner'}})));
test('foreign shop membership denies',async()=>denied(harness({r:{...row,shopCode:'another'}})));
test('session read throwing cannot leak secret',async()=>denied(harness({reader:()=>{throw new Error('confidential session verifier details');}})));
test('lock read throwing cannot leak secret',async()=>denied(harness({locker:()=>{throw new Error('private database DSN');}})));
test('work exception is sanitized in isolated QA',async()=>{const h=harness();await assert.rejects(()=>h.run({work:()=>{throw Error('private SQL');}}),e=>e.message==='CAR02_V36_QA_DENIED');});
test('requires explicitly isolated environment',()=>assert.throws(()=>createV36QaSessionVersionFence({readVerifiedSession:()=>{},lockMembershipRow:()=>{}}),/CAR02_V36_QA_DENIED/));
test('requires QA opt-in',()=>assert.throws(()=>createV36QaSessionVersionFence({environment:'isolated_qa',readVerifiedSession:()=>{},lockMembershipRow:()=>{}}),/CAR02_V36_QA_DENIED/));
test('rejects missing callback',()=>assert.throws(()=>createV36QaSessionVersionFence({environment:'isolated_qa',allowIsolatedQa:true,readVerifiedSession:null,lockMembershipRow:()=>{}}),/CAR02_V36_QA_DENIED/));
test('rejects clock errors',async()=>denied(harness({clock:()=>{throw Error('bad clock');}})));
test('rejects malformed clock',async()=>denied(harness({clock:()=>NaN})));
test('passes scoped arguments to synthetic session and row lock',async()=>{const h=harness({reader:q=>{assert.deepEqual(q,{userSub:SUB,shopCode:SHOP});return session;},locker:q=>{assert.deepEqual(q,{userSub:SUB,shopCode:SHOP,operation:'report'});return{lockHeld:true,rows:[row]};}});await h.run();assert.equal(h.written,1);});

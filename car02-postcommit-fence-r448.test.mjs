import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V448_RELEASE_LOCK,CAR02_V448_CUTOVER_SQL,CAR02_V448_FENCE_SQL,
 createCar02PostCommitFenceR448} from './car02-postcommit-fence-r448.mjs';
const shop='qa_shop_a',userSub='00000000-0000-0000-0000-000000004481';
const nonce='00000000-0000-0000-0000-000000004488';
const command={request:{synthetic:true},userSub,expectedVersion:2};
const denied=p=>assert.rejects(p,e=>e.code==='CAR02_UNAUTHORIZED'&&e.status===401);
function fixture({auth=true,mode='isolated_qa',shopCode=shop,nonceValue=nonce,
 commit1Error=false,commit2Error=false,cutoverRejected=false,fenceRejected=false,
 connect2Error=false,failStage1=false,failStage2=false,invalidStage1=false,
 reuseClient=false,stage1Delay=null,stage2Hook=null}={}) {
 const log=[],released=[],writes=[];let connects=0,stage=0;
 const a={id:1},b=reuseClient?a:{id:2};
 const pool={connect:async()=>{
  connects++;
  if(connects===2&&connect2Error)throw Error('second connection lost');
  const obj=connects===1?a:b;
  const connNumber=connects;
  obj.query=async(sql,params)=>{
   log.push({connection:connNumber,sql,params});
   if(sql==='BEGIN'){stage=connNumber;return{rows:[]};}
   if(sql===CAR02_V448_CUTOVER_SQL){
     writes.push({phase:1,params});
     if(stage1Delay)await stage1Delay();
     if(failStage1)throw Error('DB failed');
     if(cutoverRejected)return{rows:[]};
     if(invalidStage1)return{rows:[{new_version:777,generation_nonce:nonce}]};
     return {rows:[{new_version:3,generation_nonce:nonceValue}]};
   }
   if(sql===CAR02_V448_FENCE_SQL){
     writes.push({phase:2,params});
     if(stage2Hook)await stage2Hook();
     if(failStage2)throw Error('fence unavailable');
     return{rows:[{established:!fenceRejected}]};
   }
   if(sql==='COMMIT'&&connNumber===1&&commit1Error)throw Error('COMMIT response lost after possibly executing');
   if(sql==='COMMIT'&&connNumber===2&&commit2Error)throw Error('fence COMMIT ACK lost');
   return{rows:[]};
  };
  obj.release=err=>released.push({connection:connNumber,discard:!!err});
  return obj;
 }};
 const authorizeOperator=async()=>({verified:auth,mode,shopCode});
 const controller=createCar02PostCommitFenceR448({pool,authorizeOperator,generateNonce:()=>nonceValue});
 return{controller,log,released,writes,get connects(){return connects}};
}
test('release locks and fixed literal SQL with configuration required',()=>{
 assert.equal(CAR02_V448_RELEASE_LOCK,true);
 assert.equal(CAR02_V448_CUTOVER_SQL,'SELECT new_version,generation_nonce FROM v448_private.qa_cutover($1::text,$2::uuid,$3::integer,$4::uuid)');
 assert.equal(CAR02_V448_FENCE_SQL,'SELECT established FROM v448_private.qa_establish_fence($1::text,$2::uuid,$3::integer,$4::uuid)');
 assert.throws(()=>createCar02PostCommitFenceR448(),/OFFLINE_CONFIG_REQUIRED/);
});
test('two physical client objects, after first COMMIT ACK, establish generation fence',async()=>{
 const f=fixture(),out=await f.controller.cutover(command);
 assert.deepEqual(out,{status:'fenced_review_only',generation:3});
 assert.ok(Object.isFrozen(out));assert.equal(f.connects,2);
 const com1=f.log.findIndex(x=>x.connection===1&&x.sql==='COMMIT');
 const begin2=f.log.findIndex(x=>x.connection===2&&x.sql==='BEGIN');
 assert.ok(com1>=0&&begin2>com1);
 assert.deepEqual(f.writes[0],{phase:1,params:[shop,userSub,2,nonce]});
 assert.deepEqual(f.writes[1],{phase:2,params:[shop,userSub,3,nonce]});
 assert.deepEqual(f.released,[{connection:1,discard:false},{connection:2,discard:false}]);
});
test('ambiguous FIRST COMMIT cannot create any fence',async()=>{
 const f=fixture({commit1Error:true});const out=await f.controller.cutover(command);
 assert.equal(out.status,'indeterminate_commit');assert.equal(f.connects,1);
 assert.equal(f.writes.length,1);assert.equal(f.log.some(x=>x.sql==='ROLLBACK'),false);
 assert.deepEqual(f.released,[{connection:1,discard:true}]);
});
test('stage one CAS conflict rejects and explicitly rolls back before COMMIT',async()=>{
 const f=fixture({cutoverRejected:true});assert.equal((await f.controller.cutover(command)).status,'rejected');
 assert.equal(f.connects,1);assert.equal(f.log.some(x=>x.sql==='ROLLBACK'),true);
 assert.equal(f.log.some(x=>x.sql==='COMMIT'),false);
});
test('stage-one SQL failure is not a success or fence',async()=>{
 const f=fixture({failStage1:true});assert.equal((await f.controller.cutover(command)).status,'rejected');
 assert.equal(f.writes.length,1);assert.equal(f.connects,1);
});
test('unexpected stage-one result cannot mint a fence',async()=>{
 const f=fixture({invalidStage1:true});assert.equal((await f.controller.cutover(command)).status,'rejected');
 assert.equal(f.connects,1);
});
test('second connection failed after FIRST COMMIT is INDETERMINATE_FENCE',async()=>{
 const f=fixture({connect2Error:true});assert.equal((await f.controller.cutover(command)).status,'indeterminate_fence');
 assert.equal(f.writes.length,1);assert.equal(f.connects,2);
});
test('stage two refuses an unexpected version or nonce, never claims rollback of stage 1',async()=>{
 const f=fixture({fenceRejected:true});assert.equal((await f.controller.cutover(command)).status,'indeterminate_fence');
 assert.ok(f.log.some(x=>x.connection===2&&x.sql==='ROLLBACK'));
 assert.equal(f.log.filter(x=>x.sql==='COMMIT').length,1);
});
test('stage two SQL disconnect yields unknown fence, never successful',async()=>{
 const f=fixture({failStage2:true});assert.equal((await f.controller.cutover(command)).status,'indeterminate_fence');
 assert.equal(f.released[1].discard,true);
});
test('ambiguous second COMMIT does not report complete fence and discards client',async()=>{
 const f=fixture({commit2Error:true});assert.equal((await f.controller.cutover(command)).status,'indeterminate_fence');
 assert.equal(f.log.filter(x=>x.sql==='COMMIT').length,2);
 assert.equal(f.log.some(x=>x.connection===2&&x.sql==='ROLLBACK'),false);
 assert.equal(f.released[1].discard,true);
});
test('never reuse first client object to write post-commit fence',async()=>{
 const f=fixture({reuseClient:true});assert.equal((await f.controller.cutover(command)).status,'indeterminate_fence');
 assert.equal(f.writes.length,1);
});
test('unauthorized server operator or non-isolated mode does not touch DB',async()=>{
 for(const c of [{auth:false},{mode:'production'},{shopCode:'../../other'}]){
  const f=fixture(c);await denied(f.controller.cutover(command));assert.equal(f.connects,0);
 }
});
test('malformed subject, version and untrusted nonce rejected before DB',async()=>{
 for(const c of [{userSub:'bad'},{expectedVersion:0},{expectedVersion:2.5},{expectedVersion:2147483646}]){
  const f=fixture();await denied(f.controller.cutover({...command,...c}));assert.equal(f.connects,0);
 }
 const f=fixture({nonceValue:'not-a-uuid'});await denied(f.controller.cutover(command));assert.equal(f.connects,0);
});
test('readable rejection response contains no token, SQL, tenant secrets or nonce',async()=>{
 const f=fixture({commit1Error:true});const r=await f.controller.cutover(command);
 assert.deepEqual(Object.keys(r),['status']);assert.equal(JSON.stringify(r).includes(nonce),false);
});
test('R52 production release remains hard locked, no V448 integration',()=>{
 const source=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(source,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 assert.doesNotMatch(source,/postcommit-fence-r448|v448_private/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {blankDraft,validateDraft,assessDraft,hashAsGitBlob,checkSourceSnapshot,protectedDecision,REQUIREMENTS} from './car02_customer_provisioning_readonly.mjs';
const clone=o=>structuredClone(o);
const base=()=>blankDraft();
test('default draft is valid but not intake-complete or release-ready',()=>{
 const x=base();assert.equal(validateDraft(x),true);const r=assessDraft(x);
 assert.equal(r.releaseDecision,'NO_GO');assert.equal(r.migrationDecision,'HOLD');
 assert.equal(r.customerTenantCreated,false);assert.equal(r.workerDeployed,false);assert.equal(r.orderIntakeComplete,false);
 assert(!r.requiredGates.some(g=>g.id==='PHOTO_STORAGE_IF_ENABLED'));
});
test('fully specified intake remains NO_GO',()=>{
 const x=base();x.customerType='new';x.facilityCode='carshop_112';x.domainPlan='new_domain';
 Object.keys(x.approvals).forEach(k=>x.approvals[k]=true);
 const r=assessDraft(x);assert.equal(r.orderIntakeComplete,true);assert.equal(r.releaseAuthorized,false);
});
test('enabled optional scope adds corresponding real integration gates',()=>{
 const x=base();x.services=['HP','LINE_OFFICIAL','RESERVATION_WEB','CAR02_MANAGEMENT','PRIVATE_PHOTO'];
 const r=assessDraft(x);assert(r.requiredGates.some(g=>g.id==='PHOTO_STORAGE_IF_ENABLED'));
 assert(r.requiredGates.some(g=>g.id==='LINE_IF_ENABLED'));
 assert.equal(r.requiredGates.length,REQUIREMENTS.length);
});
test('invalid import variants denied without ever unlocking',()=>{
 const cases=[];
 let x=base(); x.schema='WRONG';cases.push(x);
 x=base();x.version=2;cases.push(x);
 x=base();x.facilityCode='Shop 01';cases.push(x);
 x=base();x.facilityCode='';cases.push(x);
 x=base();x.customerType='admin';cases.push(x);
 x=base();x.domainPlan='secret';cases.push(x);
 x=base();x.bookingMinutes=5;cases.push(x);
 x=base();x.services=[];cases.push(x);
 x=base();x.services=['HP','HP'];cases.push(x);
 x=base();x.services=['PRIVATE_PHOTO'];cases.push(x);
 x=base();x.services=['SUPERUSER'];cases.push(x);
 x=base();x.approvals.owner_identity='yes';cases.push(x);
 x=base();delete x.approvals.owner_identity;cases.push(x);
 x=base();x.productionReady=true;cases.push(x);
 x=base();x.approvals.extra=true;cases.push(x);
 x=base();x.jwt='token';cases.push(x);
 for(const item of cases)assert.throws(()=>validateDraft(item));
});
test('source snapshots enforce strict content match',()=>{
 const actual={'a.js':'console.log(1)\n','b.js':'abc','c.sql':'SELECT 1;','d.ts':'// test'};
 const expected=Object.fromEntries(Object.entries(actual).map(([k,v])=>[k,hashAsGitBlob(v)]));
 assert.equal(checkSourceSnapshot(actual,expected).deploymentAuthorized,false);
 for(const k of Object.keys(actual)){const corrupt=clone(actual);corrupt[k]+='\n';assert.throws(()=>checkSourceSnapshot(corrupt,expected));}
 assert.throws(()=>checkSourceSnapshot(actual,{'a.js':expected['a.js']}));
});
test('immutable deployment deny policy',()=>{
 const x=protectedDecision();assert.equal(x.workerDeployAuthorized,false);
 assert.equal(x.productionDbWriteAuthorized,false);assert.equal(x.lineDispatchAuthorized,false);
 assert.equal(x.privatePhotoDeleteAuthorized,false);assert.throws(()=>{x.workerDeployAuthorized=true});
});
test('100 deterministic permutations remain closed',()=>{
 for(let i=0;i<100;i++){
  let x=base();x.customerType=i%2?'existing':'new';x.facilityCode='shop_'+String(i).padStart(4,'0');
  x.domainPlan=i%3?'existing_domain':'pending';x.bookingMinutes=[10,15,30][i%3];
  if(i%2)x.services.push('LINE_OFFICIAL');if(i%5===0)x.services.push('PRIVATE_PHOTO');
  for(const [n,k] of Object.keys(x.approvals).entries())x.approvals[k]=(i+n)%4===0 || i%7===0;
  let r=assessDraft(x);
  assert.equal(r.productionReady,false);assert.equal(r.releaseAuthorized,false);
  assert.equal(r.migrationAuthorized,false);assert.equal(r.realBookingCreated,false);
  assert(r.requiredGates.every(z=>z.status==='NOT_VERIFIED'));
 }
});

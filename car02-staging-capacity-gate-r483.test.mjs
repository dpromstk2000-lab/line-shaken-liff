import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAR02_V483_RELEASE_LOCK, CAR02_V483_FREE_ACTIVE_PROJECT_LIMIT,
  evaluateCar02StagingCapacityR483, createCar02StagingCapacityAuditorR483
} from './car02-staging-capacity-gate-r483.mjs';

const base = () => ({
  organizations: [{id:'synthetic_org',name:'Mock organization'}],
  organizationDetails: [{id:'synthetic_org',plan:'free'}],
  projects: [
    {id:'synthetic_one',organization_id:'synthetic_org',status:'ACTIVE_HEALTHY'},
    {id:'synthetic_two',organization_id:'synthetic_org',status:'ACTIVE_HEALTHY'}
  ]
});
const inspect = mutate => {
  const payload=base();
  mutate?.(payload);
  return evaluateCar02StagingCapacityR483(payload);
};
function locked(result) {
  for (const key of ['releaseLock']) assert.equal(result[key],true);
  for (const key of ['commercialReleaseAllowed','projectCreationAllowed',
    'existingProjectReuseAllowed','billingChangeAllowed','databaseAccessAllowed',
    'workerDeployAllowed','lineDispatchAllowed']) assert.equal(result[key],false,key);
  assert.equal(result.commercialProviderProofsVerified,0);
  assert.equal(result.requiredCommercialProviderProofs,7);
  assert.equal(result.decision,'HOLD');
}

test('V4.83 release lock and free upper bound remain pinned',()=>{
  assert.equal(CAR02_V483_RELEASE_LOCK,true);
  assert.equal(CAR02_V483_FREE_ACTIVE_PROJECT_LIMIT,2);
});
test('two active Free projects exhaust available free capacity',()=>{
  const r=inspect(); locked(r);
  assert.equal(r.reason,'free_capacity_exhausted');
  assert.equal(r.freeActiveProjects,2);
  assert.equal(r.freeSlotsUpperBound,0);
  assert.equal(r.car02DedicatedProjectVerified,false);
});
test('read-only result never exposes project names or refs',()=>{
  const result=inspect();
  assert.equal(JSON.stringify(result).includes('synthetic_one'),false);
  assert.equal(JSON.stringify(result).includes('Mock organization'),false);
});
test('input is not mutated or stored in result',()=>{
  const original=base(); const snapshot=structuredClone(original);
  evaluateCar02StagingCapacityR483(original);
  assert.deepEqual(original,snapshot);
});

const malformed = [
  ['no payload', () => undefined, 'metadata_missing_or_incomplete'],
  ['no organizations', p => {delete p.organizations;}, 'metadata_missing_or_incomplete'],
  ['empty organizations', p => {p.organizations=[];}, 'metadata_missing_or_incomplete'],
  ['no project listing', p => {delete p.projects;}, 'metadata_missing_or_incomplete'],
  ['non-array project listing', p => {p.projects={};}, 'metadata_missing_or_incomplete'],
  ['no plan listing', p => {delete p.organizationDetails;}, 'metadata_missing_or_incomplete'],
  ['duplicate organization ID', p => {p.organizations.push({...p.organizations[0]});}, 'organization_inventory_invalid'],
  ['organization ID missing', p => {p.organizations[0].id='';}, 'organization_inventory_invalid'],
  ['duplicate plan detail', p => {p.organizationDetails.push({...p.organizationDetails[0]});}, 'subscription_metadata_invalid'],
  ['plan detail for foreign organization', p => {p.organizationDetails[0].id='foreign';}, 'subscription_metadata_invalid'],
  ['plan detail missing', p => {p.organizationDetails=[];}, 'subscription_metadata_incomplete'],
  ['unexpected plan string', p => {p.organizationDetails[0].plan='mystery';}, 'unrecognized_subscription_plan'],
  ['project without ID', p => {p.projects[0].id='';}, 'project_inventory_invalid'],
  ['duplicate project ID', p => {p.projects[1].id=p.projects[0].id;}, 'project_inventory_invalid'],
  ['project not in declared org', p => {p.projects[0].organization_id='foreign';}, 'project_inventory_invalid'],
  ['project without status', p => {delete p.projects[0].status;}, 'project_inventory_invalid'],
  ['null project', p => {p.projects[0]=null;}, 'project_inventory_invalid']
];
for (const [name, mutate, reason] of malformed) {
  test(`fail-closed malformed metadata: ${name}`,()=>{
    const r=name==='no payload'?evaluateCar02StagingCapacityR483():inspect(mutate);
    locked(r); assert.equal(r.reason,reason);
  });
}
test('one observed active project is only unverified upper-bound capacity',()=>{
  const r=inspect(p=>{p.projects.pop();}); locked(r);
  assert.equal(r.reason,'unverified_free_slot_requires_owner_and_member_quota_review');
  assert.equal(r.freeSlotsUpperBound,1);
  assert.equal(r.extraOrganizationMemberQuotaChecked,false);
});
test('zero observed projects is NOT project creation authorization',()=>{
  const r=inspect(p=>{p.projects=[];}); locked(r);
  assert.equal(r.freeSlotsUpperBound,2);
  assert.equal(r.projectCreationAllowed,false);
});
test('paused Free project does not count toward active quota',()=>{
  const r=inspect(p=>{p.projects[1].status='PAUSED';}); locked(r);
  assert.equal(r.freeActiveProjects,1);
  assert.equal(r.freePausedProjects,1);
  assert.equal(r.freeSlotsUpperBound,1);
});
test('unknown status conservatively counts against free quota',()=>{
  const r=inspect(p=>{p.projects[1].status='UNKNOWN_NEW_STATE';}); locked(r);
  assert.equal(r.reason,'free_capacity_exhausted');
});
test('a suspended or unhealthy project is not assumed to be free capacity',()=>{
  const r=inspect(p=>{p.projects[1].status='INACTIVE';}); locked(r);
  assert.equal(r.freeSlotsUpperBound,0);
});
test('more than two active Free projects still cannot produce negative slots',()=>{
  const r=inspect(p=>{p.projects.push({id:'synthetic_three',organization_id:'synthetic_org',status:'ACTIVE'});});
  locked(r); assert.equal(r.freeActiveProjects,3); assert.equal(r.freeSlotsUpperBound,0);
});
test('paid-only organization requires owner billing decision',()=>{
  const r=inspect(p=>{p.organizationDetails[0].plan='pro';}); locked(r);
  assert.equal(r.reason,'no_free_organization_cost_review_required');
  assert.equal(r.paidProjects,2);
});
test('mixed organizations still count all Free projects without reusing paid',()=>{
  const r=inspect(p=>{
    p.organizations.push({id:'mock_paid'});
    p.organizationDetails.push({id:'mock_paid',plan:'pro'});
    p.projects.push({id:'mock_paid_p',organization_id:'mock_paid',status:'ACTIVE_HEALTHY'});
  }); locked(r);
  assert.equal(r.freeActiveProjects,2);
  assert.equal(r.paidProjects,1);
  assert.equal(r.reason,'free_capacity_exhausted');
});
test('case-insensitive Free plan is accepted',()=>{
  const r=inspect(p=>{p.organizationDetails[0].plan='Free';}); locked(r);
  assert.equal(r.reason,'free_capacity_exhausted');
});
test('adapters are mandatory',()=>{
  assert.throws(()=>createCar02StagingCapacityAuditorR483(),/V483_READ_ONLY_METADATA_ADAPTERS_REQUIRED/);
});
test('async audit from injected read-only metadata passes through HOLD',async()=>{
  const p=base();
  const audit=createCar02StagingCapacityAuditorR483({
    listOrganizations:async()=>p.organizations,
    listProjects:async()=>p.projects,
    getOrganization:async id=>{assert.equal(id,'synthetic_org');return p.organizationDetails[0];}
  });
  const r=await audit.inspect(); locked(r);
  assert.equal(r.reason,'free_capacity_exhausted');
});
test('failed inventory connector returns HOLD',async()=>{
  const audit=createCar02StagingCapacityAuditorR483({
    listOrganizations:async()=>{throw Error('offline');},
    listProjects:async()=>[],getOrganization:async()=>({})
  });
  const r=await audit.inspect(); locked(r);
  assert.equal(r.reason,'read_only_inventory_unavailable');
});
test('failed subscription connector returns HOLD',async()=>{
  const p=base();
  const audit=createCar02StagingCapacityAuditorR483({
    listOrganizations:async()=>p.organizations,listProjects:async()=>p.projects,
    getOrganization:async()=>{throw Error('offline');}
  });
  const r=await audit.inspect(); locked(r);
  assert.equal(r.reason,'read_only_plan_unavailable');
});
test('partial listing adapter returns HOLD',async()=>{
  const audit=createCar02StagingCapacityAuditorR483({
    listOrganizations:async()=>({organizations:[]}),listProjects:async()=>[],getOrganization:async()=>({})
  });
  const r=await audit.inspect(); locked(r);
  assert.equal(r.reason,'metadata_missing_or_incomplete');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR02_V477_PROOF_KEYS} from './car02-commercial-gap-audit-r477.mjs';
import {CAR02_V478_RELEASE_LOCK,CAR02_V478_PROOF_KEYS,CAR02_V478_REVIEW_BRANCH,
 createCar02OfflineStagingBoundaryPreflightR478} from './car02-staging-boundary-preflight-r478.mjs';
const shop='qa_shop_a';const stag='stagingsystemref0001';const prod='prodconnectedref0001';
const project=()=>({source:'offline_fixture_inventory',reviewBranch:CAR02_V478_REVIEW_BRANCH,
 stagingProjectRef:stag,protectedProjectRefs:[prod],environment:'offline_mock_only',
 isolated:true,testOnly:true,customerRows:0,providerCredentialsPresent:false,providerCallsEnabled:false});
const proof=()=>CAR02_V478_PROOF_KEYS.map(key=>({key,state:'unverified',evidenceClass:'none'}));
const owner=()=>({source:'offline_owner_fixture',projectRef:stag,approved:false,
 verifiedIdentity:false,authorizationToCreate:false});
function fixture(o={}){
 const calls={inventory:0,proofs:0,owner:0};
 const svc=createCar02OfflineStagingBoundaryPreflightR478({
 expectedShopCode:o.fixedShop??shop,
 authorizeAuditor:async()=>{if(o.throw==='auditor')throw Error('blocked');return{
  verified:true,role:'staging_boundary_auditor',mode:'isolated_qa',shopCode:shop,...o.auditor};},
 inspectIsolation:async()=>{if(o.throw==='isolation')throw Error('blocked');return{
  verified:true,environment:'offline_mock_only',testOnly:true,providerCallsEnabled:false,...o.isolation};},
 readProjectInventory:async({shopCode})=>{calls.inventory++;assert.equal(shopCode,shop);if(o.throw==='inventory')throw Error('blocked');return o.inventory===undefined?project():o.inventory;},
 readProofClaims:async({shopCode})=>{calls.proofs++;assert.equal(shopCode,shop);if(o.throw==='proofs')throw Error('blocked');return o.proofs===undefined?proof():o.proofs;},
 readOwnerGate:async({shopCode,stagingProjectRef})=>{calls.owner++;assert.equal(shopCode,shop);assert.equal(stagingProjectRef,stag);if(o.throw==='owner')throw Error('blocked');return o.owner===undefined?owner():o.owner;}
 });return{svc,calls};
}
async function exec(o={},request={shopCode:'qa_shop_b',releasePermitted:true}){let v=fixture(o);return {result:await v.svc.inspect({request}),...v};}
function no(r){assert.ok(Object.isFrozen(r));assert.equal(r.status,'no_go');
 for(const f of ['releasePermitted','businessWritesAuthorized','lineDispatchAuthorized','providerSessionVerified',
 'realStagingIsolationVerified','realOwnerAuthorizationVerified','realProviderEvidenceVerified'])assert.equal(r[f],false);
 assert.deepEqual(r.missingRealProofs,CAR02_V477_PROOF_KEYS);assert.equal(r.realProofsVerified,0);
 assert.equal('credentials' in r,false);assert.equal('projectRef' in r,false);assert.equal('approvalToken' in r,false);
 assert.equal(r.nextAction,'owner_approved_independent_staging_required');}
test('release remains locked',()=>assert.equal(CAR02_V478_RELEASE_LOCK,true));
test('unchanged seven V477 proof keys',()=>assert.deepEqual(CAR02_V478_PROOF_KEYS,CAR02_V477_PROOF_KEYS));
test('proof key list immutable',()=>assert.ok(Object.isFrozen(CAR02_V478_PROOF_KEYS)));
test('adapter dependencies mandatory',()=>assert.throws(()=>createCar02OfflineStagingBoundaryPreflightR478(),/ADAPTERS_REQUIRED/));
test('invalid configured shop rejected',()=>assert.throws(()=>createCar02OfflineStagingBoundaryPreflightR478({expectedShopCode:'test shop'}),/ADAPTERS_REQUIRED/));
test('valid isolated mock metadata remains NO_GO',async()=>{const x=await exec();no(x.result);assert.equal(x.result.inventoryChecked,true);assert.equal(x.result.proofsChecked,true);assert.deepEqual(x.calls,{inventory:1,proofs:1,owner:1});});
test('request supplied shop cannot widen inventory scope',async()=>{const x=await exec();no(x.result);assert.equal(x.svc.scopedShopCode,shop);});
test('actual protected project ref collision rejected',async()=>{const x=await exec({inventory:{...project(),stagingProjectRef:prod}});no(x.result);assert.equal(x.result.reason,'protected_project_collision');assert.equal(x.calls.proofs,0);});
test('empty protected inventory rejected',async()=>{const x=await exec({inventory:{...project(),protectedProjectRefs:[]}});no(x.result);assert.equal(x.result.reason,'project_inventory_untrusted');});
test('duplicate protected project rejected',async()=>{const x=await exec({inventory:{...project(),protectedProjectRefs:[prod,prod]}});no(x.result);});
test('uppercase project ref rejected',async()=>{const x=await exec({inventory:{...project(),stagingProjectRef:stag.toUpperCase()}});no(x.result);});
test('invalid project ref length rejected',async()=>{const x=await exec({inventory:{...project(),stagingProjectRef:'short'}});no(x.result);});
test('provider environment not accepted as offline fixture',async()=>{const x=await exec({inventory:{...project(),environment:'production'}});no(x.result);});
test('customer data row presence rejected',async()=>{const x=await exec({inventory:{...project(),customerRows:1}});no(x.result);});
test('provider credentials presence rejected',async()=>{const x=await exec({inventory:{...project(),providerCredentialsPresent:true}});no(x.result);});
test('provider network calls presence rejected',async()=>{const x=await exec({inventory:{...project(),providerCallsEnabled:true}});no(x.result);});
test('extra inventory authorization field rejected',async()=>{const x=await exec({inventory:{...project(),allowRelease:true}});no(x.result);});
test('wrong auditor tenant rejected before project inventory',async()=>{const x=await exec({auditor:{shopCode:'qa_shop_b'}});no(x.result);assert.equal(x.calls.inventory,0);});
test('unverified auditor rejected',async()=>{const x=await exec({auditor:{verified:false}});no(x.result);});
test('production-mode auditor rejected',async()=>{const x=await exec({auditor:{mode:'production'}});no(x.result);});
test('real isolation input rejected',async()=>{const x=await exec({isolation:{environment:'production'}});no(x.result);});
test('isolation provider call toggle rejected',async()=>{const x=await exec({isolation:{providerCallsEnabled:true}});no(x.result);});
test('missing proof rejected',async()=>{const x=await exec({proofs:proof().slice(1)});no(x.result);assert.equal(x.result.reason,'proof_manifest_untrusted');});
test('duplicate proof rejected',async()=>{const a=proof();a[1]={...a[1],key:a[0].key};const x=await exec({proofs:a});no(x.result);});
test('proof claim verified is rejected',async()=>{const a=proof();a[0]={...a[0],state:'verified'};const x=await exec({proofs:a});no(x.result);});
test('real provider evidence is rejected',async()=>{const a=proof();a[0]={...a[0],evidenceClass:'real_provider'};const x=await exec({proofs:a});no(x.result);});
test('extra proof claim field rejected',async()=>{const a=proof();a[0]={...a[0],approved:true};const x=await exec({proofs:a});no(x.result);});
test('offline fixture claim accepted but never verifies real evidence',async()=>{const x=await exec({proofs:proof().map(p=>({...p,state:'mock_claim_only',evidenceClass:'offline_fixture'}))});no(x.result);assert.equal(x.result.proofsChecked,true);});
test('owner self-attested approval is not accepted',async()=>{const x=await exec({owner:{...owner(),approved:true}});no(x.result);assert.equal(x.result.reason,'owner_gate_untrusted');});
test('owner live identity claim is not accepted',async()=>{const x=await exec({owner:{...owner(),verifiedIdentity:true}});no(x.result);});
test('owner authorization-to-create claim is not accepted',async()=>{const x=await exec({owner:{...owner(),authorizationToCreate:true}});no(x.result);});
test('owner different project denied',async()=>{const x=await exec({owner:{...owner(),projectRef:prod}});no(x.result);});
test('owner extra release token denied',async()=>{const x=await exec({owner:{...owner(),releaseToken:'fake'}});no(x.result);});
test('every adapter failure fails closed',async()=>{for(const x of ['auditor','isolation','inventory','proofs','owner']){const y=await exec({throw:x});no(y.result);}});

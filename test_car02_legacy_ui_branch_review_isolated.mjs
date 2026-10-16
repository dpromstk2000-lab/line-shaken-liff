import test from 'node:test';
import assert from 'node:assert/strict';
import {
 CAR02_LEGACY_BRANCH_REVIEW_MODE as MODE,CAR02_LEGACY_UI_BRANCHES as SPECS,
 auditCar02LegacyUiBranches as audit,createCar02BranchBoundInboxQa as create,
 assertCar02QaR13BranchBoundary as r13Boundary
} from './car02-legacy-ui-branch-review-isolated.mjs';
const ID='66666666-6666-4666-8666-666666666666';
const OTHER='77777777-7777-4777-8777-777777777777';
const base={id:ID,reservation_date:'2026-10-20',reservation_time:'10:30:00',status:'入庫予定',
 customer_id:'11111111-1111-4111-8111-111111111111',vehicle_id:'22222222-2222-4222-8222-222222222222',
 customer:{name:'PRIVATE_NAME'},vehicle:{plate_last4:'9090'},phone:'PRIVATE_PHONE',
 memo:'PRIVATE_MEMO',shop_code:'FAKE_CLIENT_SHOP'};
const mk=(page,branch)=>create({page,branch,environment:'isolated_qa',allowIsolatedQa:true});
const req=(rows=[base])=>({ok:true,reservations:rows});
function fixtures(){const sources={};for(const [page,s] of Object.entries(SPECS)){
 sources[s.file]=`const CONTROL_ADAPTER_BASE = 'https://example.invalid/functions/v1/fake';\nconst WORKER_API_BASE = CONTROL_ADAPTER_BASE + "/${s.branch}";\n`+s.markers.join('\n')+'\n'+'.'.repeat(1100);
}return sources}
const fails=(f,c)=>assert.throws(f,new RegExp(c));
test('mode remains QA read-only NO_GO HOLD',()=>{assert.equal(MODE.readOnly,true);assert.equal(MODE.sendable,false);assert.equal(MODE.deployable,false);assert.equal(MODE.release,'NO_GO');assert.equal(MODE.migration,'HOLD')});
test('four page branches explicitly pinned',()=>assert.deepEqual(Object.fromEntries(Object.entries(SPECS).map(([k,x])=>[k,x.branch])),{owner:'wangan',ipad:'ksh',booking:'ksh',member:'ksh'}));
test('valid synthetic checked-out source contracts pass',()=>{const x=audit(fixtures());assert.equal(x.pass,4);assert.equal(x.block,0);assert.equal(x.liveApiChecked,false)});
test('missing source manifest blocked',()=>fails(()=>audit(null),'SOURCES_REQUIRED'));
for(const p of Object.keys(SPECS))test(`missing ${p} source blocked`,()=>{const f=fixtures();delete f[SPECS[p].file];fails(()=>audit(f),'SOURCE_MISSING')});
test('owner route drift to /ksh blocked',()=>{const f=fixtures();f['dashboard.html']=f['dashboard.html'].replace('"/wangan"','"/ksh"');fails(()=>audit(f),'ROUTE_DRIFT')});
test('ipad route drift to /wangan blocked',()=>{const f=fixtures();f['owner-ipad.html']=f['owner-ipad.html'].replace('"/ksh"','"/wangan"');fails(()=>audit(f),'ROUTE_DRIFT')});
test('member route drift blocked',()=>{const f=fixtures();f['member.html']=f['member.html'].replace('"/ksh"','"/wangan"');fails(()=>audit(f),'ROUTE_DRIFT')});
test('multiple WORKER_API_BASE assignments blocked',()=>{const f=fixtures();f['dashboard.html']+='\nconst WORKER_API_BASE=CONTROL_ADAPTER_BASE+"/ksh";';fails(()=>audit(f),'ROUTE_DRIFT')});
test('missing reservation API marker blocked',()=>{const f=fixtures();f['dashboard.html']=f['dashboard.html'].replace('/api/reservations','/api/unknown');fails(()=>audit(f),'PAGE_CONTRACT_DRIFT')});
test('customer-only page cannot create staff inbox',()=>fails(()=>mk('member','ksh'),'ISOLATION_REQUIRED'));
test('booking-only page cannot create staff inbox',()=>fails(()=>mk('booking','ksh'),'ISOLATION_REQUIRED'));
test('owner page refuses /ksh',()=>fails(()=>mk('owner','ksh'),'ISOLATION_REQUIRED'));
test('ipad page refuses /wangan',()=>fails(()=>mk('ipad','wangan'),'ISOLATION_REQUIRED'));
test('production mode refuses inbox',()=>fails(()=>create({page:'owner',branch:'wangan',environment:'production',allowIsolatedQa:true}),'ISOLATION_REQUIRED'));
test('missing opt-in refuses inbox',()=>fails(()=>create({page:'ipad',branch:'ksh',environment:'isolated_qa'}),'ISOLATION_REQUIRED'));
test('random page refuses inbox',()=>fails(()=>mk('dashboard','wangan'),'ISOLATION_REQUIRED'));
test('wangan source can be reviewed but never authorizes order',()=>{const v=mk('owner','wangan').project(req());assert.equal(v.items.length,1);assert.equal(v.sourceBranch,'wangan');assert.equal(v.sourceVerified,false);assert.equal(v.sendable,false)});
test('ksh source can be reviewed but never authorizes order',()=>{const v=mk('ipad','ksh').project(req());assert.equal(v.items[0].reservationId,ID);assert.equal(v.sourceBranch,'ksh');assert.equal(v.serverVerified,false)});
test('legacy PII and tenant claims never projected',()=>{const v=mk('ipad','ksh').project(req());const data=JSON.stringify(v);for(const x of ['PRIVATE_NAME','PRIVATE_PHONE','PRIVATE_MEMO','9090','FAKE_CLIENT_SHOP','11111111-1111'])assert.ok(!data.includes(x),x)});
test('owner inbox cannot become ksh R13 case',()=>{const a=mk('owner','wangan');const x=a.inspectionOnly(a.project(req()),ID);fails(()=>r13Boundary(x),'BOUNDARY_DENIED')});
test('ipad inbox emits only non-sendable KSH fixture inspection marker',()=>{const a=mk('ipad','ksh');const x=a.inspectionOnly(a.project(req()),ID);const z=r13Boundary(x);assert.deepEqual(z,{reservationId:ID,sendable:false,authorization:'SERVER_VERIFICATION_REQUIRED',release:'NO_GO',migration:'HOLD'});assert.ok(!('customerId'in z));assert.ok(!('shopCode'in z))});
test('inspection marker is NOT an HTTP or DB request',()=>{const a=mk('ipad','ksh');const z=a.inspectionOnly(a.project(req()),ID);assert.equal(typeof z.send,'undefined');assert.equal(z.authorizesOrder,false)});
test('cannot inspect another page projection',()=>{const a=mk('owner','wangan'),b=mk('ipad','ksh');fails(()=>b.inspectionOnly(a.project(req()),ID),'SNAPSHOT_INVALID')});
test('cannot inspect cancelled booking',()=>{const a=mk('ipad','ksh'),s=a.project(req([{...base,status:'キャンセル'}]));fails(()=>a.inspectionOnly(s,ID),'NOT_REVIEWABLE')});
test('cannot inspect unknown status',()=>{const a=mk('ipad','ksh'),s=a.project(req([{...base,status:'UNKNOWN'}]));fails(()=>a.inspectionOnly(s,ID),'NOT_REVIEWABLE')});
test('nonexistent reservation rejected at QA review',()=>{const a=mk('ipad','ksh'),s=a.project(req());fails(()=>a.inspectionOnly(s,OTHER),'NOT_REVIEWABLE')});
test('client-supplied envelope branch rejected',()=>fails(()=>mk('ipad','ksh').project({...req(),branch:'wangan'}),'CLAIM_DENIED'));
test('client-supplied shop_code rejected',()=>fails(()=>mk('ipad','ksh').project({...req(),shop_code:'wangan'}),'CLAIM_DENIED'));
test('client-supplied owner token rejected',()=>fails(()=>mk('ipad','ksh').project({...req(),token:'x'}),'CLAIM_DENIED'));
test('client-supplied actor rejected',()=>fails(()=>mk('ipad','ksh').project({...req(),actor:{role:'owner'}}),'CLAIM_DENIED'));
test('missing reservations envelope rejected',()=>fails(()=>mk('owner','wangan').project({ok:true}),'RESPONSE_INVALID'));
test('duplicate UUID fails closed via V2.1',()=>fails(()=>mk('owner','wangan').project(req([base,base])),'DUPLICATE_ID'));
test('invalid display-only id is omitted via V2.1',()=>{const x=mk('owner','wangan').project(req([{...base,id:'DEMO-0001'}]));assert.equal(x.items.length,0);assert.equal(x.discarded,1)});
test('fake post-verified snapshot rejected',()=>{const a=mk('ipad','ksh'),s=a.project(req());fails(()=>a.inspectionOnly({...s,sourceVerified:true},ID),'SNAPSHOT_INVALID')});
test('fake sendable snapshot rejected',()=>{const a=mk('ipad','ksh'),s=a.project(req());fails(()=>a.inspectionOnly({...s,sendable:true},ID),'SNAPSHOT_INVALID')});
test('branch inspector has no fetch, send or deploy API',()=>{const a=mk('owner','wangan');assert.equal(typeof a.fetch,'undefined');assert.equal(typeof a.send,'undefined');assert.equal(typeof a.deploy,'undefined')});
test('ksh marker cannot select wangan as expected branch',()=>{const a=mk('ipad','ksh');const m=a.inspectionOnly(a.project(req()),ID);fails(()=>r13Boundary(m,{expectedBranch:'wangan'}),'BOUNDARY_DENIED')});

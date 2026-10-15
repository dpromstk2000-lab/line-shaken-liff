import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,readFile,mkdir,writeFile,readdir,rm,symlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {blankDraft} from './car02_customer_provisioning_readonly.mjs';
import {FACTORY,PINNED,auditSourceText,makeBuildPlan,buildFiles,auditWorkingTree,writeBuildPack} from './car02_customer_delivery_factory.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const jd=()=>{let d=blankDraft();d.customerType='new';d.facilityCode='sample_facility';d.domainPlan='existing_domain';
 for(let k of Object.keys(d.approvals))d.approvals[k]=true;return d;};
const clone=x=>structuredClone(x);
const sum=x=>createHash('sha256').update(x).digest('hex');

test('factory identifiers and protected pin count fixed',()=>{assert.equal(FACTORY,'DPRO_CAR02_CUSTOMER_DELIVERY_FACTORY_V2');assert.equal(Object.keys(PINNED).length,7);});
test('all protected Git blob pins are 40-character SHA-1 hex strings',()=>{
 for(const [name,sha] of Object.entries(PINNED)){
  assert.match(sha,/^[a-f0-9]{40}$/,`Invalid Git blob SHA for ${name}`);
 }
});
test('incomplete order never releases / creates tenant / deploys worker',()=>{
 const p=makeBuildPlan(blankDraft());assert.equal(p.intakeComplete,false);
 for(let k of ['customerGoLiveReady','customerEnvironmentCreated','workerDeployed','databaseMigrated','releaseAuthorized','productionTouched'])assert.equal(p[k],false);
 assert.equal(p.releaseDecision,'NO_GO');assert.equal(p.migrationDecision,'HOLD');
});
test('complete sales intake still requires operator acceptance',()=>{
 let p=makeBuildPlan(jd());assert.equal(p.intakeComplete,true);
 assert.equal(p.customerGoLiveReady,false);assert(p.pendingGates.length>=6);
 assert(p.pendingGates.every(x=>x.state==='NOT_VERIFIED'));
});
test('selected features have precise entry files and independent gates',()=>{
 const p=makeBuildPlan(jd());assert.deepEqual(p.selectedServices,['HP','RESERVATION_WEB','CAR02_MANAGEMENT']);
 assert(p.selected.some(x=>x.entry==='CAR02_R133_INTEGRATED_JOURNEY_ISOLATED_DEMO.html'));
 assert(!p.pendingGates.some(x=>x.id.startsWith('R47_')));
});
test('photo option includes six known integration blockers',()=>{
 let d=jd();d.services.push('PRIVATE_PHOTO');const p=makeBuildPlan(d);
 for(let k of ['R50_UPLOAD_COMPOSITION','R51_UPLOAD_ROUTE','R51_BODY_CAP_CONFLICT','R82_DURABLE_INTENT_KEY','R47_DIRECT_STORAGE_DELETE','R93Q_PROCESS_LOCAL_RECEIPTS'])
  assert(p.pendingGates.some(x=>x.id===k));
});
test('LINE option includes consent and login verification',()=>{
 let d=jd();d.services.push('LINE_OFFICIAL');let p=makeBuildPlan(d);
 assert(p.pendingGates.some(x=>x.id==='LINE_IF_ENABLED'));
 assert(p.pendingGates.some(x=>x.id==='LINE_LIFF_REAL_AUTH_QA'));
});
test('safety upgrades are acceptance criteria not deployed claims',()=>{
 const p=makeBuildPlan(jd());assert(p.adoption.some(x=>x.from==='R246-R251'));
 assert(p.adoption.some(x=>x.apply==='PENDING_OFFICIAL_QA'));
 for(let x of p.adoption)assert.notEqual(x.apply,'PRODUCTION_APPLIED');
});
test('adversarial field injection and altered types rejected',()=>{
 const cases=[];
 let d=jd();d.apiKey='supersecret';cases.push(d);
 d=jd();d.SUPABASE_SERVICE_ROLE_KEY='secret';cases.push(d);
 d=jd();d.approvals.extra='true';cases.push(d);
 d=jd();d.facilityCode='../customer';cases.push(d);
 d=jd();d.bookingMinutes=0;cases.push(d);
 d=jd();d.services.push('PRIVATE_PHOTO');d.services=d.services.filter(x=>x!=='CAR02_MANAGEMENT');cases.push(d);
 d=jd();d.services.push('PRIVATE_PHOTO');d.services.push('PRIVATE_PHOTO');cases.push(d);
 d=jd();d.approvals.scope_and_price='true';cases.push(d);
 for(let item of cases)assert.throws(()=>makeBuildPlan(item));
});
test('package manifest verifies SHA256 per output file',()=>{
 const out=buildFiles(jd());const files=out.contents;
 const manifest=JSON.parse(files['MANIFEST_SHA256.json']);
 assert.deepEqual(Object.keys(manifest.sha256).sort(),['BUILD_STEPS.md','CHECKLIST.md','DELIVERY_PLAN.json'].sort());
 for(const [name,digest] of Object.entries(manifest.sha256))assert.equal(sum(files[name]),digest);
 assert.equal(out.plan.releaseDecision,'NO_GO');assert.equal(out.plan.sourceState,'NOT_CHECKED');
});
test('mutated fixture source always detects SHA pin drift',()=>{
 let src=Object.fromEntries(Object.keys(PINNED).map(k=>[k,'/* fixture only */\nconst foo = 1;\n']));
 let p=auditSourceText(src);assert.equal(p.checked,7);assert.equal(p.allMatch,false);
 for(let item of p.items)assert.notEqual(item.actual,item.expected);
});
test('unknown source fields and bad shape fail closed',()=>{
 assert.throws(()=>auditSourceText({}));assert.throws(()=>auditSourceText(null));
 let src=Object.fromEntries(Object.keys(PINNED).map(k=>[k,'/* synthetic input enough */\n']));
 src.extra='not allowed';assert.throws(()=>auditSourceText(src));
});
test('source audit report cannot authorize release even when passed manually',()=>{
 let d=jd();let plan=makeBuildPlan(d,{sourceAudit:{allMatch:true,checked:7}});
 assert.equal(plan.sourceState,'PINNED_SOURCES_MATCH');assert.equal(plan.releaseAuthorized,false);
});
test('100 randomized synthetic customer drafts all remain NO_GO',()=>{
 const options=['HP','LINE_OFFICIAL','RESERVATION_WEB','CAR02_MANAGEMENT','PRIVATE_PHOTO'];
 for(let i=0;i<100;i++){
  let d=jd();d.facilityCode=`sample_${String(i).padStart(4,'0')}`;
  d.services=options.filter((_,j)=>(i+j)%3===0);
  if(!d.services.length)d.services=['RESERVATION_WEB'];
  if(d.services.includes('PRIVATE_PHOTO')&&!d.services.includes('CAR02_MANAGEMENT'))d.services.push('CAR02_MANAGEMENT');
  let p=makeBuildPlan(d);assert.equal(p.releaseDecision,'NO_GO');
  assert(p.pendingGates.every(g=>g.state==='NOT_VERIFIED'));
  assert.equal(p.workerDeployed,false);
 }
});
test('write local pack as flat directory, verify bytes, forbid re-use',async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'car02-factory-'));
 try{
  const output=path.join(base,'client-one');let r=await writeBuildPack(output,jd());
  assert.equal(r.generatedFiles.length,4);
  const names=await readdir(output);assert.equal(names.length,4);
  const m=JSON.parse(await readFile(path.join(output,'MANIFEST_SHA256.json'),'utf8'));
  for(let [p,hash] of Object.entries(m.sha256))assert.equal(sum(await readFile(path.join(output,p),'utf8')),hash);
  await assert.rejects(writeBuildPack(output,jd()),/OUT_EXISTS/);
 }finally{await rm(base,{recursive:true,force:true})}
});
test('existing nonempty or symlink folder cannot be overwritten',async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'car02-prevent-'));
 try{
  await mkdir(path.join(base,'nonempty'));await writeFile(path.join(base,'nonempty','important.txt'),'do not delete');
  await assert.rejects(writeBuildPack(path.join(base,'nonempty'),jd()),/OUT_EXISTS/);
  await symlink(path.join(base,'nonempty'),path.join(base,'shortcut'));
  await assert.rejects(writeBuildPack(path.join(base,'shortcut'),jd()),/OUT_EXISTS/);
  assert.equal(await readFile(path.join(base,'nonempty','important.txt'),'utf8'),'do not delete');
 }finally{await rm(base,{recursive:true,force:true})}
});
test('repo audit refuses synthetic code instead of pretending production verified',async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'car02-repo-'));
 try{
  let a=await auditWorkingTree(base);assert.equal(a.allMatch,false);
  await assert.rejects(writeBuildPack(path.join(base,'client'),jd(),{repoRoot:base}),/PINNED_SOURCE_DRIFT/);
 }finally{await rm(base,{recursive:true,force:true})}
});
test('CLI end-to-end: generate customer plan and reject accidental second invocation',async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'car02-cli-'));
 try{
  const input=path.join(base,'draft.json'),dest=path.join(base,'delivery');
  await writeFile(input,JSON.stringify(jd()));
  const cmd=['car02_customer_delivery_factory.mjs','--intake',input,'--out',dest];
  let p=spawnSync(process.execPath,cmd,{cwd:here,encoding:'utf8',timeout:10000});
  assert.equal(p.status,0,p.stderr);assert.equal(JSON.parse(p.stdout).customerGoLiveReady,false);
  assert.equal((JSON.parse(await readFile(path.join(dest,'DELIVERY_PLAN.json'),'utf8'))).releaseDecision,'NO_GO');
  p=spawnSync(process.execPath,cmd,{cwd:here,encoding:'utf8',timeout:10000});
  assert.equal(p.status,1);assert.match(p.stderr,/CAR02_FACTORY_OUT_EXISTS/);
 }finally{await rm(base,{recursive:true,force:true})}
});
test('CLI forbids credentials in customer import and leaves no output',async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'car02-cli-block-'));
 try{
  const pth=path.join(base,'intake.json'),out=path.join(base,'private');
  const draft=jd();draft.password='oops';await writeFile(pth,JSON.stringify(draft));
  const p=spawnSync(process.execPath,['car02_customer_delivery_factory.mjs','--intake',pth,'--out',out],{cwd:here,encoding:'utf8'});
  assert.equal(p.status,1);await assert.rejects(readdir(out),/ENOENT/);
 }finally{await rm(base,{recursive:true,force:true})}
});

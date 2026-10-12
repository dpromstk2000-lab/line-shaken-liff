// R98 static browser worksheet. No network, storage API, or backend code.
import {blankR98Intake,validateR98Intake,parseR98Import,exportR98Json,R98_APPROVALS,R98_SERVICES} from './car02-r98-intake-model.mjs';
const $=id=>document.getElementById(id);
let current=blankR98Intake();
const f=$('entry');const checklist=$('checklist');
const approvalInputs=new Map();
for(const [name,label] of R98_APPROVALS){
 const div=document.createElement('label');div.className='check';
 const cb=document.createElement('input');cb.type='checkbox';cb.name=name;cb.setAttribute('aria-label',label);
 cb.addEventListener('change',sync);
 const span=document.createElement('span');span.textContent=label;
 div.append(cb,span);checklist.append(div);approvalInputs.set(name,cb);
}
const services=$('services');services.textContent=R98_SERVICES.join(' / ');
function fromForm(){const v=blankR98Intake();
 const read=id=>$(id).value.trim();
 v.customerType=read('customerType')||null;
 v.facilityCode=read('facilityCode')||null;
 v.domainPlan=read('domainPlan')||null;
 v.bookingMinutes=read('bookingMinutes')?Number(read('bookingMinutes')):null;
 for(const [name,cb] of approvalInputs)v.approvals[name]=cb.checked;
 return v;
}
function toForm(v){
 for(const id of ['customerType','facilityCode','domainPlan','bookingMinutes'])$(id).value=v[id]??'';
 for(const [name,cb] of approvalInputs)cb.checked=v.approvals[name];
 sync();
}
const labels=Object.fromEntries([...R98_APPROVALS,...[['customerType','新規・既存'],['facilityCode','施設コード'],['domainPlan','ドメイン計画'],['bookingMinutes','予約間隔']]]);
function sync(){
 const pending=$('pending');const status=$('status');const notice=$('notice');
 try{
  const v=fromForm(),report=validateR98Intake(v);current=v;
  status.textContent=report.intakeInformationComplete?'受注情報の確認完了（公開未承認）':`確認待ち ${report.pending.length} 項目`;
  pending.textContent=report.pending.length?report.pending.map(x=>labels[x]||x).join('、'):'受注情報に未入力項目はありません。ただし公開は許可されません。';
  pending.classList.remove('error');notice.textContent='';
  $('export').disabled=false;
 }catch(e){
  status.textContent='入力エラー';pending.textContent=e.code||'入力を確認してください';pending.classList.add('error');
  notice.textContent='修正が終わるまで保存できません。';$('export').disabled=true;
 }
}
for(const id of ['customerType','facilityCode','domainPlan','bookingMinutes'])$(id).addEventListener('input',sync);
f.addEventListener('submit',event=>{event.preventDefault();
 let content;try{content=exportR98Json(fromForm())}catch{sync();return}
 const blob=new Blob([content],{type:'application/json;charset=utf-8'});
 const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;
 a.download='DPRO_CAR02_R98_INTAKE_LOCAL_ONLY.json';a.style.display='none';document.body.append(a);a.click();a.remove();
 // Revoke on the next user interaction instead of racing browser download initiation.
 window.addEventListener('focus',()=>URL.revokeObjectURL(u),{once:true});
 $('notice').textContent='JSONをPCに保存しました。お客様の個人情報は入力しないでください。';
});
$('reset').addEventListener('click',()=>{toForm(blankR98Intake());$('notice').textContent='入力内容を初期化しました。';});
$('importFile').addEventListener('change',async event=>{
 const file=event.target.files?.[0];event.target.value='';if(!file)return;
 if(file.size>12000){$('notice').textContent='読込エラー：JSONが大きすぎます。';return;}
 try{const text=await file.text();const v=parseR98Import(text);toForm(v);$('notice').textContent='JSONを読み込みました。';}
 catch{$('notice').textContent='読込エラー：R97形式の安全なJSONだけ使用できます。';}
});
toForm(current);

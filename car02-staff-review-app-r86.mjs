// DPRO CAR02 R86 isolated browser UI. Deliberately contains NO fetch/XHR/WebSocket.
// It does not authenticate, request tokens, persist storage, call LINE, or mutate DB.
import {demoMembers,reviewStats,visibleMembers,buildStaffChangeReview,
  ROLE_LABEL,ERROR_LABEL,DEMO_ACTOR_SUB} from './car02-staff-review-model-r86.mjs';
const $=id=>document.getElementById(id);
const members=demoMembers();
const stats=reviewStats(members);
const pages=['staff','dashboard','history','help'];
const pageLabels={staff:'スタッフ管理',dashboard:'ダッシュボード',history:'変更履歴',help:'操作ガイド'};
const pageDescriptions={staff:'スタッフの権限・利用状態を確認し、変更内容を安全にレビューできます。',dashboard:'スタッフ管理状況の確認用サマリーです。',history:'監査履歴の見え方を確認するためのデモです。',help:'スタッフ権限変更の確認方法と安全上の注意をご案内します。'};
let selected=null,filter='all';
function item(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
function setFeedback(s){$('feedback').textContent=s||'';}
function setSelected(id){
  selected=members.find(m=>m.id===id)||null;
  const who=$('selectedName'),detail=$('selectedDetail');
  if(!selected){who.textContent='選択してください';detail.textContent='左の一覧からスタッフを選んでください。';}
  else{who.textContent=selected.name+(selected.self?'（本人）':'');detail.textContent=`${selected.team} / ${ROLE_LABEL[selected.role]} / ${selected.active?'有効':'停止中'}`;}
  for(const name of ['roleSelect','statusSelect','reasonInput','reviewButton'])$(name).disabled=!selected||selected.self;
  if(selected){$('roleSelect').value=selected.role;$('statusSelect').value=String(selected.active);$('reasonInput').value='';}
  $('charCount').textContent='0 / 512';
  setFeedback(selected?.self?'本人の権限変更はできません。':'');
  renderRows();
}
function renderRows(){
  const list=visibleMembers(members,{query:$('staffSearch').value,filter});
  const tbody=$('staffRows');tbody.replaceChildren();
  if(!list.length){const row=item('tr');const cell=item('td','muted-placeholder','対象のスタッフが見つかりません。');cell.colSpan=4;row.append(cell);tbody.append(row);}
  for(const m of list){
    const tr=item('tr',selected?.id===m.id?'chosen':'');
    const tdPerson=item('td');const person=item('div','person');
    const av=item('span','av',m.name.replace(/\s/g,'').slice(0,1));av.setAttribute('aria-hidden','true');
    const names=item('div');names.append(item('b','',m.name));names.append(item('small','',m.team));person.append(av,names);tdPerson.append(person);
    const tdRole=item('td');tdRole.append(item('span','tag '+(m.role==='owner'?'owner':''),ROLE_LABEL[m.role]));
    const tdActive=item('td');tdActive.append(item('span','tag '+(m.active?'active':'inactive'),m.active?'● 有効':'● 停止中'));
    const tdButton=item('td');const button=item('button','smallbtn',m.self?'本人':selected?.id===m.id?'選択中':'確認する');button.type='button';button.disabled=m.self;button.addEventListener('click',()=>{setSelected(m.id);if(innerWidth<1190)$('editorPanel').scrollIntoView({behavior:'smooth',block:'start'})});tdButton.append(button);
    tr.append(tdPerson,tdRole,tdActive,tdButton);tbody.append(tr);
  }
  $('staffCount').textContent=`表示 ${list.length} 件 / 全 ${members.length} 件（疑似データ）`;
}
function changePage(page){if(!pages.includes(page))return;
  for(const b of document.querySelectorAll('[data-page]')){const on=b.dataset.page===page;b.classList.toggle('active',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
  $('staffPage').classList.toggle('hidden',page!=='staff');
  for(const name of pages.filter(x=>x!=='staff'))$(name+'Page').classList.toggle('hidden',name!==page);
  $('pageTitle').textContent=pageLabels[page];$('breadcrumb').textContent=pageLabels[page];$('pageSub').textContent=pageDescriptions[page];
}
function openPreview(event){event.preventDefault();setFeedback('');if(!selected)return;
  let preview;
  try{preview=buildStaffChangeReview({members,actorSub:DEMO_ACTOR_SUB,targetSub:selected.id,
    nextRole:$('roleSelect').value,nextActive:$('statusSelect').value==='true',reason:$('reasonInput').value});}
  catch(e){setFeedback(ERROR_LABEL[e?.code]||'内容を確認できません。');return;}
  $('dialogMember').textContent=preview.targetName+' さんの権限変更内容';
  $('oldState').textContent=`${ROLE_LABEL[preview.oldRole]} / ${preview.oldActive?'有効':'停止'}`;
  $('newState').textContent=`${ROLE_LABEL[preview.body.nextRole]} / ${preview.body.nextActive?'有効':'停止'}`;
  $('jsonPreview').textContent=JSON.stringify(preview.body,null,2);
  $('endpointPreview').textContent=`通信しないAPI形式: ${preview.method} ${preview.path}`;
  $('reviewDialog').showModal();
}
function init(){
  $('statTotal').textContent=String(stats.total);$('statActive').textContent=String(stats.active);$('statOwners').textContent=String(stats.owners);$('statInactive').textContent=String(stats.inactive);
  document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>changePage(b.dataset.page)));
  document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('selected',x===b));renderRows()}));
  $('staffSearch').addEventListener('input',renderRows);
  $('reasonInput').addEventListener('input',()=>{$('charCount').textContent=`${$('reasonInput').value.length} / 512`;setFeedback('')});
  $('roleSelect').addEventListener('change',()=>setFeedback(''));
  $('statusSelect').addEventListener('change',()=>setFeedback(''));
  $('reviewForm').addEventListener('submit',openPreview);
  $('closeDialog').addEventListener('click',()=>$('reviewDialog').close());
  // Preserve a comprehensible preview even for no-script fallback (the HTML is static).
  setSelected(members.find(m=>m.role==='staff'&&m.active)?.id);
  changePage('staff');
}
init();

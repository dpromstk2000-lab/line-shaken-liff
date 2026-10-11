// DPRO CAR02 R90 isolated browser UI: accessibility + session-only preview trail. Deliberately contains NO fetch/XHR/WebSocket.
// It does not authenticate, request tokens, persist storage, call LINE, or mutate DB.
import {QA_ITEMS} from './car02-r89-acceptance-model.mjs';
import {blankReview,setReviewState,reviewStats as r90Stats,createReviewExport,parseReviewImport} from './car02-company-pc-record-r90.mjs';
import {demoMembers,reviewStats,visibleMembers,buildStaffChangeReview,
  ROLE_LABEL,ERROR_LABEL,DEMO_ACTOR_SUB} from './car02-staff-review-model-r86.mjs';
const $=id=>document.getElementById(id);
const members=demoMembers();
const stats=reviewStats(members);
const pages=['staff','dashboard','history','qa','help'];
const pageLabels={staff:'スタッフ管理',dashboard:'ダッシュボード',history:'変更履歴',qa:'会社PC確認',help:'操作ガイド'};
const pageDescriptions={staff:'スタッフの権限・利用状態を確認し、変更内容を安全にレビューできます。',dashboard:'スタッフ管理状況の確認用サマリーです。',history:'監査履歴の見え方を確認するためのデモです。',qa:'確認結果を端末内で記録・復元します。公開承認には使用しません。',help:'スタッフ権限変更の確認方法と安全上の注意をご案内します。'};
let selected=null,filter='all';
let isInitialized=false;
// Per-tab RAM only. No localStorage, sessionStorage, network, or real audit record.
const previewTrail=[];
function item(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
function setFeedback(s,invalid=false){
  $('feedback').textContent=s||'';
  $('reasonInput').setAttribute('aria-invalid',invalid?'true':'false');
}
function focusEditor(){
  const panel=$('editorPanel');
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  panel.scrollIntoView({behavior:reduceMotion?'auto':'smooth',block:'start'});
  panel.focus({preventScroll:true});
}

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
    const tdButton=item('td');
    const button=item('button','smallbtn',m.self?'本人':selected?.id===m.id?'選択中':'確認する');
    button.type='button';button.disabled=m.self;
    button.setAttribute('aria-label',m.self?`${m.name}（本人の変更はできません）`:`${m.name}の権限変更内容を確認する`);
    button.setAttribute('aria-pressed',String(selected?.id===m.id));
    button.addEventListener('click',()=>{setSelected(m.id);if(innerWidth<1190)focusEditor()});
    tdButton.append(button);
    tr.append(tdPerson,tdRole,tdActive,tdButton);tbody.append(tr);
  }
  $('staffCount').textContent=`表示 ${list.length} 件 / 全 ${members.length} 件（疑似データ）`;
}
function renderPreviewTrail(){
  const wrap=$('previewHistory');
  wrap.replaceChildren();
  $('clearPreviewHistory').disabled=previewTrail.length===0;
  if(!previewTrail.length){wrap.append(item('div','empty','まだ確認したプレビューはありません。'));return;}
  for(const entry of [...previewTrail].reverse()){
    const e=item('div','event');
    e.append(item('strong','',`${entry.clock} / ${entry.member} / 内容の確認のみ`));
    e.append(item('p','',`${entry.before} → ${entry.after}`));
    e.append(item('p','',`変更理由（デモ）: ${entry.reason}`));
    e.append(item('p','', 'API送信なし・権限変更なし・保存なし'));
    wrap.append(e);
  }
}
function recordPreview(review){
  const before=`${ROLE_LABEL[review.oldRole]}・${review.oldActive?'有効':'停止'}`;
  const after=`${ROLE_LABEL[review.body.nextRole]}・${review.body.nextActive?'有効':'停止'}`;
  const clock=new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
  previewTrail.push(Object.freeze({clock,member:review.targetName,before,after,reason:review.body.reason}));
  if(previewTrail.length>10)previewTrail.shift();
  renderPreviewTrail();
}
function changePage(page){if(!pages.includes(page))return;
  document.querySelector('.app').classList.toggle('qa-mode',page==='qa');
  for(const b of document.querySelectorAll('[data-page]')){const on=b.dataset.page===page;b.classList.toggle('active',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
  $('staffPage').classList.toggle('hidden',page!=='staff');
  for(const name of pages.filter(x=>x!=='staff'))$(name+'Page').classList.toggle('hidden',name!==page);
  $('pageTitle').textContent=pageLabels[page];$('breadcrumb').textContent=pageLabels[page];$('pageSub').textContent=pageDescriptions[page];
  if(isInitialized){$('pageAnnouncement').textContent=`${pageLabels[page]}を表示しました。`;}

}
function openPreview(event){event.preventDefault();setFeedback('');if(!selected)return;
  let preview;
  try{preview=buildStaffChangeReview({members,actorSub:DEMO_ACTOR_SUB,targetSub:selected.id,
    nextRole:$('roleSelect').value,nextActive:$('statusSelect').value==='true',reason:$('reasonInput').value});}
  catch(e){
    const invalid=e?.code==='REVIEW_REASON_REQUIRED';
    setFeedback(ERROR_LABEL[e?.code]||'内容を確認できません。',invalid);
    if(invalid)$('reasonInput').focus();
    return;
  }
  $('dialogMember').textContent=preview.targetName+' さんの権限変更内容';
  $('oldState').textContent=`${ROLE_LABEL[preview.oldRole]} / ${preview.oldActive?'有効':'停止'}`;
  $('newState').textContent=`${ROLE_LABEL[preview.body.nextRole]} / ${preview.body.nextActive?'有効':'停止'}`;
  $('jsonPreview').textContent=JSON.stringify(preview.body,null,2);
  $('reasonPreview').textContent=`変更理由（確認のみ）: ${preview.body.reason}`;
  $('endpointPreview').textContent=`通信しないAPI形式: ${preview.method} ${preview.path}`;
  $('reviewDialog').showModal();
  recordPreview(preview);
}

// R90: self-reported review states live only in RAM until the user downloads a JSON.
let qaState=blankReview();
function renderQaProgress(){
 const x=r90Stats(qaState);
 $('qaProgress').textContent=`問題なし ${x.ok}件 / 要修正 ${x.issue}件 / 未確認 ${x.pending}件（全${x.total}件）`; 
 $('qaReset').disabled=x.reviewed===0;
}
function qaMessage(message,failed=false){
 $('qaMessage').textContent=message||'';
 $('qaMessage').style.color=failed?'#ae392d':'#1c557d';
}
function renderQaChecklist(){
 const root=$('qaChecklist');root.replaceChildren();
 let parent=null,previous='';
 for(const entry of QA_ITEMS){
   if(entry.group!==previous){parent=item('section','qa-group');parent.append(item('h3','',entry.group));root.append(parent);previous=entry.group;}
   if(!entry.safe){const text=item('p','qa-line locked',entry.label+'（未解除の本番ゲート／この画面では操作不可）');parent.append(text);continue;}
   const row=item('div','qa-result-line '+qaState[entry.id]);
   const l=item('label','',entry.label);l.htmlFor='r90-'+entry.id;
   const select=item('select');select.id='r90-'+entry.id;select.setAttribute('data-qa-id',entry.id);
   select.setAttribute('aria-label',entry.label+'の結果');
   for(const [value,label] of [['pending','未確認'],['ok','問題なし'],['issue','要修正']]){
     const option=item('option','',label);option.value=value;select.append(option);
   }
   select.value=qaState[entry.id];
   select.addEventListener('change',()=>{
      qaState=setReviewState(qaState,entry.id,select.value);
      row.className='qa-result-line '+select.value;
      qaMessage('画面内の記録を更新しました。閉じる前にJSON保存してください。');
      renderQaProgress();
   });
   row.append(l,select);parent.append(row);
 }
 renderQaProgress();
}
function exportQa(){
 const data=JSON.stringify(createReviewExport(qaState),null,2)+'\n';
 const blob=new Blob([data],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;
 a.download='DPRO_CAR02_R90_PC_SELF_CHECK_'+new Date().toISOString().slice(0,10).replaceAll('-','')+'.json';
 document.body.append(a);a.click();a.remove();
 // Revoke after the download event has had a chance to consume its object URL.
 setTimeout(()=>URL.revokeObjectURL(url),5000);
 qaMessage('JSON保存を開始しました。保存先を確認してください。これは自己申告メモであり正式QAの証明ではありません。');
}
async function importQa(file){
 if(!file)return;
 if(file.size>16384||file.size<2){qaMessage('ファイルのサイズが不正です（16KB以下のJSONのみ）。',true);return;}
 try{
   const next=parseReviewImport(await file.text());
   qaState=next;
   renderQaChecklist();
   qaMessage('JSONを画面内に復元しました。実際の権限や本番DBには反映されません。');
 }catch{qaMessage('読み込みできませんでした。R90で保存した正しいJSONを選択してください。',true);}
}

function init(){
  renderQaChecklist();
  $('qaPrint').addEventListener('click',()=>window.print());
  $('qaExport').addEventListener('click',exportQa);
  $('qaImport').addEventListener('click',()=>$('qaImportFile').click());
  $('qaImportFile').addEventListener('change',async()=>{await importQa($('qaImportFile').files?.[0]);$('qaImportFile').value='';});
  $('qaReset').addEventListener('click',()=>{qaState=blankReview();renderQaChecklist();qaMessage('確認結果をすべて未確認に戻しました。');});
  $('statTotal').textContent=String(stats.total);$('statActive').textContent=String(stats.active);$('statOwners').textContent=String(stats.owners);$('statInactive').textContent=String(stats.inactive);
  document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>changePage(b.dataset.page)));
  document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{
    filter=b.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(x=>{
      const on=x===b;
      x.classList.toggle('selected',on);
      x.setAttribute('aria-pressed',String(on));
    });
    renderRows();
  }));
  $('staffSearch').addEventListener('input',renderRows);
  $('reasonInput').addEventListener('input',()=>{$('charCount').textContent=`${$('reasonInput').value.length} / 512`;setFeedback('')});
  $('roleSelect').addEventListener('change',()=>setFeedback(''));
  $('statusSelect').addEventListener('change',()=>setFeedback(''));
  $('reviewForm').addEventListener('submit',openPreview);
  $('closeDialog').addEventListener('click',()=>$('reviewDialog').close());
  $('clearPreviewHistory').addEventListener('click',()=>{previewTrail.length=0;renderPreviewTrail();});
  renderPreviewTrail();
  // Quick keyboard access to search outside form controls and modal only.
  document.addEventListener('keydown',event=>{
    if(event.key!=='/'||event.altKey||event.ctrlKey||event.metaKey||event.isComposing||$('reviewDialog').open)return;
    const tag=event.target?.tagName;
    if(['INPUT','TEXTAREA','SELECT'].includes(tag)||event.target?.isContentEditable)return;
    event.preventDefault();changePage('staff');$('staffSearch').focus();
  });
  // Preserve a comprehensible preview even for no-script fallback (the HTML is static).
  setSelected(members.find(m=>m.role==='staff'&&m.active)?.id);
  changePage('staff');
  isInitialized=true;
}
init();

// R112 browser: synthetic fixture only, never calls fetch/Storage, never accepts tenant scope or credentials.
import {R112_DEMO_ITEMS,R112_REASON,R112_EVENT,deriveR112Inbox,formatR112Date} from './car02-r112-review-demo-model.mjs';
const $=id=>document.getElementById(id);
const state={filter:'all',reason:'all',search:'',page:1,expanded:null};
const safe=text=>{const span=document.createElement('span');span.textContent=String(text);return span.innerHTML;};
function redraw(){
 const result=deriveR112Inbox({...state,items:R112_DEMO_ITEMS});
 $('stats-total').textContent=result.stats.total;$('stats-escalated').textContent=result.stats.escalated;
 $('stats-unreviewed').textContent=result.stats.unreviewed;$('stats-reviewed').textContent=result.stats.reviewed;
 $('result-count').textContent=`該当 ${result.matchCount} 件`;
 $('page-label').textContent=`${result.currentPage} / ${result.totalPages} ページ`;
 $('prev').disabled=!result.hasPrevious;$('next').disabled=!result.hasNext;
 document.querySelectorAll('[data-filter]').forEach(b=>{
  const active=b.dataset.filter===state.filter;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));
 });
 const empty=`<div class="empty" role="status">該当する案件はありません。検索条件を変更してください。</div>`;
 $('case-list').innerHTML=result.items.map(x=>{
  const expanded=state.expanded===x.jobId,shortId=x.jobId.slice(-8);
  return `<article class="case" aria-label="仮案件 ${safe(shortId)}">
   <div class="case-main"><div class="case-top"><div class="case-ident"><span class="case-id">案件 #${safe(shortId)}</span><span class="pill ${x.escalated?'pill-warn':x.reviewCount?'pill-reviewed':'pill-pending'}">${x.escalated?'要確認・連絡済み':x.reviewCount?'確認履歴あり':'未確認'}</span></div>
   <div class="reason">${safe(R112_REASON[x.reason])}</div></div>
   <div class="case-meta"><span><b>登録日時</b> ${safe(formatR112Date(x.createdAt))}</span><span><b>確認履歴</b> ${x.reviewCount}件</span><span><b>最終確認</b> ${x.latestRecordedAt?safe(formatR112Date(x.latestRecordedAt)):'なし'}</span></div>
   <button class="details" type="button" data-job="${x.jobId}" aria-expanded="${expanded}">${expanded?'閉じる':'内容を確認'} <span aria-hidden="true">${expanded?'−':'＋'}</span></button></div>
   ${expanded?`<div class="detail-panel"><div><b>状態</b><span>隔離中（削除・変更はできません）</span></div><div><b>理由</b><span>${safe(R112_REASON[x.reason])}</span></div><div><b>最終確認内容</b><span>${x.latestEventKind?safe(R112_EVENT[x.latestEventKind]):'確認記録なし'}</span></div><div><b>案件識別子</b><span class="mono">${safe(x.jobId)}</span></div></div>`:''}
  </article>`;}).join('')||empty;
 $('case-list').querySelectorAll('[data-job]').forEach(b=>b.addEventListener('click',()=>{state.expanded=state.expanded===b.dataset.job?null:b.dataset.job;redraw();const focus=$('case-list').querySelector(`[data-job="${b.dataset.job}"]`);focus?.focus();}));
}
function bind(){
 document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;state.page=1;state.expanded=null;redraw();}));
 $('reason').addEventListener('change',e=>{state.reason=e.target.value;state.page=1;state.expanded=null;redraw();});
 $('search').addEventListener('input',e=>{state.search=e.target.value;state.page=1;state.expanded=null;redraw();});
 $('prev').addEventListener('click',()=>{state.page=Math.max(1,state.page-1);state.expanded=null;redraw();$('cases-heading').focus();});
 $('next').addEventListener('click',()=>{state.page++;state.expanded=null;redraw();$('cases-heading').focus();});
 $('reset').addEventListener('click',()=>{state.filter='all';state.reason='all';state.search='';state.page=1;state.expanded=null;$('search').value='';$('reason').value='all';redraw();$('search').focus();});
 redraw();
}
if(typeof document!=='undefined'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
}

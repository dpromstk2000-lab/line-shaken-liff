// CAR02 R91 strictly offline UI. No network requests or persistence.
import {makeR91Triage,formatR91Report,R91_LOCKED_GATES} from './car02-r91-triage-model.mjs';
import {createReviewExport,blankReview,setReviewState} from './car02-company-pc-record-r90.mjs';
const $=id=>document.getElementById(id);
let current=makeR91Triage(blankReview());
const label={issue:'要修正',pending:'未確認',ok:'問題なし'};
function element(tag,cls,content){const e=document.createElement(tag);if(cls)e.className=cls;if(content!==undefined)e.textContent=content;return e;}
function announce(msg,isError=false){$('message').textContent=msg;$('message').classList.toggle('error',isError);}
function paint(review){
 current=review;
 for(const [k,v] of Object.entries(review.totals))if($(k+'Count'))$(k+'Count').textContent=String(v);
 $('importLabel').textContent=review.authority==='SELF_REPORTED_ONLY'?'自己申告の確認結果・公開許可ではありません':'未確認';
 const root=$('items');root.replaceChildren();
 for(const state of ['issue','pending','ok']){
  const group=element('section','result-group');const head=element('h2','',`${label[state]}：${review.totals[state]}件`);
  head.className=state;
  group.append(head);
  const list=element('div','result-list');
  const matches=review.actionable.filter(x=>x.state===state);
  if(!matches.length)list.append(element('p','empty','該当する項目はありません。'));
  for(const x of matches){
   const row=element('article','result-row '+state);
   row.append(element('span','status',x.stateLabel));
   const t=element('div','detail');t.append(element('strong','',x.label),element('small','',x.group));
   row.append(t);list.append(row);
  }
  group.append(list);root.append(group);
 }
 const gates=$('gates');gates.replaceChildren();
 for(const g of R91_LOCKED_GATES){gates.append(element('li','',g.label+'（未確認・未承認）'));}
 $('nextTask').textContent=review.totals.issue>0?'「要修正」の項目から原因を確認してください。':review.totals.pending>0?'「未確認」の項目を会社PCで確認してください。':'8項目の自己申告結果は「問題なし」です。ただし本番公開・DB移行は禁止のままです。';
}
async function importFile(file){
 if(!file)return;
 // Protect local browser and reject all oversized or unrelated files before reading.
 if(file.size<2||file.size>16384){announce('16KB以下のR90 JSONのみ読み込めます。',true);return;}
 try{
  const report=makeR91Triage(await file.text());
  paint(report);announce('R90の保存結果を読み込み、要修正・未確認を優先して整理しました。本番には送信していません。');
 }catch{announce('このファイルは読み込めません。R90で保存した正しいJSONを選択してください。',true);}
}
function saveReport(){
 const report=formatR91Report(current);
 const blob=new Blob([report],{type:'text/plain;charset=utf-8'});
 const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download='DPRO_CAR02_R91_COMPANY_PC_TRIAGE.txt';a.click();
 setTimeout(()=>URL.revokeObjectURL(u),5000);
 announce('端末へのテキスト保存を開始しました。この結果は本番承認ではありません。');
}
function sample(){
 let states=blankReview();states=setReviewState(states,'ui_mobile','ok');states=setReviewState(states,'booking_calendar','issue');states=setReviewState(states,'ui_search','ok');
 paint(makeR91Triage(states));announce('これは架空のサンプルです。火曜日の実機結果ではありません。');
}
function init(){
 paint(current);
 $('openFile').addEventListener('click',()=>$('sourceFile').click());
 $('sourceFile').addEventListener('change',async()=>{await importFile($('sourceFile').files?.[0]);$('sourceFile').value='';});
 $('showSample').addEventListener('click',sample);
 $('reset').addEventListener('click',()=>{paint(makeR91Triage(blankReview()));announce('未確認8件に戻しました。');});
 $('saveText').addEventListener('click',saveReport);
 $('print').addEventListener('click',()=>window.print());
}
init();

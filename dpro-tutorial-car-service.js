(function(){
'use strict';

const KEY='dpro_tutorial_car_service_v1_1';
const VERSION='CAR_SERVICE-R3-20260829';
const GUIDE_VERSION='CAR_SERVICE-R4-20260829';
const AUTO_KEY=KEY+'_autostart';
const STEP_COUNT=10;
const steps=[
{id:'KSH-F10-01',surface:'owner_pc',section:'today',primary:'#nav-today',fallback:['#pageTitle'],title:'まず「今日やること」を確認',body:'毎日の入口です。相談対応、入庫対応、顧客・車両確認へ進む前に、今日の全体像を確認します。',safe:'サイドナビの場所を確認するだけです。保存・送信・確定・データ更新は行いません。'},
{id:'KSH-F10-02',surface:'owner_pc',section:'inquiries',primary:'#nav-inquiries',fallback:['#nav-today'],title:'新しい相談は「相談一覧」',body:'LINEや受付から入った相談内容を確認する場所です。相談種別や希望入庫日を見て次の対応を判断します。',safe:'相談状態の変更、保存、返信送信は行いません。'},
{id:'KSH-F10-03',surface:'owner_pc',section:'reservations',primary:'#nav-reservations',fallback:['#nav-inquiries','#nav-today'],title:'入庫予定を確認',body:'お客様の仮希望と店舗確認済みの入庫予定を区別して確認します。',safe:'追加・編集・日時確定・保存は行いません。'},
{id:'KSH-F10-04',surface:'owner_pc',section:'customers',primary:'#nav-customers',fallback:['#nav-reservations','#nav-today'],title:'顧客と車両を一緒に確認',body:'顧客ごとの登録車両を確認する入口です。Tutorialは実顧客の検索語を自動入力しません。',safe:'顧客・車両の追加、編集、削除は行いません。'},
{id:'KSH-F10-05',surface:'owner_pc',section:'reservations',primary:'#reservationProgressStage',fallback:['#nav-reservations'],title:'作業進捗の見方',body:'受付、点検、見積、お客様確認、作業、最終確認、引渡しという進捗の意味を確認します。',safe:'セレクト値は変更せず、onchangeや保存処理も発火させません。'},
{id:'KSH-F10-06',surface:'owner_pc',section:'reservations',primary:'#reservationEstimateBox h4',fallback:['#nav-reservations'],title:'見積エリアを確認',body:'見積金額・作業内訳と、お客様への提示状態を確認する位置を理解します。',safe:'見積エリア内の見出しだけを対象にし、見積提示・保存・承認は行いません。'},
{id:'KSH-F10-07',surface:'owner_pc',section:'followups',primary:'#nav-followups',fallback:['#nav-today'],title:'次回連絡は「チャット候補」',body:'車検案内、オイル交換、見積後再連絡など、次に連絡したい候補の入口を確認します。',safe:'LINE送信、送信済み記録、再連絡登録は行いません。'},
{id:'KSH-F10-08',surface:'owner_pc',section:'opportunities',primary:'#nav-opportunities',fallback:['#nav-followups','#nav-today'],title:'営業候補の見方',body:'車検・オイル交換・次回提案など、次の案内につながる候補の入口を確認します。',safe:'顧客状態、営業結果、通知状態は変更しません。'},
{id:'KSH-F10-09',surface:'owner_pc',section:'today',primary:'button[onclick="openIpadDashboard()"]',fallback:['#nav-today'],title:'iPad現場画面へ移動',body:'現場向けの「今日の現場」「電話・店頭受付」「今後の予定」「顧客検索」を確認するため、次のステップでiPad画面へ移ります。',safe:'Next操作では製品ボタンを自動クリックせず、owner-ipad.htmlへの安全な画面遷移だけを行います。'},
{id:'KSH-F10-10',surface:'owner_ipad',section:'today',primary:'#tab-today',fallback:['.tabs'],title:'iPadの4つの入口を確認',body:'「今日の現場」「電話・店頭受付」「今後の予定」「顧客検索」の4タブが現場操作の中心です。完了後はGuide Centerへ進みます。',safe:'タブ見出しの場所を説明するだけで、受付登録・進捗更新・顧客変更は行いません。'}
];

const guideItems=steps.map((s,i)=>({id:s.id,order:i+1,surface:s.surface,route:s.surface==='owner_ipad'?'owner-ipad.html?embed_demo=1':'dashboard.html?embed_demo=1',primary:s.primary,fallback:s.fallback.slice(),title:s.title,body:s.body,safe:s.safe}));

let idx=0,card=null,hl=null,layer=null,drag=null,lastFocus=null;

function currentSurface(){return /(?:^|\/)owner-ipad\.html$/i.test(location.pathname)?'owner_ipad':'owner_pc';}
function readState(){try{const s=JSON.parse(localStorage.getItem(KEY)||'{}');if(s.version===VERSION&&Number.isInteger(s.step)){return{version:VERSION,step:Math.max(0,Math.min(STEP_COUNT-1,s.step)),done:!!s.done};}}catch(e){}return{version:VERSION,step:0,done:false};}
function load(){const s=readState();idx=s.done?0:s.step;return s;}
function save(done,step){const n=Number.isInteger(step)?step:idx;try{localStorage.setItem(KEY,JSON.stringify({version:VERSION,step:Math.max(0,Math.min(STEP_COUNT-1,n)),done:!!done,updatedAt:new Date().toISOString()}));}catch(e){}}
function visible(el){if(!el||!el.getClientRects().length)return false;const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||cs.opacity==='0')return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth;}
function resolveTarget(){const s=steps[idx];for(const selector of [s.primary].concat(s.fallback||[])){let el=null;try{el=document.querySelector(selector);}catch(e){}if(visible(el))return{el,selector,primary:selector===s.primary};}return null;}
function removeHighlight(){if(hl)hl.remove();hl=null;}
function highlight(){removeHighlight();const found=resolveTarget();if(!found)return null;const r=found.el.getBoundingClientRect();hl=document.createElement('div');hl.className='dpt-highlight';hl.setAttribute('aria-hidden','true');Object.assign(hl.style,{left:(r.left-5)+'px',top:(r.top-5)+'px',width:(r.width+10)+'px',height:(r.height+10)+'px'});layer.appendChild(hl);return found;}
function clamp(x,y){const r=card.getBoundingClientRect(),pad=8;const maxX=Math.max(pad,innerWidth-r.width-pad),maxY=Math.max(pad,innerHeight-r.height-pad);return{x:Math.max(pad,Math.min(x,maxX)),y:Math.max(pad,Math.min(y,maxY))};}
function focusSafe(el){try{el?.focus({preventScroll:true});}catch(e){try{el?.focus();}catch(_){}}}
function render(options={}){if(!card)return;const s=steps[idx],found=highlight();card.querySelector('.dpt-step').textContent=`STEP ${idx+1} / ${STEP_COUNT}`;card.querySelector('h3').textContent=s.title;card.querySelector('.dpt-copy').textContent=s.body;card.querySelector('.dpt-safety').textContent='安全：'+s.safe;card.querySelector('.dpt-fallback').textContent=found?(found.primary?'対象位置をハイライトしています。':'主対象が見つからないため、安全な代替位置をハイライトしています。'):'この画面状態では安全に表示できる対象が見つからないため、説明カードだけで続行できます。';card.querySelector('.dpt-progress i').style.width=((idx+1)*10)+'%';card.querySelector('[data-back]').disabled=idx===0;card.querySelector('[data-next]').textContent=idx===STEP_COUNT-1?'完了':(idx===8?'iPadへ進む':'次へ');save(false);if(options.focus)focusSafe(card.querySelector('[data-next]'));}
function dashboardUrl(){const u=new URL('dashboard.html',location.href);u.searchParams.set('embed_demo','1');return u;}
function ipadUrl(){const back=dashboardUrl();const u=new URL('owner-ipad.html',location.href);u.searchParams.set('embed_demo','1');u.searchParams.set('return',back.href);return u;}
function routeForStep(stepIndex){return stepIndex===9?ipadUrl():dashboardUrl();}
function markAutoStart(){try{sessionStorage.setItem(AUTO_KEY,'1');}catch(e){}}
function takeAutoStart(){try{const v=sessionStorage.getItem(AUTO_KEY)==='1';sessionStorage.removeItem(AUTO_KEY);return v;}catch(e){return false;}}
function navigateForStep(stepIndex){const desired=steps[stepIndex].surface;if(currentSurface()===desired)return false;save(false,stepIndex);markAutoStart();location.href=routeForStep(stepIndex).href;return true;}
function advance(){if(!card)return;if(idx===8){idx=9;save(false,idx);markAutoStart();location.href=ipadUrl().href;return;}if(idx<STEP_COUNT-1){idx++;if(navigateForStep(idx))return;render({focus:true});}else{save(true,idx);close({restoreFocus:false});openGuide();}}
function back(){if(!card||idx===0)return;idx--;if(navigateForStep(idx))return;render({focus:true});}
function skip(){save(true,STEP_COUNT-1);idx=STEP_COUNT-1;close({restoreFocus:false});openGuide();}

function open(start){if(card)return;if(Number.isInteger(start))idx=Math.max(0,Math.min(STEP_COUNT-1,start));else load();if(navigateForStep(idx))return;lastFocus=document.activeElement;layer=document.createElement('div');layer.id='dpro-tutorial-layer';layer.innerHTML=`<div class="dpt-card" role="dialog" aria-modal="false" aria-labelledby="dpt-title"><div class="dpt-handle" tabindex="0" aria-label="Tutorialカード移動ハンドル"><strong>DPRO First10</strong><span>ここをドラッグ</span></div><div class="dpt-progress" aria-hidden="true"><i></i></div><div class="dpt-body"><div class="dpt-step"></div><h3 id="dpt-title"></h3><p class="dpt-copy"></p><div class="dpt-safety"></div><div class="dpt-fallback"></div></div><div class="dpt-actions"><button type="button" class="dpt-secondary" data-back>戻る</button><button type="button" class="dpt-primary" data-next>次へ</button><button type="button" class="dpt-ghost" data-skip>スキップ</button><button type="button" class="dpt-danger" data-close>閉じる</button></div></div>`;document.body.appendChild(layer);card=layer.querySelector('.dpt-card');const handle=card.querySelector('.dpt-handle');handle.addEventListener('pointerdown',e=>{if(e.isPrimary===false)return;if(e.pointerType==='mouse'&&e.button!==0)return;const r=card.getBoundingClientRect();drag={id:e.pointerId,dx:e.clientX-r.left,dy:e.clientY-r.top};card.dataset.dragged='1';try{handle.setPointerCapture(e.pointerId);}catch(_){}e.preventDefault();});handle.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const p=clamp(e.clientX-drag.dx,e.clientY-drag.dy);card.style.left=p.x+'px';card.style.top=p.y+'px';card.style.right='auto';card.style.bottom='auto';highlight();e.preventDefault();});const stop=e=>{if(drag&&(!e||drag.id===e.pointerId))drag=null;};handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);card.querySelector('[data-back]').addEventListener('click',back);card.querySelector('[data-next]').addEventListener('click',advance);card.querySelector('[data-skip]').addEventListener('click',skip);card.querySelector('[data-close]').addEventListener('click',()=>close());render({focus:true});}
function close(options={}){const restore=options.restoreFocus!==false;if(layer)layer.remove();layer=card=hl=null;drag=null;if(restore){const launcher=document.getElementById('dpro-tutorial-launcher');focusSafe(lastFocus&&lastFocus.isConnected?lastFocus:launcher);}}

function openGuide(){
close({restoreFocus:false});
let gc=document.getElementById('dpro-tutorial-guide-center');if(gc)gc.remove();
const state=readState(),hasResume=!state.done&&state.step>0;
gc=document.createElement('section');gc.id='dpro-tutorial-guide-center';gc.setAttribute('role','dialog');gc.setAttribute('aria-modal','true');gc.setAttribute('aria-labelledby','dpt-guide-title');
gc.innerHTML=`<div class="dpt-guide-head"><div><strong>DPRO TUTORIAL</strong><h2 id="dpt-guide-title">CAR SERVICE Guide Center</h2><small>First10 と完全に同じ10ステップ</small></div><button type="button" data-gclose>閉じる</button></div><div class="dpt-guide-content"><div class="dpt-guide-controls"><button type="button" id="dpro-tutorial-guide-start" class="dpt-primary">Start</button>${hasResume?'<button type="button" id="dpro-tutorial-guide-resume" class="dpt-secondary">Resume</button>':''}<button type="button" id="dpro-tutorial-guide-replay" class="dpt-ghost">Replay</button><span class="dpt-guide-state" aria-live="polite">${state.done?'完了済み':`現在 STEP ${state.step+1} / ${STEP_COUNT}`}</span></div><div class="dpt-guide-grid">${guideItems.map(g=>`<article class="dpt-guide-step" data-step-id="${g.id}" data-order="${g.order}" data-surface="${g.surface}" data-route="${g.route}"><div class="dpt-guide-step-kicker">STEP ${g.order} / ${STEP_COUNT} · ${g.id}</div><h3>${g.title}</h3><p>${g.body}</p><dl><div><dt>画面</dt><dd>${g.route}</dd></div><div><dt>対象</dt><dd>${g.primary}</dd></div><div><dt>fallback</dt><dd>${g.fallback.join(' / ')}</dd></div></dl><small>安全：${g.safe}</small></article>`).join('')}</div></div>`;
document.body.appendChild(gc);
const closeGuide=()=>{gc.remove();focusSafe(document.getElementById('dpro-tutorial-guide-center-entry'));};
gc.querySelector('[data-gclose]').onclick=closeGuide;
gc.querySelector('#dpro-tutorial-guide-start').onclick=()=>{gc.remove();idx=0;save(false,0);open(0);};
const resume=gc.querySelector('#dpro-tutorial-guide-resume');if(resume)resume.onclick=()=>{gc.remove();idx=state.step;open(state.step);};
gc.querySelector('#dpro-tutorial-guide-replay').onclick=()=>{gc.remove();idx=0;save(false,0);open(0);};
focusSafe(gc.querySelector('[data-gclose]'));
}

function install(){if(document.getElementById('dpro-tutorial-launcher'))return;const state=readState();idx=state.done?0:state.step;const launcher=document.createElement('button');launcher.id='dpro-tutorial-launcher';launcher.type='button';launcher.textContent='操作ガイド';launcher.setAttribute('aria-label','DPRO Tutorialを開く');launcher.onclick=()=>open();document.body.appendChild(launcher);const entry=document.createElement('button');entry.id='dpro-tutorial-guide-center-entry';entry.type='button';entry.textContent='Guide Center';entry.setAttribute('aria-label','Guide Centerを開く');entry.onclick=()=>openGuide();document.body.appendChild(entry);window.DPROCarServiceTutorial={open,openGuide,replay:()=>{idx=0;save(false,0);open(0);},resume:()=>open(),version:VERSION,guideVersion:GUIDE_VERSION,key:KEY,steps:steps.map((s,i)=>({id:s.id,order:i+1,surface:s.surface,route:s.surface==='owner_ipad'?'owner-ipad.html?embed_demo=1':'dashboard.html?embed_demo=1',primary:s.primary,fallback:s.fallback.slice(),title:s.title})),guideItems:guideItems.map(g=>({id:g.id,order:g.order,surface:g.surface,route:g.route,primary:g.primary,fallback:g.fallback.slice(),title:g.title})),stepCount:STEP_COUNT,guideCount:guideItems.length,state:readState};const auto=takeAutoStart();if(!state.done&&(auto||(currentSurface()==='owner_ipad'&&state.step===9))){setTimeout(()=>open(state.step),80);}}

window.addEventListener('resize',()=>{if(card){const r=card.getBoundingClientRect(),p=clamp(r.left,r.top);card.style.left=p.x+'px';card.style.top=p.y+'px';card.style.right='auto';card.style.bottom='auto';highlight();}});
window.addEventListener('scroll',()=>{if(card)highlight();},{passive:true});
document.addEventListener('keydown',e=>{const gc=document.getElementById('dpro-tutorial-guide-center');if(e.key==='Escape'){if(gc){gc.remove();focusSafe(document.getElementById('dpro-tutorial-guide-center-entry'));}else if(card)close();return;}if(card&&e.key==='ArrowRight'){e.preventDefault();advance();}else if(card&&e.key==='ArrowLeft'){e.preventDefault();back();}});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();

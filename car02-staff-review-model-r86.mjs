// DPRO CAR02 R86 — staff review UI model: synthetic, immutable, no network, no writes.
// For staff access management REVIEW only. R85 is not wired to production.
export const REVIEW_VERSION='CAR02-R86-ISOLATED-STAFF-UI-20261011';
export const DEMO_SHOP='street_house_kitsuki';
export const DEMO_ACTOR_SUB='11111111-1111-4111-8111-111111111111';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const ROLE=new Set(['owner','staff']);
const DATA=Object.freeze([
 Object.freeze({id:DEMO_ACTOR_SUB,name:'山本 太郎',role:'owner',active:true,team:'店舗責任者',last:'本日 09:42',self:true}),
 Object.freeze({id:'22222222-2222-4222-8222-222222222222',name:'佐藤 花子',role:'owner',active:true,team:'管理責任者',last:'昨日 16:10',self:false}),
 Object.freeze({id:'33333333-3333-4333-8333-333333333333',name:'田中 翔',role:'staff',active:true,team:'整備担当',last:'本日 10:05',self:false}),
 Object.freeze({id:'44444444-4444-4444-8444-444444444444',name:'鈴木 葵',role:'staff',active:false,team:'受付・サポート',last:'10月7日',self:false}),
 Object.freeze({id:'55555555-5555-4555-8555-555555555555',name:'高橋 健',role:'staff',active:true,team:'点検担当',last:'昨日 18:20',self:false})
]);
const safe=(x)=>typeof x==='string'?x:'';
export function demoMembers(){return DATA.map(x=>({...x}));}
export function reviewStats(members=DATA){return {total:members.length,active:members.filter(x=>x.active).length,owners:members.filter(x=>x.role==='owner'&&x.active).length,inactive:members.filter(x=>!x.active).length};}
export function visibleMembers(members,{query='',filter='all'}={}){
  const search=safe(query).normalize('NFKC').trim().toLowerCase();
  return members.filter(x=>{
    const matches=!search||[x.name,x.team,x.id,x.role].some(v=>safe(v).normalize('NFKC').toLowerCase().includes(search));
    const f=filter==='all'||(filter==='active'&&x.active)||(filter==='inactive'&&!x.active)||(filter==='owner'&&x.role==='owner');
    return matches&&f;
  });
}
function fail(code){const error=Error(code);error.code=code;throw error;}
export function buildStaffChangeReview({members=DATA,actorSub=DEMO_ACTOR_SUB,shopCode=DEMO_SHOP,targetSub,nextRole,nextActive,reason}={}){
  if(shopCode!==DEMO_SHOP||actorSub!==DEMO_ACTOR_SUB||!UUID.test(safe(targetSub)))fail('REVIEW_SCOPE_INVALID');
  const actor=members.find(x=>x.id===actorSub);
  const target=members.find(x=>x.id===targetSub);
  if(!actor||actor.role!=='owner'||!actor.active||!target||!ROLE.has(target.role))fail('REVIEW_IDENTITY_DENIED');
  if(target.id===actor.id)fail('REVIEW_SELF_CHANGE_DENIED');
  if(!ROLE.has(nextRole)||typeof nextActive!=='boolean')fail('REVIEW_INPUT_INVALID');
  if(typeof reason!=='string'||reason!==reason.trim()||reason.length<8||reason.length>512||/[\u0000-\u001f\u007f]/.test(reason))fail('REVIEW_REASON_REQUIRED');
  if(target.role===nextRole&&target.active===nextActive)fail('REVIEW_UNCHANGED');
  if(target.role==='owner'&&target.active&&(!nextActive||nextRole!=='owner')&&reviewStats(members).owners<=1)fail('REVIEW_LAST_OWNER_PROTECTED');
  // Client can preview the R85 JSON body but cannot assert identity/shop/role/approval.
  // The authoritative server must repeat all checks against the DB in one transaction.
  const body=Object.freeze({expectedRole:target.role,expectedActive:target.active,nextRole,nextActive,reason});
  return Object.freeze({method:'POST',path:`/api/car02/staff/${target.id}/access`,body,
    targetName:target.name,oldRole:target.role,oldActive:target.active,
    previewOnly:true,networkRequests:0,mutations:0});
}
export const ROLE_LABEL=Object.freeze({owner:'オーナー',staff:'スタッフ'});
export const ERROR_LABEL=Object.freeze({
 REVIEW_SCOPE_INVALID:'画面の操作対象が一致しません。',
 REVIEW_IDENTITY_DENIED:'このユーザーへの変更は確認できません。',
 REVIEW_SELF_CHANGE_DENIED:'自分自身の権限は変更できません。',
 REVIEW_INPUT_INVALID:'権限と状態を正しく選択してください。',
 REVIEW_REASON_REQUIRED:'変更理由を8〜512文字で入力してください。',
 REVIEW_UNCHANGED:'変更前と変更後が同じです。',
 REVIEW_LAST_OWNER_PROTECTED:'最後の有効なオーナーは削除・停止できません。'
});

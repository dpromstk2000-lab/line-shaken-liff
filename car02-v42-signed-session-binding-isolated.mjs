/** DPRO CAR02 V4.2 - OFFLINE Ed25519 session issuance / membership-version contract QA ONLY.
 * NOT a Supabase integration, NOT a production signer, NOT a real DB lock or release patch.
 * Keys are injected at runtime by local tests; no keys, secrets, or live user data in source.
 */
import { sign as edSign, verify as edVerify } from 'node:crypto';
export const V42_MODE=Object.freeze({environment:'isolated_qa',deployable:false,
  liveJwtProvider:false,realDb:false,realRowLock:false,sqlApplied:false,release:'NO_GO'});
const denied=()=>{const e=new Error('CAR02_V42_QA_DENIED');e.code='CAR02_V42_QA_DENIED';throw e;};
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const safe=s=>typeof s==='string'&&s.length>0&&s.length<=100&&s===s.trim()&&/^[A-Za-z0-9_.:-]+$/.test(s);
const integer=n=>Number.isSafeInteger(n)&&n>=1&&n<=2147483647;
const roles=new Set(['staff','owner']);
function fields(obj,names){return plain(obj)&&Object.keys(obj).length===names.length&&Object.keys(obj).every(k=>names.includes(k));}
const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v),'utf8').toString('base64url');
function unpack(v){
 if(typeof v!=='string'||v.length<2||v.length>3500||!/^[\w-]+$/.test(v))denied();
 const buf=Buffer.from(v,'base64url');
 if(buf.toString('base64url')!==v)denied();
 let parsed;try{parsed=JSON.parse(buf.toString('utf8'))}catch{denied();}
 return parsed;
}
export function createV42OfflineSessionLab({privateKey,publicKey,kid,issuer,audience,nowSeconds}={}){
 if(!privateKey||privateKey.asymmetricKeyType!=='ed25519'||!publicKey||publicKey.asymmetricKeyType!=='ed25519'||
   !safe(kid)||!safe(issuer)||!safe(audience)||typeof nowSeconds!=='function')denied();
 const trusted=new WeakSet();
 const header=Object.freeze({alg:'EdDSA',typ:'JWT',kid});
 function issue({sub,shopCode,role,authVersion,ttlSeconds=300}={}){
  const now=nowSeconds();
  if(!uuid(sub)||!safe(shopCode)||!roles.has(role)||!integer(authVersion)||
    !Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>900)denied();
  const claims={iss:issuer,aud:audience,sub,shopCode,role,authVersion,iat:now,nbf:now,exp:now+ttlSeconds};
  const content=b64(header)+'.'+b64(claims);
  return content+'.'+edSign(null,Buffer.from(content),privateKey).toString('base64url');
 }
 function verify(token){
  if(typeof token!=='string'||token.length>5000)denied();
  const p=token.split('.');if(p.length!==3)denied();
  const [a,b,c]=p,head=unpack(a),claims=unpack(b);
  if(!fields(head,['alg','typ','kid'])||head.alg!=='EdDSA'||head.typ!=='JWT'||head.kid!==kid||
   !fields(claims,['iss','aud','sub','shopCode','role','authVersion','iat','nbf','exp'])||
   claims.iss!==issuer||claims.aud!==audience||!uuid(claims.sub)||!safe(claims.shopCode)||
   !roles.has(claims.role)||!integer(claims.authVersion)||
   !Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.nbf)||!Number.isSafeInteger(claims.exp))denied();
  const now=nowSeconds();
  if(!Number.isSafeInteger(now)||claims.iat>now||claims.nbf>now||now>=claims.exp||
    claims.iat<=0||claims.nbf<claims.iat||claims.exp<=claims.nbf||claims.exp-claims.iat>900)denied();
  const sig=Buffer.from(c,'base64url');
  if(!c||sig.length!==64||sig.toString('base64url')!==c||
   !edVerify(null,Buffer.from(a+'.'+b),publicKey,sig))denied();
  const verified=Object.freeze({subject:claims.sub,shopCode:claims.shopCode,
    role:claims.role,authVersion:claims.authVersion,expiry:claims.exp});
  trusted.add(verified);
  return verified;
 }
 function authorize({verifiedIdentity,lockedMembership,shopCode}={}){
  if(!verifiedIdentity||!trusted.has(verifiedIdentity)||!plain(lockedMembership)||!safe(shopCode)||
    verifiedIdentity.shopCode!==shopCode||!Number.isSafeInteger(nowSeconds())||nowSeconds()>=verifiedIdentity.expiry||lockedMembership.shop_code!==shopCode||
    lockedMembership.user_sub!==verifiedIdentity.subject||lockedMembership.staff_role!==verifiedIdentity.role||
    lockedMembership.active!==true||!integer(lockedMembership.auth_version)||
    lockedMembership.auth_version!==verifiedIdentity.authVersion)denied();
  // A mock row is NOT proof of a PostgreSQL transaction-scoped lock.
  return Object.freeze({subject:verifiedIdentity.subject,shopCode,role:verifiedIdentity.role,
    authVersion:verifiedIdentity.authVersion,reviewOnly:true});
 }
 return Object.freeze({issue,verify,authorize,mode:V42_MODE});
}

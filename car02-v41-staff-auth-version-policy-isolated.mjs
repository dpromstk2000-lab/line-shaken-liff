/** DPRO CAR02 V4.1 REVIEW/ISOLATED QA ONLY — never import into Worker or production. */
export const V41_MODE=Object.freeze({environment:'isolated_qa',deployable:false,realDatabase:false,
  sqlApplied:false,realJwt:false,release:'NO_GO',schemaMigrated:false});
export const V41_VERSION_MAX=2147483647;
const denied=()=>{const e=new Error('CAR02_V41_REVIEW_DENIED');e.code='CAR02_V41_REVIEW_DENIED';throw e;};
const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const positive=v=>Number.isSafeInteger(v)&&v>=1&&v<=V41_VERSION_MAX;
const nonempty=v=>typeof v==='string'&&v.length>0&&v.length<256&&v===v.trim();
const role=v=>v==='owner'||v==='staff';
function validateRow(row){return isObj(row)&&nonempty(row.shop_code)&&nonempty(row.user_sub)&&
 role(row.staff_role)&&typeof row.active==='boolean'&&nonempty(row.grant_source)&&positive(row.auth_version);}
/** Model PostgreSQL BEFORE UPDATE trigger semantics: any row update revokes older sessions. */
export function v41QaUpdateMembership({environment,allowIsolatedQa,previous,changes}={}) {
 if(environment!=='isolated_qa'||allowIsolatedQa!==true||!validateRow(previous)||!isObj(changes)||
 Object.keys(changes).some(k=>!['staff_role','active','grant_source','updated_at'].includes(k)))denied();
 if(previous.auth_version===V41_VERSION_MAX)denied();
 const next={...previous,...changes,auth_version:previous.auth_version+1};
 if(!validateRow(next)||next.shop_code!==previous.shop_code||next.user_sub!==previous.user_sub)denied();
 return Object.freeze(next);
}
/** Caller-supplied auth_version is NEVER accepted; a verified, server-bound version is mandatory. */
export function v41QaAuthorize({environment,allowIsolatedQa,lockedMembership,verifiedIdentity,shopCode,requiredRole}={}){
 if(environment!=='isolated_qa'||allowIsolatedQa!==true||!validateRow(lockedMembership)||
 !isObj(verifiedIdentity)||verifiedIdentity.signatureVerified!==true||verifiedIdentity.serverIssued!==true||
 !positive(verifiedIdentity.authVersion)||!nonempty(verifiedIdentity.sub)||!nonempty(shopCode)||
 lockedMembership.user_sub!==verifiedIdentity.sub||lockedMembership.shop_code!==shopCode||
 lockedMembership.auth_version!==verifiedIdentity.authVersion||lockedMembership.active!==true||
 !role(requiredRole)||lockedMembership.staff_role!==requiredRole)denied();
 return Object.freeze({shopCode,userSub:verifiedIdentity.sub,role:requiredRole,authVersion:lockedMembership.auth_version});
}
export function v41QaDeleteMembership(){denied();}
export function v41ReviewSource(ddl,providers){
 const schemaTable=typeof ddl==='string'&&/CREATE TABLE public\.ksh_car02_staff_access/.test(ddl);
 const schemaVersion=typeof ddl==='string'&&/^\s*auth_version\s+(?:integer|int4|int)\b/im.test(ddl.split('CREATE TABLE public.ksh_car02_staff_access')[1]||'');
 const readerVersion=typeof providers==='string'&&/SELECT shop_code,user_sub,staff_role,active,auth_version/.test(providers);
 return Object.freeze({schemaTable,schemaVersion,readerVersion,requiresMigration:!schemaVersion||!readerVersion});
}

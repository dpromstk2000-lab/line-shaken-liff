/**
 * DPRO CAR02 V4.0 isolated PG contract against R46 review schema.
 * NOT DEPLOYABLE, NOT A PATCH TO R43/R44, NOT A SCHEMA MIGRATION.
 * auth_version is a PROPOSED column missing from R46_STAFF_GRANTS_QA_ONLY.sql.
 * A PostgreSQL client on that schema will throw; this is intentional FAIL CLOSED.
 * A SELECT FOR UPDATE in a mock does NOT establish database concurrency safety.
 */
import { createHash } from 'node:crypto';
export const V40_MODE=Object.freeze({environment:'isolated_qa',deployable:false,
 realDatabase:false,realRowLockProven:false,sqlApplied:false,release:'NO_GO',
 requiresSchemaReview:true,versionColumnInR46:false});
export const V40_TABLE='public.ksh_car02_staff_access';
export const V40_LOCK_SQL=`SELECT shop_code,user_sub,staff_role,active,auth_version
  FROM public.ksh_car02_staff_access
  WHERE shop_code=$1 AND user_sub=$2 FOR UPDATE`;
const fail=()=>{const e=new Error('CAR02_V40_QA_DENIED');e.code='CAR02_V40_QA_DENIED';throw e;};
const safe=x=>typeof x==='string'&&x.length>0&&x.length<=256&&x===x.trim()&&!/\s/.test(x);
const version=x=>Number.isSafeInteger(x)&&x>0;
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const roles=new Set(['owner','staff']);
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function v40ReviewR46Schema(sql){
 if(typeof sql!=='string')return Object.freeze({tableFound:false,versionAvailable:false,requiresMigration:true});
 const m=sql.match(/CREATE\s+TABLE\s+public\.ksh_car02_staff_access\s*\(([\s\S]*?)\);/i);
 if(!m)return Object.freeze({tableFound:false,versionAvailable:false,requiresMigration:true});
 const body=m[1].split('\n').map(x=>x.replace(/--.*$/,'')).join('\n');
 const present=/^\s*auth_version\s+(?:smallint|integer|int|bigint)\b/im.test(body);
 const required=['shop_code','user_sub','staff_role','active'].every(col=>new RegExp(`^\\s*${col}\\s+`,'im').test(body));
 return Object.freeze({tableFound:true,expectedColumnsPresent:required,versionAvailable:present,
  requiresMigration:!present,sourceIsReviewOnly:/QA\/REVIEW ONLY/.test(sql)});
}
export async function v40QaLockStaffAccess({environment,allowIsolatedQa,tx,client,actor,claims,now,shopCode}={}){
 if(environment!=='isolated_qa'||allowIsolatedQa!==true||!tx||tx.state!=='open'||
  !safe(tx.id)||!client||typeof client.query!=='function'||!plain(actor)||
  actor.verified!==true||!safe(shopCode)||actor.shopCode!==shopCode||
  !roles.has(actor.role)||!safe(actor.subject)||!plain(claims)||
  claims.cryptographicallyVerified!==true||!safe(claims.sub)||
  actor.subject!==`staff:${claims.sub}`||!version(claims.authVersion)||
  !Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(claims.exp)||
  claims.exp<=now)fail();
 let result;
 try { result=await client.query(V40_LOCK_SQL,[shopCode,claims.sub]); }
 catch { fail(); }
 if(tx.state!=='open'||!Array.isArray(result?.rows)||result.rows.length!==1)fail();
 const m=result.rows[0];
 // In particular reject a real R46 row because auth_version is missing there.
 if(!m||m.shop_code!==shopCode||m.user_sub!==claims.sub||
  m.active!==true||!roles.has(m.staff_role)||m.staff_role!==actor.role||
  !version(m.auth_version)||m.auth_version!==claims.authVersion)fail();
 return Object.freeze({txId:tx.id,shopCode,userSub:claims.sub,role:m.staff_role,authVersion:m.auth_version});
}
export async function v40QaAuthorizedReplay({environment,allowIsolatedQa,tx,client,actor,claims,
 shopCode,now,operation,idempotencyKey,intentDigest,readReplay,mutate}={}) {
 if(!safe(operation)||!safe(idempotencyKey)||!/^[-_a-f0-9]{64}$/.test(intentDigest||'')||
 typeof readReplay!=='function'||typeof mutate!=='function')fail();
 const lease=await v40QaLockStaffAccess({environment,allowIsolatedQa,tx,client,actor,claims,now,shopCode});
 const scopeDigest=digest([shopCode,claims.sub,actor.role,operation,idempotencyKey,intentDigest]);
 let previous;
 try { previous=await readReplay({txId:tx.id,shopCode,scopeDigest}); }catch{fail();}
 if(tx.state!=='open')fail();
 if(previous!==null){
  if(!plain(previous)||previous.completed!==true||previous.scopeDigest!==scopeDigest||
   previous.authVersion!==lease.authVersion||previous.userSub!==lease.userSub||
   previous.shopCode!==shopCode||!Object.hasOwn(previous,'snapshot'))fail();
  return structuredClone(previous.snapshot);
 }
 try {const value=await mutate({txId:tx.id,shopCode,scopeDigest,authVersion:lease.authVersion});
  if(tx.state!=='open')fail();return structuredClone(value);
 } catch{fail();}
}

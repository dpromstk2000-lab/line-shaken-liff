// DPRO CAR02 R70 — staff permission lifecycle (REVIEW / TEST ONLY).
// Not a public HTTP handler. Not deployed. Do not execute against production until
// verified backup, schema and release gates have been approved.
// The authenticated actor MUST come from R44 server-side verification, never the browser.
// Existing staff grants only: onboarding/initial owner provisioning are separate gates.

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const goodUuid=x=>typeof x==='string'&&UUID.test(x);
const fail=code=>{throw Error(code)};
const cleanError=e=>{
  if(typeof e?.message==='string'&&/^CAR02_(?:GRANT_|OWNER_|STAFF_|IDENTITY_|AUDIT_|SHOP_)/.test(e.message))return e;
  return Error('CAR02_GRANT_BLOCKED');
};
function validate({actor,shopCode,targetUserSub,nextRole,nextActive,expectedRole,expectedActive,reason}){
  if(typeof shopCode!=='string'||!SHOP.test(shopCode))fail('CAR02_SHOP_INVALID');
  if(!actor||actor.verified!==true||actor.role!=='owner'||actor.shopCode!==shopCode||
    typeof actor.subject!=='string'||!actor.subject.startsWith('staff:')||
    !goodUuid(actor.subject.slice(6)))fail('CAR02_OWNER_REQUIRED');
  if(!goodUuid(targetUserSub)||!['staff','owner'].includes(nextRole)||typeof nextActive!=='boolean'||
     !['staff','owner'].includes(expectedRole)||typeof expectedActive!=='boolean')fail('CAR02_GRANT_INPUT_INVALID');
  if(typeof reason!=='string'||reason!==reason.trim()||reason.length<8||reason.length>512||/[\u0000-\u001f\u007f]/.test(reason))
    fail('CAR02_AUDIT_REASON_REQUIRED');
  const actorSub=actor.subject.slice(6).toLowerCase();
  const targetSub=targetUserSub.toLowerCase();
  if(actorSub===targetSub)fail('CAR02_OWNER_SELF_CHANGE_DENIED');
  return {actorSub,targetSub};
}
export function createCar02StaffPermissionsR70({pool,shopCode,verifyTargetIdentity}={}){
  if(!pool||typeof pool.connect!=='function'||typeof verifyTargetIdentity!=='function'||
    typeof shopCode!=='string'||!SHOP.test(shopCode))fail('CAR02_GRANT_CONFIG_INVALID');
  return async function changeExistingStaffPermission({actor,targetUserSub,nextRole,nextActive,expectedRole,expectedActive,reason}={}){
    const {actorSub,targetSub}=validate({actor,shopCode,targetUserSub,nextRole,nextActive,expectedRole,expectedActive,reason});
    // Enabling staff requires an active, verified identity; revoking permission must
    // still work after Auth deletion/suspension, to avoid locking in a departed worker.
    if(nextActive===true){
      let verified;
      try{verified=await verifyTargetIdentity({userSub:targetSub})}catch{fail('CAR02_IDENTITY_REJECTED')}
      if(verified?.verified!==true||verified?.userSub!==targetSub||verified?.active!==true||
        verified?.isAnonymous===true)fail('CAR02_IDENTITY_REJECTED');
    }
    let client,started=false;
    try{
      client=await pool.connect();
      await client.query('BEGIN');started=true;
      await client.query("SET LOCAL lock_timeout='2s'");
      await client.query("SET LOCAL statement_timeout='20s'");
      // Serialize all grant changes for this shop, preventing concurrent last-owner removal.
      const shop=await client.query('SELECT shop_code FROM public.ksh_demo_shop_settings WHERE shop_code=$1 FOR UPDATE',[shopCode]);
      if(shop.rows?.length!==1||shop.rows[0]?.shop_code!==shopCode)fail('CAR02_SHOP_NOT_FOUND');
      // Require current owner membership from authoritative database, not just JWT claims.
      const owner=await client.query(`SELECT user_sub,staff_role,active FROM public.ksh_car02_staff_access
        WHERE shop_code=$1 AND user_sub=$2 FOR UPDATE`,[shopCode,actorSub]);
      if(owner.rows?.length!==1||owner.rows[0].staff_role!=='owner'||owner.rows[0].active!==true)
        fail('CAR02_OWNER_REQUIRED');
      const target=await client.query(`SELECT user_sub,staff_role,active FROM public.ksh_car02_staff_access
        WHERE shop_code=$1 AND user_sub=$2 FOR UPDATE`,[shopCode,targetSub]);
      if(target.rows?.length!==1||target.rows[0].user_sub!==targetSub)fail('CAR02_STAFF_NOT_FOUND');
      const previous=target.rows[0];
      if(previous.staff_role!==expectedRole||previous.active!==expectedActive)
        fail('CAR02_GRANT_STALE_VERSION');
      if(previous.staff_role===nextRole&&previous.active===nextActive){
        await client.query('COMMIT');started=false;
        return Object.freeze({changed:false,shopCode,targetUserSub:targetSub,role:nextRole,active:nextActive});
      }
      if(previous.staff_role==='owner'&&previous.active===true&&(nextRole!=='owner'||nextActive!==true)){
        const owners=await client.query(`SELECT count(*)::integer AS n FROM public.ksh_car02_staff_access
          WHERE shop_code=$1 AND staff_role='owner' AND active=true`,[shopCode]);
        if(owners.rows?.length!==1||!Number.isInteger(owners.rows[0].n)||owners.rows[0].n<=1)
          fail('CAR02_OWNER_LAST_ACTIVE_REQUIRED');
      }
      const updated=await client.query(`UPDATE public.ksh_car02_staff_access SET staff_role=$3,active=$4,
        grant_source='owner-reviewed',updated_at=now() WHERE shop_code=$1 AND user_sub=$2
        RETURNING shop_code,user_sub,staff_role,active`,[shopCode,targetSub,nextRole,nextActive]);
      if(updated.rows?.length!==1||updated.rows[0].staff_role!==nextRole||updated.rows[0].active!==nextActive)
        fail('CAR02_GRANT_WRITE_FAILED');
      // Audit and authorization change are atomic: missing audit table fails the transaction.
      const audit=await client.query(`INSERT INTO public.ksh_car02_staff_access_audit
        (shop_code,target_user_sub,actor_user_sub,before_role,before_active,after_role,after_active,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [shopCode,targetSub,actorSub,previous.staff_role,previous.active,nextRole,nextActive,reason]);
      if(audit.rows?.length!==1||audit.rows[0].id===undefined||audit.rows[0].id===null)
        fail('CAR02_AUDIT_WRITE_FAILED');
      await client.query('COMMIT');started=false;
      return Object.freeze({changed:true,shopCode,targetUserSub:targetSub,role:nextRole,active:nextActive});
    }catch(e){
      if(started&&client){try{await client.query('ROLLBACK')}catch{}}
      throw cleanError(e);
    }finally{try{client?.release()}catch{}}
  };
}

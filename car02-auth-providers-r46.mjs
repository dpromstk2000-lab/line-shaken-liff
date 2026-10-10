// DPRO CAR02 R46 - server-only identity verifiers and authoritative membership resolvers.
// TEST / REVIEW BUILD ONLY. No client secrets or privileged keys may ship to browser.
// Existing CAR02 release gate remains CLOSED until contractual approval and security review.
const clean = v => typeof v === 'string' ? v.trim() : '';
const uuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean(v));
const fail = () => { throw Error('CAR02_IDENTITY_REJECTED'); };
const safeToken = t => typeof t === 'string' && t.length>=8 && t.length<=8192 && !/\s/.test(t);
const nonBlank = v => typeof v === 'string' && v.length>0 && v.length<=256 && v===v.trim();
function httpsBase(url) {
  const u=new URL(url);
  if(u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname.replace(/\/+$/,'') !== '') throw Error('CAR02_HTTPS_BASE_REQUIRED');
  return u.origin;
}
async function strictJson(response) {
  if(!response?.ok) fail();
  let data; try{data=await response.json()}catch{fail()}
  if(!data || typeof data!=='object' || Array.isArray(data)) fail();
  return data;
}
export function createLineIdTokenVerifierR46({channelId, fetchImpl=fetch, nowSeconds=()=>Math.floor(Date.now()/1000)}={}) {
  if(!nonBlank(channelId) || typeof fetchImpl !== 'function' || typeof nowSeconds !== 'function') throw Error('CAR02_LINE_CONFIG_INVALID');
  return async ({idToken,clientId}) => {
    if(clientId!==channelId || !safeToken(idToken)) fail();
    const body=new URLSearchParams({id_token:idToken,client_id:channelId});
    let r; try { r=await fetchImpl('https://api.line.me/oauth2/v2.1/verify',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,redirect:'error',signal:AbortSignal.timeout(6000)
    });}catch{fail()}
    const d=await strictJson(r);
    if(!nonBlank(d.sub) || d.aud!==channelId || d.iss!=='https://access.line.me' ||
      !Number.isSafeInteger(Number(d.exp)) || Number(d.exp)<=nowSeconds()) fail();
    return {sub:d.sub,aud:d.aud,iss:d.iss,exp:Number(d.exp)};
  };
}
function jwtClaims(token){
  const p=token.split('.');
  if(p.length!==3 || !p.every(x=>/^[\w-]+$/.test(x))) fail();
  let data;try{ data=JSON.parse(atob(p[1].replace(/-/g,'+').replace(/_/g,'/'))); }catch{fail()}
  if(!data||typeof data!=='object'||Array.isArray(data))fail();
  return data;
}
export function createSupabaseStaffTokenVerifierR46({supabaseUrl,anonKey,fetchImpl=fetch,nowSeconds=()=>Math.floor(Date.now()/1000)}={}) {
  const origin=httpsBase(supabaseUrl);
  if(!safeToken(anonKey) || typeof fetchImpl!=='function' || typeof nowSeconds!=='function')throw Error('CAR02_SUPABASE_CONFIG_INVALID');
  const issuer=origin+'/auth/v1';
  return async ({accessToken}) => {
    if(!safeToken(accessToken))fail();
    const claims=jwtClaims(accessToken);
    if(!uuid(claims.sub)||claims.iss!==issuer||claims.aud!=='authenticated'||claims.role!=='authenticated'||
      !Number.isSafeInteger(claims.exp)||claims.exp<=nowSeconds())fail();
    // This network roundtrip performs Supabase Auth's signature/session validation.
    // JWT payload alone is NEVER sufficient evidence.
    let r;try{r=await fetchImpl(issuer+'/user',{method:'GET',headers:{apikey:anonKey,Authorization:'Bearer '+accessToken},redirect:'error',signal:AbortSignal.timeout(6000)})}catch{fail()}
    const user=await strictJson(r);
    if(!uuid(user.id)||user.id!==claims.sub||user.aud!=='authenticated')fail();
    return {verified:true,sub:user.id,exp:claims.exp};
  };
}
export function createLineCustomerResolverR46({pool}={}) {
  if(!pool || typeof pool.query!=='function')throw Error('CAR02_DB_REQUIRED');
  return async ({shopCode,lineSub}) => {
    if(!nonBlank(shopCode)||!nonBlank(lineSub))fail();
    // Two rows mean an ambiguous LINE link: fail-closed, never select the first.
    const result=await pool.query(`SELECT id,shop_code,line_user_id,status FROM public.ksh_demo_customers
      WHERE shop_code=$1 AND line_user_id=$2 AND status='LINE連携済み' LIMIT 2`,[shopCode,lineSub]);
    if(result.rows?.length!==1)fail();
    const r=result.rows[0];
    if(!uuid(r.id)||r.shop_code!==shopCode||r.line_user_id!==lineSub||r.status!=='LINE連携済み')fail();
    return {active:true,customerId:r.id,shopCode:r.shop_code,lineSub:r.line_user_id};
  };
}
export function createStaffAccessResolverR46({lookupMembership}={}) {
  // There is NO CAR02 staff membership schema in the legacy ksh_demo_* tables.
  // Until a real permission-bound membership reader is supplied, reject everything.
  return async ({userSub,shopCode}) => {
    if(!uuid(userSub)||!nonBlank(shopCode)||typeof lookupMembership!=='function')fail();
    const result=await lookupMembership({userSub,shopCode});
    if(!result || result.active!==true||result.userSub!==userSub||result.shopCode!==shopCode||
      !['staff','owner'].includes(result.role))fail();
    return {active:true,userSub,shopCode,role:result.role};
  };
}
// Run ONLY on server with a privileged, tenant-scoped PostgreSQL connection.
export function createDbStaffMembershipLookupR46({pool}={}) {
  if(!pool || typeof pool.query !== 'function') throw Error('CAR02_DB_REQUIRED');
  return async ({userSub,shopCode}) => {
    if(!uuid(userSub)||!nonBlank(shopCode))fail();
    const r=await pool.query(`SELECT shop_code,user_sub,staff_role,active
      FROM public.ksh_car02_staff_access WHERE shop_code=$1 AND user_sub=$2 LIMIT 2`,[shopCode,userSub]);
    if(r.rows?.length!==1)fail();
    const x=r.rows[0];
    if(x.shop_code!==shopCode||x.user_sub!==userSub||x.active!==true||
       !['owner','staff'].includes(x.staff_role))fail();
    return {active:true,userSub:x.user_sub,shopCode:x.shop_code,role:x.staff_role};
  };
}
export function createCar02AuthProvidersR46({lineChannelId,supabaseUrl,supabaseAnonKey,pool,lookupStaffMembership,fetchImpl=fetch,nowSeconds}={}) {
  const args={fetchImpl,...(nowSeconds?{nowSeconds}:{})};
  return {
    verifyLineIdToken:createLineIdTokenVerifierR46({channelId:lineChannelId,...args}),
    verifyStaffJwt:createSupabaseStaffTokenVerifierR46({supabaseUrl,anonKey:supabaseAnonKey,...args}),
    resolveLineCustomer:createLineCustomerResolverR46({pool}),
    resolveStaffAccess:createStaffAccessResolverR46({lookupMembership:lookupStaffMembership || createDbStaffMembershipLookupR46({pool})})
  };
}

// DPRO CAR02 R44 - VERIFIED IDENTITY BOUNDARY - REVIEW / TEST ONLY
// All verification and record resolution callbacks MUST be authoritative server-side operations.
// Never pass a client-supplied role, shop code, staff ID, or customer ID directly as identity.
// This module is not a standalone authentication provider or deployable production runtime.
import { Car02Error } from './car02-core.mjs';

const bad = () => { throw new Car02Error('CAR02_UNAUTHORIZED', 401); };
const uuid = s => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const nonblank = s => typeof s === 'string' && s.length > 0 && s.length <= 256 && s.trim() === s;
const exactBearer = s => typeof s === 'string' && /^Bearer [^\s]{8,8192}$/.test(s) ? s.substring(7) : '';
const isLive = x => x && x.active === true;

export function createCar02Authenticator({
  shopCode, lineClientId, verifyLineIdToken, verifyStaffJwt,
  resolveLineCustomer, resolveStaffAccess, nowSeconds = () => Math.floor(Date.now()/1000)
}) {
  if(!nonblank(shopCode) || !nonblank(lineClientId) || ![verifyLineIdToken,verifyStaffJwt,resolveLineCustomer,resolveStaffAccess,nowSeconds].every(x=>typeof x==='function')) {
    throw Error('CAR02_IDENTITY_CONFIG_REQUIRED');
  }
  return async function authenticate(req) {
    if (!req?.headers || typeof req.headers.get !== 'function') bad();
    const lineToken=req.headers.get('x-line-id-token') || '';
    const authHeader=req.headers.get('authorization') || '';
    if(Boolean(lineToken)===Boolean(authHeader)) bad(); // exactly one credential type
    try {
      if(lineToken) {
        if(lineToken.length<8 || lineToken.length>8192 || /\s/.test(lineToken)) bad();
        // LINE verify endpoint must verify signature and id_token using this channel's client_id.
        const id=await verifyLineIdToken({idToken:lineToken, clientId:lineClientId});
        if(!nonblank(id?.sub) || id?.aud!==lineClientId || id?.iss!=='https://access.line.me' ||
           !Number.isInteger(Number(id?.exp)) || Number(id.exp)<=nowSeconds()) bad();
        // Link is looked up server-side and may ONLY be active for this shop.
        const member=await resolveLineCustomer({shopCode,lineSub:id.sub});
        if(!isLive(member) || member.shopCode!==shopCode || member.lineSub!==id.sub || !uuid(member.customerId)) bad();
        return Object.freeze({verified:true,role:'customer',subject:`line:${id.sub}`,shopCode,customerId:member.customerId});
      }
      const token=exactBearer(authHeader);
      if(!token) bad();
      // Verification MUST include JWT signature, exp, issuer, and audience checks.
      const jwt=await verifyStaffJwt({accessToken:token});
      if(!nonblank(jwt?.sub) || jwt?.verified!==true || !Number.isInteger(Number(jwt?.exp)) || Number(jwt.exp)<=nowSeconds()) bad();
      const staff=await resolveStaffAccess({userSub:jwt.sub,shopCode});
      if(!isLive(staff) || staff.shopCode!==shopCode || staff.userSub!==jwt.sub ||
         !['owner','staff'].includes(staff.role)) bad();
      return Object.freeze({verified:true,role:staff.role,subject:`staff:${jwt.sub}`,shopCode});
    } catch { bad(); } // never expose LINE subject, auth secrets, or verifier errors
  };
}

// Gate is ALWAYS server-configured and never reads query strings / request JSON.
export function createCar02ReleaseGate(serverState) {
  return async function releaseEnabled() {
    const x=typeof serverState==='function' ? await serverState() : serverState;
    return x?.systemCode==='CAR02' && x?.contracted===true && x?.goLiveApproved===true &&
      x?.migrationVerified===true && x?.verifiedIdentityBound===true && x?.workerBackendReady===true &&
      x?.externalNotificationsReviewed===true;
  };
}

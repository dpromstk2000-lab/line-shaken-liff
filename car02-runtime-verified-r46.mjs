// DPRO CAR02 R46 - non-deployed Node/PostgreSQL server assembly.
// All supplied credentials must be server-side; the shared production DB has NOT been migrated.
// This module cannot bypass R44/R45 release gate and cannot activate CAR02 itself.
import {createCar02RuntimeR45} from './car02-runtime-r45.mjs';
import {createCar02AuthProvidersR46} from './car02-auth-providers-r46.mjs';
export function createCar02VerifiedRuntimeR46({
 pool,shopCode,lineChannelId,supabaseUrl,supabaseAnonKey,lookupStaffMembership,
 releaseState,allowedOrigins=[],fetchImpl,nowSeconds
}={}) {
 // releaseState is obligatory and must come from trusted server configuration.
 if(releaseState===undefined)throw Error('CAR02_RELEASE_GATE_REQUIRED');
 const verifiers=createCar02AuthProvidersR46({
  pool,lineChannelId,supabaseUrl,supabaseAnonKey,lookupStaffMembership,
  ...(fetchImpl?{fetchImpl}:{}),...(nowSeconds?{nowSeconds}:{})
 });
 return createCar02RuntimeR45({
  pool,shopCode,lineClientId:lineChannelId,...verifiers,
  releaseState,allowedOrigins,nowSeconds
 });
}

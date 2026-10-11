import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('./R93F_TERMINAL_LEASE_FENCE_PG17_ASSERT_QA_ONLY.sql',import.meta.url),'utf8');
test('R93F is PostgreSQL 17 disposable fixture only and always rolled back',()=>{
 assert.match(sql,/current_database\(\) <> 'postgres'/);assert.match(sql,/\bBEGIN;/);
 assert.match(sql,/\bROLLBACK;/);assert.match(sql,/QA ONLY/);
 assert.doesNotMatch(sql,/\bCOMMIT\s*;/i);
});
test('R93F has no live schema mutations or external network access',()=>{
 assert.doesNotMatch(sql,/\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|INDEX|VIEW)\s+public\./i);
 assert.doesNotMatch(sql,/\b(?:dblink|http_post|net\.http_|storage\.objects)\b/i);
 assert.doesNotMatch(sql,/(?:service_role|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=/i);
});
const guards=[/p_confirmed_404 IS TRUE/,/j\.id=p_job/,/j\.lease_id=p_lease/,/j\.shop_code=p_shop/,
 /j\.photo_id=p_photo/,/j\.storage_path=p_path/,/j\.state='leased'/,/j\.lease_expires>p_now/,
 /p\.id=j\.photo_id/,/p\.shop_code=j\.shop_code/,/p\.order_id=j\.order_id/,
 /p\.report_id=j\.report_id/,/p\.storage_bucket=j\.storage_bucket/,
 /p\.storage_path=j\.storage_path/,/p\.upload_state='deleted'/,
 /p\.created_at=j\.photo_created_at/,/REVOKE ALL ON FUNCTION/];
for(const [i,guard] of guards.entries())test('R93F SQL transaction gate '+(i+1),()=>assert.match(sql,guard));
const attacks=['FORGED_PROBE','OTHER_SHOP','FORGED_LEASE','OTHER_PHOTO','SWAPPED_BLOB','READY_PHOTO','EXPIRED_LEASE','DUPLICATE_FINALIZE'];
for(const name of attacks)test('R93F SQL rejection case '+name,()=>assert.match(sql,new RegExp('R93F_'+name+'_ACCEPTED')));

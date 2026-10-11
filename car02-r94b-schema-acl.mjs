// R94B disposable PostgreSQL QA only: compare semantics, not raw nspacl::text.
// No queries to Supabase or production systems are made by this module.
import assert from 'node:assert/strict';

export const R94B_SCHEMA_ACL_SQL = `
 SELECT n.nspname AS schema_name, own.rolname AS schema_owner,
  CASE WHEN x.grantee=0 THEN 'PUBLIC'
       ELSE COALESCE(grantee.rolname,'MISSING_GRANTEE_OID:'||x.grantee::text) END AS grantee,
  CASE WHEN x.grantor=0 THEN 'PUBLIC'
       ELSE COALESCE(grantor.rolname,'MISSING_GRANTOR_OID:'||x.grantor::text) END AS grantor,
  x.privilege_type, x.is_grantable
 FROM pg_namespace AS n
 JOIN pg_roles AS own ON own.oid=n.nspowner
 CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) AS x
 LEFT JOIN pg_roles AS grantee ON grantee.oid=x.grantee
 LEFT JOIN pg_roles AS grantor ON grantor.oid=x.grantor
 WHERE n.nspname='car02_r93q_qa'
 ORDER BY schema_name,schema_owner,grantee,grantor,privilege_type,is_grantable`;

export function normalizeR94BSchemaAcl(rows){
 // PostgreSQL can return one remaining privilege after a deliberate owner USAGE revoke.
 // Accept that single row for validation, then FAIL CLOSED at R94B_OWNER_USAGE_MISSING.
 // Truly empty ACLs remain invalid.
 assert.ok(Array.isArray(rows)&&rows.length>0,'R94B_ACL_EMPTY_OR_MISSING');
 const a=rows.map(r=>{
  assert.equal(r.schema_name,'car02_r93q_qa','R94B_UNEXPECTED_SCHEMA');
  for(const name of ['schema_owner','grantee','grantor']){
   assert.ok(typeof r[name]==='string'&&r[name].length>0,`R94B_INVALID_ACL_${name}`);
   assert.ok(!r[name].startsWith('MISSING_'),`R94B_UNRESOLVED_ACL_${name}`);
  }
  assert.ok(['USAGE','CREATE'].includes(r.privilege_type),'R94B_UNEXPECTED_SCHEMA_PRIVILEGE');
  assert.equal(typeof r.is_grantable,'boolean','R94B_BAD_GRANTABLE');
  return {schema:r.schema_name,owner:r.schema_owner,grantee:r.grantee,
   grantor:r.grantor,privilege:r.privilege_type,grantable:r.is_grantable};
 });
 // Fail closed if the baseline or restore does not represent the owner's full schema ACL.
 const owner=a[0].owner;
 assert.ok(a.every(r=>r.owner===owner),'R94B_MIXED_SCHEMA_OWNER');
 for(const priv of ['USAGE','CREATE']){
  assert.ok(a.some(r=>r.grantee===owner&&r.privilege===priv),`R94B_OWNER_${priv}_MISSING`);
 }
 return a.sort((x,y)=>{
  const k=v=>[v.schema,v.owner,v.grantee,v.grantor,v.privilege,String(v.grantable)].join('\0');
  return k(x)<k(y)?-1:k(x)>k(y)?1:0;
 });
}

-- DPRO CAR02 V4.49 — OFFLINE READ-ONLY ambiguous COMMIT reconciliation.
-- ONLY disposable PostgreSQL 17. NEVER run on shared or production Supabase.
-- All users, generations and timestamps are synthetic. No actual provider proof.
-- This returns point-in-time OBSERVATIONS, never permission to authenticate or
-- to start phase 2 automatically. Network COMMIT ACK loss is modeled, not recreated.
\set ON_ERROR_STOP on
DO $$BEGIN IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V449_DISPOSABLE_PG17_ONLY'; END IF; END$$;
CREATE ROLE v449_anon NOLOGIN;
CREATE ROLE v449_authenticated NOLOGIN;
CREATE SCHEMA v449_private;
REVOKE ALL ON SCHEMA v449_private FROM PUBLIC,v449_anon,v449_authenticated;
CREATE TABLE v449_private.qa_members(
 shop_code text NOT NULL CHECK(shop_code ~ '^[A-Za-z0-9_-]{1,64}$'),
 user_sub uuid NOT NULL,active boolean NOT NULL,
 auth_version integer NOT NULL CHECK(auth_version>=1),generation_nonce uuid NOT NULL,
 fence_at timestamptz,
 PRIMARY KEY(shop_code,user_sub)
);
REVOKE ALL ON v449_private.qa_members FROM PUBLIC,v449_anon,v449_authenticated;
CREATE FUNCTION v449_private.qa_reconcile_cutover(
 p_shop text,p_sub uuid,p_expected integer,p_nonce uuid)
RETURNS TABLE(phase text,observed_version integer)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,v449_private AS $$
DECLARE member record;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR
  p_sub IS NULL OR p_expected IS NULL OR p_expected<1 OR
  p_expected>=2147483646 OR p_nonce IS NULL
 THEN RAISE EXCEPTION 'V449_INVALID_READ_SCOPE';END IF;
 SELECT m.active,m.auth_version,m.generation_nonce,m.fence_at INTO member
 FROM v449_private.qa_members m WHERE m.shop_code=p_shop AND m.user_sub=p_sub;
 IF NOT FOUND THEN RETURN; END IF;
 IF member.auth_version=p_expected AND member.active=false AND member.fence_at IS NULL THEN
  RETURN QUERY SELECT 'prior_generation'::text,member.auth_version;
 ELSIF member.auth_version=p_expected+1 AND member.active=true AND
       member.generation_nonce=p_nonce THEN
  IF member.fence_at IS NULL THEN
    RETURN QUERY SELECT 'committed_unfenced'::text,member.auth_version;
  ELSE
    RETURN QUERY SELECT 'fenced'::text,member.auth_version;
  END IF;
 ELSE
  RETURN QUERY SELECT 'superseded'::text,member.auth_version;
 END IF;
END$$;
REVOKE ALL ON FUNCTION v449_private.qa_reconcile_cutover(text,uuid,integer,uuid)
 FROM PUBLIC,v449_anon,v449_authenticated;
DO $$BEGIN
 IF has_schema_privilege('v449_authenticated','v449_private','USAGE') OR
  has_table_privilege('v449_anon','v449_private.qa_members','SELECT') OR
  has_function_privilege('v449_authenticated','v449_private.qa_reconcile_cutover(text,uuid,integer,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'V449_UNPRIVILEGED_READ_ALLOWED'; END IF;
END$$;
\echo V449_PG17_PRIVILEGED_READ_ONLY_PUBLIC_DENY_PASS
INSERT INTO v449_private.qa_members VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004491',false,2,
  '00000000-0000-0000-0000-000000004480',NULL),
 ('qa_shop_b','00000000-0000-0000-0000-000000004491',false,2,
  '00000000-0000-0000-0000-000000004480',NULL),
 ('qa_shop_a','00000000-0000-0000-0000-000000004492',true,3,
  '00000000-0000-0000-0000-000000004498',clock_timestamp()-interval '10 minutes'),
 ('qa_shop_a','00000000-0000-0000-0000-000000004493',true,3,
  '00000000-0000-0000-0000-000000004499',NULL);
DO $$DECLARE stage text;v integer;BEGIN
 SELECT phase,observed_version INTO stage,v FROM v449_private.qa_reconcile_cutover(
  'qa_shop_a','00000000-0000-0000-0000-000000004491',2,
  '00000000-0000-0000-0000-000000004498');
 IF stage IS DISTINCT FROM 'prior_generation' OR v<>2 THEN
  RAISE EXCEPTION 'V449_EXPECTED_PRIOR_GENERATION';END IF;
END$$;
\echo V449_PG17_PRIOR_GENERATION_OBSERVED_NO_ROLLBACK_INFERENCE_PASS
-- A committed phase-1 cutover with a LOST ACK is only an observed, unfenced row.
BEGIN;
UPDATE v449_private.qa_members SET active=true,auth_version=3,
 generation_nonce='00000000-0000-0000-0000-000000004498',fence_at=NULL
 WHERE shop_code='qa_shop_a' AND user_sub='00000000-0000-0000-0000-000000004491'
 AND active=false AND auth_version=2;
COMMIT;
DO $$DECLARE stage text;v integer;BEGIN
 SELECT phase,observed_version INTO stage,v FROM v449_private.qa_reconcile_cutover(
  'qa_shop_a','00000000-0000-0000-0000-000000004491',2,
  '00000000-0000-0000-0000-000000004498');
 IF stage IS DISTINCT FROM 'committed_unfenced' OR v<>3 OR
  (SELECT fence_at FROM v449_private.qa_members WHERE shop_code='qa_shop_a' AND
   user_sub='00000000-0000-0000-0000-000000004491') IS NOT NULL
 THEN RAISE EXCEPTION 'V449_COMMITTED_UNFENCED_INCORRECT';END IF;
END$$;
\echo V449_PG17_AMBIGUOUS_PHASE1_READ_ONLY_UNFENCED_PASS
-- In a different transaction, phase-2 may already have been committed despite lost ACK.
BEGIN;
UPDATE v449_private.qa_members SET fence_at=clock_timestamp()
 WHERE shop_code='qa_shop_a' AND user_sub='00000000-0000-0000-0000-000000004491'
 AND auth_version=3 AND generation_nonce='00000000-0000-0000-0000-000000004498' AND fence_at IS NULL;
COMMIT;
DO $$DECLARE stage text;v integer;BEGIN
 SELECT phase,observed_version INTO stage,v FROM v449_private.qa_reconcile_cutover(
  'qa_shop_a','00000000-0000-0000-0000-000000004491',2,
  '00000000-0000-0000-0000-000000004498');
 IF stage IS DISTINCT FROM 'fenced' OR v<>3 THEN RAISE EXCEPTION 'V449_FENCE_NOT_OBSERVED';END IF;
END$$;
\echo V449_PG17_AMBIGUOUS_PHASE2_OBSERVED_FENCED_PASS
-- Wrong nonce is never treated as matching even when version/fence look correct.
DO $$DECLARE stage text;BEGIN
 SELECT phase INTO stage FROM v449_private.qa_reconcile_cutover(
  'qa_shop_a','00000000-0000-0000-0000-000000004491',2,
  '00000000-0000-0000-0000-000000004499');
 IF stage IS DISTINCT FROM 'superseded' THEN RAISE EXCEPTION 'V449_WRONG_NONCE_MATCHED'; END IF;
 IF EXISTS(SELECT 1 FROM v449_private.qa_reconcile_cutover(
  'qa_shop_a','00000000-0000-0000-0000-000000009999',2,
  '00000000-0000-0000-0000-000000004498')) THEN RAISE EXCEPTION 'V449_MISSING_USER_PRESENT'; END IF;
 IF (SELECT phase FROM v449_private.qa_reconcile_cutover(
  'qa_shop_b','00000000-0000-0000-0000-000000004491',2,
  '00000000-0000-0000-0000-000000004498')) IS DISTINCT FROM 'prior_generation'
 THEN RAISE EXCEPTION 'V449_CROSS_TENANT_STATE_CORRUPTED'; END IF;
END$$;
\echo V449_PG17_BAD_NONCE_MISSING_SUBJECT_CROSS_TENANT_DENY_PASS
-- A later revocation supersedes a previously observed fence. The observation
-- from a past snapshot MUST NOT be used to authorize subsequent mutations.
BEGIN;
UPDATE v449_private.qa_members SET active=false,auth_version=4,
 generation_nonce='00000000-0000-0000-0000-000000004497',fence_at=NULL
 WHERE shop_code='qa_shop_a' AND user_sub='00000000-0000-0000-0000-000000004491';
COMMIT;
DO $$DECLARE stage text;v integer;BEGIN
 SELECT phase,observed_version INTO stage,v FROM v449_private.qa_reconcile_cutover(
  'qa_shop_a','00000000-0000-0000-0000-000000004491',2,
  '00000000-0000-0000-0000-000000004498');
 IF stage IS DISTINCT FROM 'superseded' OR v<>4 THEN
  RAISE EXCEPTION 'V449_REVOKED_FENCE_RESURRECTED';END IF;
END$$;
\echo V449_PG17_REVOKED_FENCE_SUPERSEDED_PASS
-- 8 read-only clients race the unchanged second synthetic row, verified by workflow.

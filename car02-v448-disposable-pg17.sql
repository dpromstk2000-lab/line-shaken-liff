-- CAR02 V4.48 SYNTHETIC two-connection post-commit membership fence QA.
-- Disposable PostgreSQL 17 ONLY. No auth.sessions or real Supabase/Worker/LINE.
-- COMMIT ACK is enforced by offline JS coordinator, NOT proven by SQL alone.
-- Test provider session timestamps are created by the same disposable PG17 server;
-- production must establish trusted provider/session time-domain consistency.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V448_PG17_ONLY'; END IF; END $$;
CREATE ROLE v448_anon NOLOGIN;
CREATE ROLE v448_authenticated NOLOGIN;
CREATE SCHEMA v448_private;
REVOKE ALL ON SCHEMA v448_private FROM PUBLIC,v448_anon,v448_authenticated;
CREATE TABLE v448_private.qa_members(
 shop_code text NOT NULL CHECK(shop_code ~ '^[A-Za-z0-9_-]{1,64}$'),
 user_sub uuid NOT NULL,
 active boolean NOT NULL,
 auth_version integer NOT NULL CHECK(auth_version>=1),
 generation_nonce uuid NOT NULL,
 fence_at timestamptz,
 PRIMARY KEY(shop_code,user_sub)
);
CREATE TABLE v448_private.qa_provider_sessions(
 id uuid PRIMARY KEY,user_sub uuid NOT NULL,created_at timestamptz NOT NULL,active boolean NOT NULL
);
REVOKE ALL ON v448_private.qa_members,v448_private.qa_provider_sessions
 FROM PUBLIC,v448_anon,v448_authenticated;
CREATE FUNCTION v448_private.qa_cutover(p_shop text,p_sub uuid,p_expected integer,p_nonce uuid)
RETURNS TABLE(new_version integer,generation_nonce uuid)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,v448_private AS $$
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR p_sub IS NULL OR
    p_expected IS NULL OR p_expected<1 OR p_expected>=2147483646 OR p_nonce IS NULL
 THEN RAISE EXCEPTION 'V448_INVALID_CUTOVER'; END IF;
 RETURN QUERY UPDATE v448_private.qa_members m
 SET active=true,auth_version=m.auth_version+1,generation_nonce=p_nonce,fence_at=NULL
 WHERE m.shop_code=p_shop AND m.user_sub=p_sub AND m.active=false AND m.auth_version=p_expected
 RETURNING m.auth_version,m.generation_nonce;
END$$;
CREATE FUNCTION v448_private.qa_establish_fence(p_shop text,p_sub uuid,p_version integer,p_nonce uuid)
RETURNS TABLE(established boolean)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,v448_private AS $$
DECLARE c integer;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR p_sub IS NULL OR
    p_version IS NULL OR p_version<2 OR p_nonce IS NULL
 THEN RAISE EXCEPTION 'V448_INVALID_FENCE'; END IF;
 UPDATE v448_private.qa_members m SET fence_at=clock_timestamp()
 WHERE m.shop_code=p_shop AND m.user_sub=p_sub AND m.auth_version=p_version AND
       m.generation_nonce=p_nonce AND m.active=true AND m.fence_at IS NULL;
 GET DIAGNOSTICS c=ROW_COUNT;
 RETURN QUERY SELECT c=1;
END$$;
CREATE FUNCTION v448_private.qa_live_session(p_shop text,p_sub uuid,p_session uuid)
RETURNS TABLE(auth_version integer,session_created timestamptz,fence_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,v448_private AS $$
 SELECT m.auth_version,s.created_at,m.fence_at
 FROM v448_private.qa_members m JOIN v448_private.qa_provider_sessions s ON s.user_sub=m.user_sub
 WHERE m.shop_code=p_shop AND m.user_sub=p_sub AND m.active=true AND
       m.fence_at IS NOT NULL AND s.id=p_session AND s.active=true AND s.created_at>m.fence_at
$$;
REVOKE ALL ON FUNCTION v448_private.qa_cutover(text,uuid,integer,uuid),
 v448_private.qa_establish_fence(text,uuid,integer,uuid),
 v448_private.qa_live_session(text,uuid,uuid)
 FROM PUBLIC,v448_anon,v448_authenticated;
DO $$ BEGIN
 IF has_schema_privilege('v448_authenticated','v448_private','USAGE') OR
    has_table_privilege('v448_anon','v448_private.qa_members','UPDATE') OR
    has_function_privilege('v448_authenticated','v448_private.qa_cutover(text,uuid,integer,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'V448_UNPRIVILEGED_CUTOVER_AVAILABLE'; END IF;
END$$;
\echo V448_PG17_PRIVATE_SCHEMA_DENY_PASS
INSERT INTO v448_private.qa_members VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004481',false,2,
  '00000000-0000-0000-0000-000000004480',NULL),
 ('qa_shop_b','00000000-0000-0000-0000-000000004481',false,2,
  '00000000-0000-0000-0000-000000004480',NULL),
 ('qa_shop_a','00000000-0000-0000-0000-000000004489',false,2,
  '00000000-0000-0000-0000-000000004480',NULL),
 ('qa_shop_a','00000000-0000-0000-0000-000000004490',false,2,
  '00000000-0000-0000-0000-000000004480',NULL);
INSERT INTO v448_private.qa_provider_sessions VALUES
 ('00000000-0000-0000-0000-000000004482','00000000-0000-0000-0000-000000004481',clock_timestamp()-interval '2 hours',true);
-- A rolled-back transaction MUST NOT affect membership or set a fence.
BEGIN;
SELECT * FROM v448_private.qa_cutover('qa_shop_a','00000000-0000-0000-0000-000000004481',2,
 '00000000-0000-0000-0000-000000004488');
ROLLBACK;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM v448_private.qa_members WHERE shop_code='qa_shop_a' AND
   user_sub='00000000-0000-0000-0000-000000004481' AND (active=true OR auth_version<>2 OR fence_at IS NOT NULL))
 THEN RAISE EXCEPTION 'V448_ROLLBACK_DID_NOT_UNDO_CUTOVER'; END IF;
END$$;
\echo V448_PG17_ROLLBACK_NO_FENCE_PASS
-- Explicit committed reactivation does NOT provide access until independent second stage.
BEGIN;
SELECT * FROM v448_private.qa_cutover('qa_shop_a','00000000-0000-0000-0000-000000004481',2,
 '00000000-0000-0000-0000-000000004488');
COMMIT;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM v448_private.qa_live_session('qa_shop_a',
    '00000000-0000-0000-0000-000000004481','00000000-0000-0000-0000-000000004482'))
 THEN RAISE EXCEPTION 'V448_PRE_FENCE_AUTH_ALLOWED'; END IF;
 IF EXISTS(SELECT 1 FROM v448_private.qa_cutover('qa_shop_a','00000000-0000-0000-0000-000000004481',2,
 '00000000-0000-0000-0000-000000004487'))
 THEN RAISE EXCEPTION 'V448_DOUBLE_CUTOVER_ALLOWED'; END IF;
END$$;
\echo V448_PG17_COMMITTED_REACTIVATION_NO_FENCE_PASS
-- Session created in gap between membership COMMIT and fence must be rejected.
INSERT INTO v448_private.qa_provider_sessions VALUES
 ('00000000-0000-0000-0000-000000004483','00000000-0000-0000-0000-000000004481',clock_timestamp(),true);
-- A SEPARATE transaction establishes server DB-clock fence (JS ensures prior COMMIT ACK).
BEGIN;
DO $$ BEGIN
 IF (SELECT established FROM v448_private.qa_establish_fence('qa_shop_a',
 '00000000-0000-0000-0000-000000004481',3,'00000000-0000-0000-0000-000000004487'))
 THEN RAISE EXCEPTION 'V448_WRONG_NONCE_ESTABLISHED_FENCE'; END IF;
 IF NOT (SELECT established FROM v448_private.qa_establish_fence('qa_shop_a',
 '00000000-0000-0000-0000-000000004481',3,'00000000-0000-0000-0000-000000004488'))
 THEN RAISE EXCEPTION 'V448_CORRECT_FENCE_FAILED'; END IF;
END$$;
COMMIT;
DO $$ BEGIN
 IF (SELECT established FROM v448_private.qa_establish_fence('qa_shop_a',
 '00000000-0000-0000-0000-000000004481',3,'00000000-0000-0000-0000-000000004488'))
 THEN RAISE EXCEPTION 'V448_DUPLICATE_FENCE_ALLOWED'; END IF;
 IF EXISTS(SELECT 1 FROM v448_private.qa_live_session('qa_shop_a',
    '00000000-0000-0000-0000-000000004481','00000000-0000-0000-0000-000000004483'))
 THEN RAISE EXCEPTION 'V448_GAP_SESSION_AUTH_ALLOWED'; END IF;
 IF EXISTS(SELECT 1 FROM v448_private.qa_live_session('qa_shop_a',
    '00000000-0000-0000-0000-000000004481','00000000-0000-0000-0000-000000004482'))
 THEN RAISE EXCEPTION 'V448_OLD_SESSION_AUTH_ALLOWED'; END IF;
END$$;
\echo V448_PG17_SEPARATE_FENCE_OLD_SESSIONS_DENIED_PASS
-- New session row from SAME disposable PG server after the fence commit.
SELECT pg_sleep(0.02);
INSERT INTO v448_private.qa_provider_sessions VALUES
 ('00000000-0000-0000-0000-000000004484','00000000-0000-0000-0000-000000004481',clock_timestamp(),true);
DO $$ BEGIN
 IF (SELECT count(*) FROM v448_private.qa_live_session('qa_shop_a',
   '00000000-0000-0000-0000-000000004481','00000000-0000-0000-0000-000000004484'))<>1
 THEN RAISE EXCEPTION 'V448_FRESH_POST_FENCE_SESSION_DENIED'; END IF;
 IF EXISTS(SELECT 1 FROM v448_private.qa_live_session('qa_shop_b',
   '00000000-0000-0000-0000-000000004481','00000000-0000-0000-0000-000000004484'))
 THEN RAISE EXCEPTION 'V448_CROSS_TENANT_SESSION_ALLOWED'; END IF;
END$$;
\echo V448_PG17_FRESH_SAME_CLOCK_SESSION_AND_TENANT_PASS
-- If staff is disabled after cutover COMMIT but before phase 2, no fence may be established.
BEGIN;
SELECT * FROM v448_private.qa_cutover('qa_shop_a','00000000-0000-0000-0000-000000004490',2,
 '00000000-0000-0000-0000-000000004491');
COMMIT;
UPDATE v448_private.qa_members SET active=false,auth_version=4,
 generation_nonce='00000000-0000-0000-0000-000000004492',fence_at=NULL
 WHERE shop_code='qa_shop_a' AND user_sub='00000000-0000-0000-0000-000000004490';
DO $$ BEGIN
 IF (SELECT established FROM v448_private.qa_establish_fence('qa_shop_a',
    '00000000-0000-0000-0000-000000004490',3,'00000000-0000-0000-0000-000000004491'))
 THEN RAISE EXCEPTION 'V448_REVOKED_GENERATION_FENCED'; END IF;
END$$;
\echo V448_PG17_REVOKE_BEFORE_FENCE_BLOCKED_PASS
-- CI tests 8 competing version-2 reactivations of qa_shop_a / user 4489.

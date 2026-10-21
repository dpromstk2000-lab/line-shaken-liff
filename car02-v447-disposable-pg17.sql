-- DPRO CAR02 V4.47 -- SUPERSEDED? NO. Offline feasibility model only.
-- Disposable PG17. NEVER RUN on shared/production Supabase. NO auth.sessions access.
-- `v447_private.qa_provider_sessions` is a MOCK for auth.sessions, not provider data.
-- Fence fields below are SYNTHETIC trusted timestamps; this test does NOT prove
-- the fence is created after a real COMMIT acknowledgment or provider session.
\set ON_ERROR_STOP on
DO $$BEGIN IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V447_PG17_REQUIRED';END IF;END$$;
CREATE ROLE v447_anon NOLOGIN;
CREATE ROLE v447_authenticated NOLOGIN;
CREATE SCHEMA v447_private;
REVOKE ALL ON SCHEMA v447_private FROM PUBLIC,v447_anon,v447_authenticated;
CREATE TABLE v447_private.qa_memberships(
 shop_code text NOT NULL CHECK(shop_code ~ '^[A-Za-z0-9_-]{1,64}$'),
 user_sub uuid NOT NULL,active boolean NOT NULL,
 staff_role text NOT NULL CHECK(staff_role IN ('staff','owner')),
 auth_version integer NOT NULL CHECK(auth_version>0),
 generation_nonce uuid NOT NULL,postcommit_fence_ms bigint,
 PRIMARY KEY(shop_code,user_sub)
);
CREATE TABLE v447_private.qa_provider_sessions(
 id uuid PRIMARY KEY, user_sub uuid NOT NULL,
 created_ms bigint NOT NULL, active boolean NOT NULL
);
REVOKE ALL ON v447_private.qa_memberships,v447_private.qa_provider_sessions
 FROM PUBLIC,v447_anon,v447_authenticated;
-- Providers own the session row in production. Here it is synthetic and inserted by QA.
CREATE FUNCTION v447_private.qa_live_session(p_shop text,p_sub uuid,p_session uuid)
RETURNS TABLE(staff_role text,auth_version integer,generation_nonce uuid,
  session_created_ms bigint,postcommit_fence_ms bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,v447_private AS $$
SELECT m.staff_role,m.auth_version,m.generation_nonce,s.created_ms,m.postcommit_fence_ms
FROM v447_private.qa_memberships m
JOIN v447_private.qa_provider_sessions s ON s.user_sub=m.user_sub
WHERE m.shop_code=p_shop AND m.user_sub=p_sub AND m.active=true
 AND s.id=p_session AND s.active=true AND m.postcommit_fence_ms IS NOT NULL
 AND s.created_ms>m.postcommit_fence_ms
$$;
CREATE FUNCTION v447_private.qa_lock_live_session(p_shop text,p_sub uuid,p_session uuid)
RETURNS TABLE(staff_role text,auth_version integer,generation_nonce uuid,
  session_created_ms bigint,postcommit_fence_ms bigint)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,v447_private AS $$
BEGIN
 RETURN QUERY SELECT m.staff_role,m.auth_version,m.generation_nonce,s.created_ms,m.postcommit_fence_ms
 FROM v447_private.qa_memberships m
 JOIN v447_private.qa_provider_sessions s ON s.user_sub=m.user_sub
 WHERE m.shop_code=p_shop AND m.user_sub=p_sub AND m.active=true
  AND s.id=p_session AND s.active=true AND m.postcommit_fence_ms IS NOT NULL
  AND s.created_ms>m.postcommit_fence_ms
 FOR UPDATE OF m,s;
END$$;
REVOKE ALL ON FUNCTION v447_private.qa_live_session(text,uuid,uuid),
 v447_private.qa_lock_live_session(text,uuid,uuid)
 FROM PUBLIC,v447_anon,v447_authenticated;
DO $$BEGIN
 IF has_schema_privilege('v447_anon','v447_private','USAGE') OR
  has_schema_privilege('v447_authenticated','v447_private','USAGE') OR
  has_function_privilege('v447_authenticated','v447_private.qa_live_session(text,uuid,uuid)','EXECUTE') OR
  has_table_privilege('v447_anon','v447_private.qa_provider_sessions','SELECT')
 THEN RAISE EXCEPTION 'V447_PUBLIC_SESSION_READ_OPEN'; END IF;
END$$;
\echo V447_PG17_PRIVATE_SCHEMA_AND_PUBLIC_DENY_PASS
INSERT INTO v447_private.qa_memberships VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004471',true,'staff',1,
 '00000000-0000-0000-0000-000000004474',1999999970000),
 ('qa_shop_b','00000000-0000-0000-0000-000000004471',false,'staff',1,
 '00000000-0000-0000-0000-000000004474',1999999970000);
INSERT INTO v447_private.qa_provider_sessions VALUES
 ('00000000-0000-0000-0000-000000004472','00000000-0000-0000-0000-000000004471',1999999980000,true);
DO $$BEGIN
 IF (SELECT count(*) FROM v447_private.qa_live_session('qa_shop_a',
  '00000000-0000-0000-0000-000000004471','00000000-0000-0000-0000-000000004472'))<>1
 THEN RAISE EXCEPTION 'V447_INITIAL_SESSION_MISSING';END IF;
 IF EXISTS(SELECT 1 FROM v447_private.qa_live_session('qa_shop_b',
  '00000000-0000-0000-0000-000000004471','00000000-0000-0000-0000-000000004472'))
 THEN RAISE EXCEPTION 'V447_OTHER_TENANT_ACCESS';END IF;
END$$;
\echo V447_PG17_INITIAL_SESSION_TENANT_BOUND_PASS
-- STOP and COMMIT the membership update.
BEGIN;
UPDATE v447_private.qa_memberships SET active=false,auth_version=2,
 generation_nonce='00000000-0000-0000-0000-000000004475',postcommit_fence_ms=NULL
WHERE shop_code='qa_shop_a' AND user_sub='00000000-0000-0000-0000-000000004471';
COMMIT;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM v447_private.qa_live_session('qa_shop_a',
  '00000000-0000-0000-0000-000000004471','00000000-0000-0000-0000-000000004472'))
 THEN RAISE EXCEPTION 'V447_REVOKED_STILL_ACCESSIBLE';END IF;
END$$;
-- Reactivate with a higher generation, but NO trusted postcommit fence yet.
BEGIN;
UPDATE v447_private.qa_memberships SET active=true,auth_version=3,
 generation_nonce='00000000-0000-0000-0000-000000004476',postcommit_fence_ms=NULL
WHERE shop_code='qa_shop_a' AND user_sub='00000000-0000-0000-0000-000000004471';
COMMIT;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM v447_private.qa_live_session('qa_shop_a',
  '00000000-0000-0000-0000-000000004471','00000000-0000-0000-0000-000000004472'))
 THEN RAISE EXCEPTION 'V447_PRE_FENCE_ALLOW';END IF;
END$$;
\echo V447_PG17_COMMITTED_REVOCATION_AND_REACTIVATION_DENY_PASS
-- After both COMMITs, a synthetic privileged operator establishes the fence.
-- In production this needs a separately proven AFTER-COMMIT ack and same clock.
UPDATE v447_private.qa_memberships SET postcommit_fence_ms=2000000001000
WHERE shop_code='qa_shop_a' AND user_sub='00000000-0000-0000-0000-000000004471';
INSERT INTO v447_private.qa_provider_sessions VALUES
 ('00000000-0000-0000-0000-000000004473','00000000-0000-0000-0000-000000004471',2000000002000,true),
 ('00000000-0000-0000-0000-000000004477','00000000-0000-0000-0000-000000004471',2000000000999,true),
 ('00000000-0000-0000-0000-000000004478','00000000-0000-0000-0000-000000004471',2000000001000,true);
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM v447_private.qa_live_session('qa_shop_a',
  '00000000-0000-0000-0000-000000004471','00000000-0000-0000-0000-000000004472'))
 THEN RAISE EXCEPTION 'V447_OLD_REFRESHED_SESSION_ALLOWED';END IF;
 IF EXISTS(SELECT 1 FROM v447_private.qa_live_session('qa_shop_a',
  '00000000-0000-0000-0000-000000004471','00000000-0000-0000-0000-000000004477')) OR
 EXISTS(SELECT 1 FROM v447_private.qa_live_session('qa_shop_a',
  '00000000-0000-0000-0000-000000004471','00000000-0000-0000-0000-000000004478'))
 THEN RAISE EXCEPTION 'V447_BOUNDARY_TIMESTAMP_ALLOWED';END IF;
 IF (SELECT count(*) FROM v447_private.qa_lock_live_session('qa_shop_a',
  '00000000-0000-0000-0000-000000004471','00000000-0000-0000-0000-000000004473'))<>1
 THEN RAISE EXCEPTION 'V447_FRESH_POSTFENCE_PROVIDER_SESSION_MISSING';END IF;
END$$;
\echo V447_PG17_POSTCOMMIT_FENCE_OLD_REFRESH_DENIED_PASS
-- Provider-owned signout removes session, even with an unexpired JWT.
UPDATE v447_private.qa_provider_sessions SET active=false
WHERE id='00000000-0000-0000-0000-000000004473';
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM v447_private.qa_live_session('qa_shop_a',
  '00000000-0000-0000-0000-000000004471','00000000-0000-0000-0000-000000004473'))
 THEN RAISE EXCEPTION 'V447_SIGNEDOUT_SESSION_ACCEPTED';END IF;
 IF (SELECT auth_version FROM v447_private.qa_memberships WHERE shop_code='qa_shop_b')<>1
 THEN RAISE EXCEPTION 'V447_CROSSSHOP_MUTATION';END IF;
END$$;
\echo V447_PG17_SIGNOUT_AND_OTHER_SHOP_PROTECTED_PASS
UPDATE v447_private.qa_provider_sessions SET active=true
WHERE id='00000000-0000-0000-0000-000000004473';
-- CI verifies eight parallel read-only clients: only a truly fresh synthetic session passes.

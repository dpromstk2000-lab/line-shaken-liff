-- DPRO CAR02 V4.50: synthetic atomic session-bound tenant update, PG17 DISPOSABLE ONLY.
-- NEVER RUN on shared/production Supabase. These are FAKE auth sessions, not auth.sessions.
-- A signed JWT must be validated by a real server adapter before using SQL; NO REAL AUTH HERE.
-- A post-COMMIT fence must have been independently established; all timestamps are QA.
\set ON_ERROR_STOP on
DO $$BEGIN IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V450_DISPOSABLE_PG17_ONLY'; END IF;END$$;
CREATE ROLE v450_anon NOLOGIN;
CREATE ROLE v450_authenticated NOLOGIN;
CREATE SCHEMA v450_private;
REVOKE ALL ON SCHEMA v450_private FROM PUBLIC,v450_anon,v450_authenticated;
CREATE TABLE v450_private.qa_members(
 shop_code text NOT NULL CHECK(shop_code ~ '^[A-Za-z0-9_-]{1,64}$'),
 user_sub uuid NOT NULL, active boolean NOT NULL,
 role text NOT NULL CHECK(role IN ('staff','owner')),
 auth_version integer NOT NULL CHECK(auth_version>0), generation_nonce uuid NOT NULL,
 postcommit_fence_at timestamptz,
 PRIMARY KEY(shop_code,user_sub)
);
CREATE TABLE v450_private.qa_provider_sessions(
 session_id uuid PRIMARY KEY, user_sub uuid NOT NULL,
 created_at timestamptz NOT NULL, active boolean NOT NULL
);
CREATE TABLE v450_private.qa_orders(
 shop_code text NOT NULL, id uuid NOT NULL,state_version integer NOT NULL CHECK(state_version>=1),
 PRIMARY KEY(shop_code,id)
);
REVOKE ALL ON v450_private.qa_members,v450_private.qa_provider_sessions,v450_private.qa_orders
 FROM PUBLIC,v450_anon,v450_authenticated;
CREATE FUNCTION v450_private.qa_atomic_session_touch(
 p_shop text,p_sub uuid,p_session uuid,p_order uuid,p_expected integer)
RETURNS TABLE(applied boolean,new_version integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,v450_private AS $$
DECLARE current_version integer; updated_version integer;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR
    p_sub IS NULL OR p_session IS NULL OR p_order IS NULL OR
    p_expected IS NULL OR p_expected<1 OR p_expected>=2147483647
 THEN RAISE EXCEPTION 'V450_INVALID_INPUT'; END IF;
 -- One row-locked statement provides the sole authorization gate. It waits
 -- for in-flight membership/session changes and atomically guards the write.
 SELECT m.auth_version INTO current_version
 FROM v450_private.qa_members m
 JOIN v450_private.qa_provider_sessions s ON s.user_sub=m.user_sub
 WHERE m.shop_code=p_shop AND m.user_sub=p_sub AND m.active=true
   AND m.auth_version>=1 AND m.postcommit_fence_at IS NOT NULL
   AND s.session_id=p_session AND s.active=true AND s.created_at>m.postcommit_fence_at
 FOR UPDATE OF m,s;
 IF NOT FOUND THEN RAISE EXCEPTION 'V450_SESSION_NOT_ALLOWED'; END IF;
 UPDATE v450_private.qa_orders o SET state_version=o.state_version+1
 WHERE o.shop_code=p_shop AND o.id=p_order AND o.state_version=p_expected
 RETURNING o.state_version INTO updated_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'V450_TENANT_OR_VERSION_CONFLICT'; END IF;
 RETURN QUERY SELECT true,updated_version;
END$$;
REVOKE ALL ON FUNCTION v450_private.qa_atomic_session_touch(text,uuid,uuid,uuid,integer)
 FROM PUBLIC,v450_anon,v450_authenticated;
DO $$BEGIN
 IF has_schema_privilege('v450_anon','v450_private','USAGE') OR
    has_table_privilege('v450_authenticated','v450_private.qa_orders','UPDATE') OR
    has_table_privilege('v450_anon','v450_private.qa_provider_sessions','SELECT') OR
    has_function_privilege('v450_authenticated',
      'v450_private.qa_atomic_session_touch(text,uuid,uuid,uuid,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'V450_UNPRIVILEGED_ACCESS_OPEN'; END IF;
END$$;
\echo V450_PG17_PRIVATE_SCHEMA_AND_PUBLIC_DENY_PASS
INSERT INTO v450_private.qa_members VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004501',true,'staff',3,
  '00000000-0000-0000-0000-000000004506',clock_timestamp()-interval '30 minutes'),
 ('qa_shop_b','00000000-0000-0000-0000-000000004501',false,'staff',3,
  '00000000-0000-0000-0000-000000004506',clock_timestamp()-interval '30 minutes');
INSERT INTO v450_private.qa_provider_sessions VALUES
 ('00000000-0000-0000-0000-000000004502','00000000-0000-0000-0000-000000004501',clock_timestamp()-interval '1 minute',true),
 ('00000000-0000-0000-0000-000000004507','00000000-0000-0000-0000-000000004501',clock_timestamp()-interval '2 hours',true),
 ('00000000-0000-0000-0000-000000004508','00000000-0000-0000-0000-000000004509',clock_timestamp()-interval '1 minute',true);
INSERT INTO v450_private.qa_orders VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004503',1),
 ('qa_shop_a','00000000-0000-0000-0000-000000004504',1),
 ('qa_shop_a','00000000-0000-0000-0000-000000004505',1),
 ('qa_shop_b','00000000-0000-0000-0000-000000004503',1);
DO $$DECLARE r record;BEGIN
 SELECT * INTO r FROM v450_private.qa_atomic_session_touch('qa_shop_a',
 '00000000-0000-0000-0000-000000004501','00000000-0000-0000-0000-000000004502',
 '00000000-0000-0000-0000-000000004503',1);
 IF r.applied IS DISTINCT FROM true OR r.new_version<>2 THEN RAISE EXCEPTION 'V450_ATOMIC_TOUCH_FAILED'; END IF;
 IF (SELECT state_version FROM v450_private.qa_orders WHERE shop_code='qa_shop_b')<>1
 THEN RAISE EXCEPTION 'V450_CROSS_TENANT_CHANGED'; END IF;
END$$;
\echo V450_PG17_SESSION_BOUND_ATOMIC_TOUCH_PASS
DO $$DECLARE err text;BEGIN
 BEGIN
   PERFORM * FROM v450_private.qa_atomic_session_touch('qa_shop_a',
    '00000000-0000-0000-0000-000000004501','00000000-0000-0000-0000-000000004502',
    '00000000-0000-0000-0000-000000004503',1);
   RAISE EXCEPTION 'UNEXPECTED_REPLAY_ALLOWED';
 EXCEPTION WHEN raise_exception THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err<>'V450_TENANT_OR_VERSION_CONFLICT' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM * FROM v450_private.qa_atomic_session_touch('qa_shop_a',
    '00000000-0000-0000-0000-000000004501','00000000-0000-0000-0000-000000004507',
    '00000000-0000-0000-0000-000000004504',1);
   RAISE EXCEPTION 'UNEXPECTED_OLD_SESSION_ALLOWED';
 EXCEPTION WHEN raise_exception THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err<>'V450_SESSION_NOT_ALLOWED' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM * FROM v450_private.qa_atomic_session_touch('qa_shop_a',
    '00000000-0000-0000-0000-000000004501','00000000-0000-0000-0000-000000004508',
    '00000000-0000-0000-0000-000000004504',1);
   RAISE EXCEPTION 'UNEXPECTED_OTHER_USER_SESSION_ALLOWED';
 EXCEPTION WHEN raise_exception THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err<>'V450_SESSION_NOT_ALLOWED' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM * FROM v450_private.qa_atomic_session_touch('qa_shop_a',
    '00000000-0000-0000-0000-000000004501','00000000-0000-0000-0000-000000004502',
    '00000000-0000-0000-0000-000000004599',1);
   RAISE EXCEPTION 'UNEXPECTED_MISSING_ORDER_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err<>'V450_TENANT_OR_VERSION_CONFLICT' THEN RAISE; END IF;
 END;
 IF (SELECT state_version FROM v450_private.qa_orders
     WHERE shop_code='qa_shop_a' AND id='00000000-0000-0000-0000-000000004504')<>1
 THEN RAISE EXCEPTION 'V450_DENIED_ATTEMPTS_WROTE_DATA'; END IF;
END$$;
\echo V450_PG17_REPLAY_OLD_SESSION_AND_WRONG_SUB_DENIED_PASS
-- A successful write inside a rolled-back transaction must disappear entirely.
BEGIN;
SELECT * FROM v450_private.qa_atomic_session_touch('qa_shop_a',
 '00000000-0000-0000-0000-000000004501','00000000-0000-0000-0000-000000004502',
 '00000000-0000-0000-0000-000000004504',1);
ROLLBACK;
DO $$BEGIN
 IF (SELECT state_version FROM v450_private.qa_orders
 WHERE shop_code='qa_shop_a' AND id='00000000-0000-0000-0000-000000004504')<>1
 THEN RAISE EXCEPTION 'V450_ROLLBACK_LEFT_PARTIAL_WRITE';END IF;
END$$;
\echo V450_PG17_ROLLBACK_NO_PARTIAL_BUSINESS_WRITE_PASS
-- Revocation is effective regardless of existing signed token lifetime.
UPDATE v450_private.qa_members SET active=false,auth_version=4,
 generation_nonce='00000000-0000-0000-0000-000000004510',postcommit_fence_at=NULL
 WHERE shop_code='qa_shop_a' AND user_sub='00000000-0000-0000-0000-000000004501';
DO $$DECLARE err text;BEGIN
 BEGIN
 PERFORM * FROM v450_private.qa_atomic_session_touch('qa_shop_a',
 '00000000-0000-0000-0000-000000004501','00000000-0000-0000-0000-000000004502',
 '00000000-0000-0000-0000-000000004504',1);
 RAISE EXCEPTION 'UNEXPECTED_REVOKED_WRITE';
 EXCEPTION WHEN raise_exception THEN
 GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
 IF err<>'V450_SESSION_NOT_ALLOWED' THEN RAISE; END IF;
 END;
END$$;
\echo V450_PG17_REVOKED_SESSION_BLOCKS_ATOMIC_WRITE_PASS
UPDATE v450_private.qa_members SET active=true,auth_version=5,
 generation_nonce='00000000-0000-0000-0000-000000004511',postcommit_fence_at=clock_timestamp()
 WHERE shop_code='qa_shop_a' AND user_sub='00000000-0000-0000-0000-000000004501';
DO $$DECLARE err text;BEGIN
 BEGIN
 PERFORM * FROM v450_private.qa_atomic_session_touch('qa_shop_a',
 '00000000-0000-0000-0000-000000004501','00000000-0000-0000-0000-000000004502',
 '00000000-0000-0000-0000-000000004504',1);
 RAISE EXCEPTION 'UNEXPECTED_REACTIVATED_OLD_SESSION';
 EXCEPTION WHEN raise_exception THEN
 GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
 IF err<>'V450_SESSION_NOT_ALLOWED' THEN RAISE; END IF;
 END;
END$$;
\echo V450_PG17_REACTIVATION_OLD_SESSION_STAYS_DENIED_PASS
-- Fresh synthetic provider session after new postcommit fence, generated on same QA PG17.
SELECT pg_sleep(0.03);
INSERT INTO v450_private.qa_provider_sessions VALUES
 ('00000000-0000-0000-0000-000000004512','00000000-0000-0000-0000-000000004501',clock_timestamp(),true);
DO $$DECLARE r record;BEGIN
 SELECT * INTO r FROM v450_private.qa_atomic_session_touch('qa_shop_a',
 '00000000-0000-0000-0000-000000004501','00000000-0000-0000-0000-000000004512',
 '00000000-0000-0000-0000-000000004504',1);
 IF r.applied IS DISTINCT FROM true OR r.new_version<>2
 THEN RAISE EXCEPTION 'V450_NEW_SESSION_UNABLE_TO_WRITE'; END IF;
END$$;
\echo V450_PG17_FRESH_SESSION_NEW_GENERATION_WRITE_PASS
-- Workflow races 8 independent writers using the fresh fixture on order 4505.

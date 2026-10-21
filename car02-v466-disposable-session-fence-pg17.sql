-- CAR02 V4.66 DISPOSABLE POSTGRESQL 17 only: synthetic live/disabled session,
-- tenant membership and postcommit generation consistency observation.
-- These are FAKE rows. NOT Supabase auth.sessions or production permissions.
-- NEVER DEPLOY, NEVER COPY INTO SHARED DB, NO LINE, NO WRITE AUTHORIZATION.
\set ON_ERROR_STOP on
DO $$BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR
    current_database()<>'car02_v466_disposable'
 THEN RAISE EXCEPTION 'V466_DISPOSABLE_PG17_DATABASE_REQUIRED';END IF;
END$$;
CREATE ROLE v466_anon NOLOGIN;
CREATE ROLE v466_authenticated NOLOGIN;
CREATE SCHEMA v466_private;
REVOKE ALL ON SCHEMA v466_private FROM PUBLIC,v466_anon,v466_authenticated;
CREATE TABLE v466_private.qa_sessions(
 session_id uuid PRIMARY KEY, user_sub uuid NOT NULL,
 created_epoch bigint NOT NULL,expires_epoch bigint NOT NULL,
 revoked_epoch bigint
);
CREATE TABLE v466_private.qa_memberships(
 shop_code text NOT NULL,user_sub uuid NOT NULL,staff_role text NOT NULL,
 active boolean NOT NULL,auth_generation integer NOT NULL,fence_epoch bigint NOT NULL,
 PRIMARY KEY(shop_code,user_sub)
);
CREATE TABLE v466_private.qa_generation_acks(
 shop_code text NOT NULL,user_sub uuid NOT NULL,auth_generation integer NOT NULL,
 commit_ack boolean NOT NULL,commit_epoch bigint NOT NULL,
 PRIMARY KEY(shop_code,user_sub,auth_generation)
);
REVOKE ALL ON ALL TABLES IN SCHEMA v466_private FROM PUBLIC,v466_anon,v466_authenticated;
CREATE FUNCTION v466_private.qa_fence_observe(p_shop text,p_sub uuid,p_session uuid,p_now bigint)
 RETURNS TABLE(proof_state text,session_seen boolean,membership_seen boolean,fence_verified boolean)
 LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,v466_private AS $$
DECLARE s record; m record; a record;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[a-z0-9][a-z0-9_-]{1,63}$' OR
    p_sub IS NULL OR p_session IS NULL OR p_now IS NULL OR p_now<1
 THEN RETURN QUERY SELECT 'session_rejected'::text,false,false,false; RETURN; END IF;
 SELECT user_sub,created_epoch,expires_epoch,revoked_epoch INTO s
  FROM v466_private.qa_sessions
  WHERE session_id=p_session AND user_sub=p_sub AND created_epoch<p_now AND
        expires_epoch>p_now AND revoked_epoch IS NULL;
 IF NOT FOUND THEN RETURN QUERY SELECT 'session_rejected'::text,false,false,false; RETURN;END IF;
 SELECT staff_role,active,auth_generation,fence_epoch INTO m
  FROM v466_private.qa_memberships
  WHERE shop_code=p_shop AND user_sub=p_sub AND active=true AND
        staff_role IN ('staff','owner');
 IF NOT FOUND THEN RETURN QUERY SELECT 'membership_rejected'::text,true,false,false;RETURN;END IF;
 SELECT commit_ack,commit_epoch INTO a FROM v466_private.qa_generation_acks
  WHERE shop_code=p_shop AND user_sub=p_sub AND auth_generation=m.auth_generation;
 IF NOT FOUND OR a.commit_ack IS DISTINCT FROM true OR a.commit_epoch<>m.fence_epoch OR
    m.fence_epoch>=s.created_epoch OR m.fence_epoch>=p_now OR m.auth_generation<1
 THEN RETURN QUERY SELECT 'generation_rejected'::text,true,true,false;RETURN;END IF;
 RETURN QUERY SELECT 'eligible_for_review_only'::text,true,true,true;
END$$;
REVOKE ALL ON FUNCTION v466_private.qa_fence_observe(text,uuid,uuid,bigint)
 FROM PUBLIC,v466_anon,v466_authenticated;
DO $$BEGIN
 IF has_schema_privilege('v466_anon','v466_private','USAGE') OR
    has_schema_privilege('v466_authenticated','v466_private','USAGE') OR
    has_table_privilege('v466_anon','v466_private.qa_sessions','SELECT') OR
    has_table_privilege('v466_authenticated','v466_private.qa_memberships','SELECT') OR
    has_function_privilege('v466_anon','v466_private.qa_fence_observe(text,uuid,uuid,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'V466_LEAKED_PUBLIC_SESSION_PRIVILEGE'; END IF;
END$$;
\echo V466_PG17_PRIVATE_SESSION_MEMBERSHIP_ACK_ROLE_DENY_PASS
-- All evidence is invented in a dedicated disposable database; no real users.
INSERT INTO v466_private.qa_sessions(session_id,user_sub,created_epoch,expires_epoch,revoked_epoch) VALUES
 ('00000000-0000-0000-0000-000000004662','00000000-0000-0000-0000-000000004661',1799999900,1800000600,NULL),
 ('00000000-0000-0000-0000-000000004663','00000000-0000-0000-0000-000000004661',1799999900,1800000600,1799999950),
 ('00000000-0000-0000-0000-000000004664','00000000-0000-0000-0000-000000004661',1799999700,1800000600,NULL);
INSERT INTO v466_private.qa_memberships VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004661','staff',true,2,1799999800);
INSERT INTO v466_private.qa_generation_acks VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004661',2,true,1799999800);
DO $$DECLARE x record; BEGIN
 SELECT * INTO x FROM v466_private.qa_fence_observe('qa_shop_a',
 '00000000-0000-0000-0000-000000004661','00000000-0000-0000-0000-000000004662',1800000000);
 IF x.proof_state<>'eligible_for_review_only' OR x.session_seen IS NOT true OR
    x.membership_seen IS NOT true OR x.fence_verified IS NOT true
 THEN RAISE EXCEPTION 'V466_TEST_ONLY_POSITIVE_OBSERVATION_FAILED';END IF;
END$$;
\echo V466_PG17_FAKE_SESSION_GENERATION_OBSERVATION_NO_AUTHORIZATION_PASS
DO $$DECLARE x record;BEGIN
 SELECT * INTO x FROM v466_private.qa_fence_observe('qa_shop_a',
 '00000000-0000-0000-0000-000000004661','00000000-0000-0000-0000-000000004663',1800000000);
 IF x.proof_state<>'session_rejected' OR x.session_seen THEN RAISE EXCEPTION 'V466_REVOKED_SESSION_ACCEPTED';END IF;
 SELECT * INTO x FROM v466_private.qa_fence_observe('qa_shop_a',
 '00000000-0000-0000-0000-000000004669','00000000-0000-0000-0000-000000004662',1800000000);
 IF x.proof_state<>'session_rejected' THEN RAISE EXCEPTION 'V466_WRONG_USER_ACCEPTED'; END IF;
 SELECT * INTO x FROM v466_private.qa_fence_observe('qa_shop_a',
 '00000000-0000-0000-0000-000000004661','00000000-0000-0000-0000-000000004662',1800000601);
 IF x.proof_state<>'session_rejected' THEN RAISE EXCEPTION 'V466_EXPIRED_SESSION_ACCEPTED';END IF;
END$$;
\echo V466_PG17_REVOKED_WRONG_SUBJECT_AND_EXPIRED_SESSIONS_DENIED_PASS
DO $$DECLARE x record;BEGIN
 SELECT * INTO x FROM v466_private.qa_fence_observe('qa_shop_b',
 '00000000-0000-0000-0000-000000004661','00000000-0000-0000-0000-000000004662',1800000000);
 IF x.proof_state<>'membership_rejected' THEN RAISE EXCEPTION 'V466_CROSS_TENANT_SESSION_ACCEPTED';END IF;
 SELECT * INTO x FROM v466_private.qa_fence_observe('qa_shop_a',
 '00000000-0000-0000-0000-000000004661','00000000-0000-0000-0000-000000004664',1800000000);
 IF x.proof_state<>'generation_rejected' THEN RAISE EXCEPTION 'V466_OLD_SESSION_FENCE_ACCEPTED';END IF;
END$$;
\echo V466_PG17_CROSS_TENANT_AND_PRE_FENCE_SESSION_DENIED_PASS
BEGIN;
UPDATE v466_private.qa_memberships SET active=false WHERE shop_code='qa_shop_a';
DO $$DECLARE x record;BEGIN
 SELECT * INTO x FROM v466_private.qa_fence_observe('qa_shop_a',
 '00000000-0000-0000-0000-000000004661','00000000-0000-0000-0000-000000004662',1800000000);
 IF x.proof_state<>'membership_rejected' THEN RAISE EXCEPTION 'V466_DISABLED_MEMBER_ACCEPTED';END IF;
END$$;
ROLLBACK;
BEGIN;
UPDATE v466_private.qa_generation_acks SET commit_ack=false WHERE shop_code='qa_shop_a';
DO $$DECLARE x record;BEGIN
 SELECT * INTO x FROM v466_private.qa_fence_observe('qa_shop_a',
 '00000000-0000-0000-0000-000000004661','00000000-0000-0000-0000-000000004662',1800000000);
 IF x.proof_state<>'generation_rejected' THEN RAISE EXCEPTION 'V466_UNACKNOWLEDGED_GENERATION_ACCEPTED'; END IF;
END$$;
ROLLBACK;
DO $$DECLARE x record;BEGIN
 SELECT * INTO x FROM v466_private.qa_fence_observe('qa_shop_a',
 '00000000-0000-0000-0000-000000004661','00000000-0000-0000-0000-000000004662',1800000000);
 IF x.proof_state<>'eligible_for_review_only' THEN RAISE EXCEPTION 'V466_ROLLBACK_DID_NOT_RESTORE_FIXTURE'; END IF;
END$$;
\echo V466_PG17_DISABLED_MEMBER_UNACKED_GENERATION_ROLLBACK_PASS
-- No live auth, no claims of delivery, and NO permission to call application runtime.
\echo V466_FINAL_RELEASE_NO_GO_HOLD_TRUE

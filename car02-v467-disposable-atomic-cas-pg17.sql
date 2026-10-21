-- CAR02 V4.67 DISPOSABLE PostgreSQL17 only. Requires V466 disposable fixture.
-- This is an atomic QA comparison on FAKE session/employee/job rows ONLY.
-- DO NOT RUN against shared Supabase, real Auth, R52, or customer databases.
-- NEVER DEPLOY; no LINE delivery, no production write or business authorization.
\set ON_ERROR_STOP on
DO $$BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR
    current_database()<>'car02_v466_disposable' OR
    to_regclass('v466_private.qa_sessions') IS NULL OR
    to_regclass('v466_private.qa_memberships') IS NULL OR
    to_regclass('v466_private.qa_generation_acks') IS NULL
 THEN RAISE EXCEPTION 'V467_V466_DISPOSABLE_FIXTURE_REQUIRED';END IF;
END$$;
CREATE ROLE v467_anon NOLOGIN;
CREATE ROLE v467_authenticated NOLOGIN;
CREATE SCHEMA v467_private;
REVOKE ALL ON SCHEMA v467_private FROM PUBLIC,v467_anon,v467_authenticated;
CREATE TABLE v467_private.qa_jobs(
 shop_code text NOT NULL,job_id uuid NOT NULL,version integer NOT NULL DEFAULT 0,
 touched integer NOT NULL DEFAULT 0,
 PRIMARY KEY(shop_code,job_id),CHECK(version>=0),CHECK(touched>=0)
);
REVOKE ALL ON ALL TABLES IN SCHEMA v467_private FROM PUBLIC,v467_anon,v467_authenticated;
-- Place the live-session/membership/fence read and synthetic CAS in ONE SQL
-- statement transaction. Row SHARE locks serialize revocation against this QA CAS.
CREATE FUNCTION v467_private.qa_atomic_dryrun(p_shop text,p_sub uuid,p_session uuid,
 p_job uuid,p_expected integer,p_now bigint)
 RETURNS TABLE(outcome text,next_version integer)
 LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,v467_private AS $$
DECLARE s record; m record; a record; v_next integer;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[a-z0-9][a-z0-9_-]{1,63}$' OR
    p_sub IS NULL OR p_session IS NULL OR p_job IS NULL OR
    p_expected IS NULL OR p_expected<0 OR p_expected>1000000 OR p_now IS NULL OR p_now<1
 THEN RETURN QUERY SELECT 'session_rejected'::text,NULL::integer;RETURN;END IF;
 SELECT user_sub,created_epoch,expires_epoch,revoked_epoch INTO s
  FROM v466_private.qa_sessions
  WHERE session_id=p_session AND user_sub=p_sub FOR SHARE;
 IF NOT FOUND OR s.created_epoch>=p_now OR s.expires_epoch<=p_now OR
    s.revoked_epoch IS NOT NULL
 THEN RETURN QUERY SELECT 'session_rejected'::text,NULL::integer;RETURN;END IF;
 SELECT staff_role,active,auth_generation,fence_epoch INTO m
  FROM v466_private.qa_memberships
  WHERE shop_code=p_shop AND user_sub=p_sub FOR SHARE;
 IF NOT FOUND OR m.active IS DISTINCT FROM true OR
    m.staff_role NOT IN ('staff','owner')
 THEN RETURN QUERY SELECT 'membership_rejected'::text,NULL::integer;RETURN;END IF;
 SELECT commit_ack,commit_epoch INTO a FROM v466_private.qa_generation_acks
  WHERE shop_code=p_shop AND user_sub=p_sub AND auth_generation=m.auth_generation FOR SHARE;
 IF NOT FOUND OR a.commit_ack IS DISTINCT FROM true OR a.commit_epoch<>m.fence_epoch OR
    m.fence_epoch>=s.created_epoch OR m.fence_epoch>=p_now OR m.auth_generation<1
 THEN RETURN QUERY SELECT 'generation_rejected'::text,NULL::integer;RETURN;END IF;
 -- CAS is a synthetic row only. Concurrent writers with stale versions get 0 rows.
 UPDATE v467_private.qa_jobs AS j SET version=j.version+1,touched=j.touched+1
  WHERE j.shop_code=p_shop AND j.job_id=p_job AND j.version=p_expected
  RETURNING j.version INTO v_next;
 IF NOT FOUND THEN RETURN QUERY SELECT 'version_conflict'::text,NULL::integer;RETURN;END IF;
 RETURN QUERY SELECT 'synthetic_cas_advanced'::text,v_next;
END$$;
REVOKE ALL ON FUNCTION v467_private.qa_atomic_dryrun(text,uuid,uuid,uuid,integer,bigint)
 FROM PUBLIC,v467_anon,v467_authenticated;
DO $$BEGIN
 IF has_schema_privilege('v467_anon','v467_private','USAGE') OR
    has_schema_privilege('v467_authenticated','v467_private','USAGE') OR
    has_table_privilege('v467_anon','v467_private.qa_jobs','UPDATE') OR
    has_table_privilege('v467_authenticated','v467_private.qa_jobs','SELECT') OR
    has_function_privilege('v467_anon','v467_private.qa_atomic_dryrun(text,uuid,uuid,uuid,integer,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'V467_QA_ROLE_PRIVILEGE_LEAK';END IF;
END$$;
\echo V467_PG17_PRIVATE_SYNTHETIC_CAS_ROLE_DENY_PASS
INSERT INTO v467_private.qa_jobs(shop_code,job_id,version,touched) VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004670',0,0);
-- A valid mock session/membership can advance a dummy row only IN this txn.
BEGIN;
DO $$DECLARE q record; BEGIN
 SELECT * INTO q FROM v467_private.qa_atomic_dryrun('qa_shop_a',
  '00000000-0000-0000-0000-000000004661','00000000-0000-0000-0000-000000004662',
  '00000000-0000-0000-0000-000000004670',0,1800000000);
 IF q.outcome<>'synthetic_cas_advanced' OR q.next_version<>1
 THEN RAISE EXCEPTION 'V467_SYNTHETIC_CAS_NOT_ATOMIC';END IF;
END$$;
ROLLBACK;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM v467_private.qa_jobs WHERE version<>0 OR touched<>0)
 THEN RAISE EXCEPTION 'V467_DRYRUN_ROLLBACK_NOT_RESPECTED';END IF;
END$$;
\echo V467_PG17_VALID_AUTH_FENCE_SYNTHETIC_CAS_ROLLBACK_PASS
DO $$DECLARE q record; BEGIN
 SELECT * INTO q FROM v467_private.qa_atomic_dryrun('qa_shop_a',
  '00000000-0000-0000-0000-000000004661','00000000-0000-0000-0000-000000004663',
  '00000000-0000-0000-0000-000000004670',0,1800000000);
 IF q.outcome<>'session_rejected' THEN RAISE EXCEPTION 'V467_REVOKED_SESSION_ACCEPTED';END IF;
 SELECT * INTO q FROM v467_private.qa_atomic_dryrun('qa_shop_a',
  '00000000-0000-0000-0000-000000004661','00000000-0000-0000-0000-000000004664',
  '00000000-0000-0000-0000-000000004670',0,1800000000);
 IF q.outcome<>'generation_rejected' THEN RAISE EXCEPTION 'V467_STALE_SESSION_ACCEPTED';END IF;
 SELECT * INTO q FROM v467_private.qa_atomic_dryrun('qa_shop_b',
  '00000000-0000-0000-0000-000000004661','00000000-0000-0000-0000-000000004662',
  '00000000-0000-0000-0000-000000004670',0,1800000000);
 IF q.outcome<>'membership_rejected' THEN RAISE EXCEPTION 'V467_CROSS_TENANT_ACCEPTED';END IF;
 SELECT * INTO q FROM v467_private.qa_atomic_dryrun('qa_shop_a',
  '00000000-0000-0000-0000-000000004661','00000000-0000-0000-0000-000000004662',
  '00000000-0000-0000-0000-000000004671',0,1800000000);
 IF q.outcome<>'version_conflict' THEN RAISE EXCEPTION 'V467_UNKNOWN_JOB_ACCEPTED';END IF;
END$$;
\echo V467_PG17_REVOKED_PRE_FENCE_CROSS_TENANT_UNKNOWN_JOB_DENIED_PASS
BEGIN;
UPDATE v466_private.qa_memberships SET active=false WHERE shop_code='qa_shop_a';
DO $$DECLARE q record;BEGIN
 SELECT * INTO q FROM v467_private.qa_atomic_dryrun('qa_shop_a',
  '00000000-0000-0000-0000-000000004661','00000000-0000-0000-0000-000000004662',
  '00000000-0000-0000-0000-000000004670',0,1800000000);
 IF q.outcome<>'membership_rejected' THEN RAISE EXCEPTION 'V467_REVOKED_MEMBER_ADVANCED_JOB';END IF;
END$$;
ROLLBACK;
BEGIN;
UPDATE v466_private.qa_generation_acks SET commit_ack=false WHERE shop_code='qa_shop_a';
DO $$DECLARE q record;BEGIN
 SELECT * INTO q FROM v467_private.qa_atomic_dryrun('qa_shop_a',
  '00000000-0000-0000-0000-000000004661','00000000-0000-0000-0000-000000004662',
  '00000000-0000-0000-0000-000000004670',0,1800000000);
 IF q.outcome<>'generation_rejected' THEN RAISE EXCEPTION 'V467_UNACKED_GENERATION_ADVANCED_JOB';END IF;
END$$;
ROLLBACK;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM v467_private.qa_jobs WHERE version<>0 OR touched<>0)
 THEN RAISE EXCEPTION 'V467_REJECTED_PATH_MUTATED_JOB';END IF;
END$$;
\echo V467_PG17_REVOKE_AND_UNACKED_FENCE_NEGATIVES_ZERO_WRITES_PASS
\echo V467_FINAL_RELEASE_NO_GO_HOLD_TRUE

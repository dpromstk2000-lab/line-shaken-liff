-- DPRO CAR02 V4.52: synthetic, role-bound durable request receipt plus atomic job CAS.
-- Disposable PostgreSQL 17 ONLY. NEVER run on shared/production Supabase.
-- Synthetic session fixtures do not prove real auth.sessions, real JWTs, real users,
-- live Worker's operator authorization, or safe commercial release.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V452_DISPOSABLE_PG17_ONLY'; END IF;
END $$;
CREATE ROLE v452_anon NOLOGIN;
CREATE ROLE v452_authenticated NOLOGIN;
CREATE SCHEMA v452_private;
REVOKE ALL ON SCHEMA v452_private FROM PUBLIC,v452_anon,v452_authenticated;
CREATE TABLE v452_private.qa_members (
 shop_code text NOT NULL CHECK(shop_code ~ '^[A-Za-z0-9_-]{1,64}$'),
 user_sub uuid NOT NULL,active boolean NOT NULL,
 staff_role text NOT NULL CHECK(staff_role IN ('staff','owner')),
 auth_version integer NOT NULL CHECK(auth_version>0),generation_nonce uuid NOT NULL,
 postcommit_fence_at timestamptz,
 PRIMARY KEY(shop_code,user_sub)
);
CREATE TABLE v452_private.qa_provider_sessions (
 session_id uuid PRIMARY KEY,user_sub uuid NOT NULL,
 created_at timestamptz NOT NULL,active boolean NOT NULL
);
CREATE TABLE v452_private.qa_jobs (
 shop_code text NOT NULL,id uuid NOT NULL,
 state_version integer NOT NULL CHECK(state_version>=1),assigned_sub uuid,
 locked boolean NOT NULL,archived boolean NOT NULL,
 PRIMARY KEY(shop_code,id)
);
CREATE TABLE v452_private.qa_job_receipts (
 shop_code text NOT NULL,request_id uuid NOT NULL,actor_sub uuid NOT NULL,
 session_id uuid NOT NULL,job_id uuid NOT NULL,expected_version integer NOT NULL,
 new_version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(shop_code,request_id),
 FOREIGN KEY(shop_code,job_id) REFERENCES v452_private.qa_jobs(shop_code,id) ON DELETE RESTRICT,
 CHECK(expected_version>=1),CHECK(new_version=expected_version+1)
);
REVOKE ALL ON v452_private.qa_members,v452_private.qa_provider_sessions,
 v452_private.qa_jobs,v452_private.qa_job_receipts FROM PUBLIC,v452_anon,v452_authenticated;
CREATE FUNCTION v452_private.qa_reject_receipt_changes() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,v452_private AS $$
BEGIN RAISE EXCEPTION 'V452_RECEIPTS_APPEND_ONLY'; END $$;
CREATE TRIGGER v452_reject_receipt_edit BEFORE UPDATE OR DELETE ON v452_private.qa_job_receipts
 FOR EACH ROW EXECUTE FUNCTION v452_private.qa_reject_receipt_changes();
CREATE FUNCTION v452_private.qa_receipted_job_cas(
 p_shop text,p_sub uuid,p_session uuid,p_job uuid,p_expected integer,p_request uuid)
RETURNS TABLE(applied boolean,new_version integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,v452_private AS $$
DECLARE allowed_role text; current_job record; prior record; updated integer;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR
    p_sub IS NULL OR p_session IS NULL OR p_job IS NULL OR p_request IS NULL OR
    p_expected IS NULL OR p_expected<1 OR p_expected>=2147483647
 THEN RAISE EXCEPTION 'V452_INVALID_SCOPE'; END IF;
 -- For both first write and REPLAY, lock CURRENT membership and provider session.
 -- No receipt can authorize a revoked, terminated, stale or other-tenant actor.
 SELECT m.staff_role INTO allowed_role FROM v452_private.qa_members m
 JOIN v452_private.qa_provider_sessions s ON s.user_sub=m.user_sub
 WHERE m.shop_code=p_shop AND m.user_sub=p_sub AND m.active=true
   AND m.postcommit_fence_at IS NOT NULL AND s.session_id=p_session
   AND s.active=true AND s.created_at>m.postcommit_fence_at
 FOR UPDATE OF m,s;
 IF NOT FOUND THEN RAISE EXCEPTION 'V452_SESSION_NOT_ALLOWED'; END IF;
 -- Re-check CURRENT job policy even for receipt replay. This prevents access
 -- after locking, archiving, assignment removal, or owner-to-staff downgrade.
 SELECT j.state_version,j.assigned_sub,j.locked,j.archived INTO current_job
 FROM v452_private.qa_jobs j WHERE j.shop_code=p_shop AND j.id=p_job FOR UPDATE;
 IF NOT FOUND OR current_job.archived=true OR
    (allowed_role='staff' AND (current_job.locked=true OR current_job.assigned_sub IS DISTINCT FROM p_sub))
 THEN RAISE EXCEPTION 'V452_JOB_POLICY_DENIED'; END IF;
 -- Receipts are scoped by shop + caller-provided UUID, but NEVER authorize.
 -- Binding to verified server actor/session and request parameters prevents
 -- one UUID from silently being reused to update a different job/actor.
 SELECT r.actor_sub,r.session_id,r.job_id,r.expected_version,r.new_version INTO prior
 FROM v452_private.qa_job_receipts r
 WHERE r.shop_code=p_shop AND r.request_id=p_request FOR UPDATE;
 IF FOUND THEN
   IF prior.actor_sub<>p_sub OR prior.session_id<>p_session OR prior.job_id<>p_job OR
       prior.expected_version<>p_expected OR prior.new_version<>p_expected+1
   THEN RAISE EXCEPTION 'V452_REQUEST_REUSE_CONFLICT'; END IF;
   RETURN QUERY SELECT false,prior.new_version;RETURN;
 END IF;
 IF current_job.state_version<>p_expected THEN RAISE EXCEPTION 'V452_JOB_VERSION_CONFLICT'; END IF;
 UPDATE v452_private.qa_jobs j SET state_version=j.state_version+1
 WHERE j.shop_code=p_shop AND j.id=p_job AND j.state_version=p_expected
 RETURNING j.state_version INTO updated;
 IF NOT FOUND OR updated<>p_expected+1 THEN RAISE EXCEPTION 'V452_JOB_CAS_MISSED'; END IF;
 INSERT INTO v452_private.qa_job_receipts
  (shop_code,request_id,actor_sub,session_id,job_id,expected_version,new_version)
 VALUES(p_shop,p_request,p_sub,p_session,p_job,p_expected,updated);
 RETURN QUERY SELECT true,updated;
END $$;
REVOKE ALL ON FUNCTION v452_private.qa_receipted_job_cas(text,uuid,uuid,uuid,integer,uuid),
 v452_private.qa_reject_receipt_changes() FROM PUBLIC,v452_anon,v452_authenticated;
DO $$BEGIN
 IF has_schema_privilege('v452_authenticated','v452_private','USAGE') OR
    has_table_privilege('v452_anon','v452_private.qa_job_receipts','SELECT') OR
    has_table_privilege('v452_authenticated','v452_private.qa_jobs','UPDATE') OR
    has_function_privilege('v452_authenticated',
      'v452_private.qa_receipted_job_cas(text,uuid,uuid,uuid,integer,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'V452_PUBLIC_ACCESS_OPEN'; END IF;
END $$;
\echo V452_PG17_PRIVATE_SCHEMA_UNPRIVILEGED_DENY_PASS
INSERT INTO v452_private.qa_members VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004513',true,'staff',3,'00000000-0000-0000-0000-000000004532',clock_timestamp()-interval '30 minutes'),
 ('qa_shop_a','00000000-0000-0000-0000-000000004511',true,'owner',3,'00000000-0000-0000-0000-000000004531',clock_timestamp()-interval '30 minutes'),
 ('qa_shop_b','00000000-0000-0000-0000-000000004513',false,'staff',3,'00000000-0000-0000-0000-000000004533',clock_timestamp()-interval '30 minutes');
INSERT INTO v452_private.qa_provider_sessions VALUES
 ('00000000-0000-0000-0000-000000004514','00000000-0000-0000-0000-000000004513',clock_timestamp()-interval '1 minute',true),
 ('00000000-0000-0000-0000-000000004512','00000000-0000-0000-0000-000000004511',clock_timestamp()-interval '1 minute',true),
 ('00000000-0000-0000-0000-000000004517','00000000-0000-0000-0000-000000004513',clock_timestamp()-interval '2 hours',true);
INSERT INTO v452_private.qa_jobs VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004518',1,'00000000-0000-0000-0000-000000004513',false,false),
 ('qa_shop_a','00000000-0000-0000-0000-000000004520',1,'00000000-0000-0000-0000-000000004513',true,false),
 ('qa_shop_a','00000000-0000-0000-0000-000000004521',1,'00000000-0000-0000-0000-000000004513',false,true),
 ('qa_shop_a','00000000-0000-0000-0000-000000004522',1,NULL,false,false),
 ('qa_shop_a','00000000-0000-0000-0000-000000004528',1,'00000000-0000-0000-0000-000000004513',false,false),
 ('qa_shop_a','00000000-0000-0000-0000-000000004529',1,'00000000-0000-0000-0000-000000004513',false,false),
 ('qa_shop_b','00000000-0000-0000-0000-000000004518',1,'00000000-0000-0000-0000-000000004513',false,false);
DO $$DECLARE r record;BEGIN
 SELECT * INTO r FROM v452_private.qa_receipted_job_cas('qa_shop_a',
  '00000000-0000-0000-0000-000000004513','00000000-0000-0000-0000-000000004514',
  '00000000-0000-0000-0000-000000004518',1,'00000000-0000-0000-0000-000000004526');
 IF r.applied IS DISTINCT FROM true OR r.new_version<>2 THEN RAISE EXCEPTION 'V452_FIRST_WRITE_FAILED';END IF;
 SELECT * INTO r FROM v452_private.qa_receipted_job_cas('qa_shop_a',
  '00000000-0000-0000-0000-000000004513','00000000-0000-0000-0000-000000004514',
  '00000000-0000-0000-0000-000000004518',1,'00000000-0000-0000-0000-000000004526');
 IF r.applied IS DISTINCT FROM false OR r.new_version<>2 THEN RAISE EXCEPTION 'V452_REPLAY_REAPPLIED';END IF;
 IF (SELECT state_version FROM v452_private.qa_jobs WHERE id='00000000-0000-0000-0000-000000004518' AND shop_code='qa_shop_a')<>2 OR
    (SELECT count(*) FROM v452_private.qa_job_receipts)<>1
 THEN RAISE EXCEPTION 'V452_ATOMIC_RECEIPT_MISSING';END IF;
END$$;
\echo V452_PG17_ATOMIC_RECEIPT_AND_DUPLICATE_NO_WRITE_PASS
-- Rejected request ID reuse and job policy must not change persisted state.
DO $$DECLARE error_text text;BEGIN
 BEGIN
  PERFORM * FROM v452_private.qa_receipted_job_cas('qa_shop_a',
   '00000000-0000-0000-0000-000000004513','00000000-0000-0000-0000-000000004514',
   '00000000-0000-0000-0000-000000004522',1,'00000000-0000-0000-0000-000000004526');
  RAISE EXCEPTION 'V452_REUSED_ID_OTHER_JOB_ALLOWED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS error_text=MESSAGE_TEXT;
  IF error_text NOT IN ('V452_JOB_POLICY_DENIED','V452_REQUEST_REUSE_CONFLICT') THEN RAISE;END IF;
 END;
 BEGIN
  PERFORM * FROM v452_private.qa_receipted_job_cas('qa_shop_a',
   '00000000-0000-0000-0000-000000004513','00000000-0000-0000-0000-000000004514',
   '00000000-0000-0000-0000-000000004520',1,'00000000-0000-0000-0000-000000004527');
  RAISE EXCEPTION 'V452_LOCKED_JOB_WRITTEN';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS error_text=MESSAGE_TEXT;
  IF error_text<>'V452_JOB_POLICY_DENIED' THEN RAISE;END IF;
 END;
 BEGIN
  PERFORM * FROM v452_private.qa_receipted_job_cas('qa_shop_a',
   '00000000-0000-0000-0000-000000004511','00000000-0000-0000-0000-000000004512',
   '00000000-0000-0000-0000-000000004521',1,'00000000-0000-0000-0000-000000004527');
  RAISE EXCEPTION 'V452_ARCHIVED_OWNER_UPDATE';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS error_text=MESSAGE_TEXT;
  IF error_text<>'V452_JOB_POLICY_DENIED' THEN RAISE;END IF;
 END;
 BEGIN
  PERFORM * FROM v452_private.qa_receipted_job_cas('qa_shop_a',
   '00000000-0000-0000-0000-000000004513','00000000-0000-0000-0000-000000004517',
   '00000000-0000-0000-0000-000000004518',1,'00000000-0000-0000-0000-000000004526');
  RAISE EXCEPTION 'V452_OLD_SESSION_REPLAY';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS error_text=MESSAGE_TEXT;
  IF error_text<>'V452_SESSION_NOT_ALLOWED' THEN RAISE;END IF;
 END;
 IF (SELECT count(*) FROM v452_private.qa_job_receipts)<>1 THEN RAISE EXCEPTION 'V452_FORBIDDEN_RECEIPT';END IF;
END$$;
\echo V452_PG17_ROLE_LOCK_ARCHIVE_STALE_SESSION_DENIED_PASS
BEGIN;
SELECT * FROM v452_private.qa_receipted_job_cas('qa_shop_a',
 '00000000-0000-0000-0000-000000004511','00000000-0000-0000-0000-000000004512',
 '00000000-0000-0000-0000-000000004522',1,'00000000-0000-0000-0000-000000004527');
ROLLBACK;
DO $$BEGIN
 IF (SELECT state_version FROM v452_private.qa_jobs WHERE shop_code='qa_shop_a' AND id='00000000-0000-0000-0000-000000004522')<>1 OR
    EXISTS(SELECT 1 FROM v452_private.qa_job_receipts WHERE request_id='00000000-0000-0000-0000-000000004527')
 THEN RAISE EXCEPTION 'V452_ROLLBACK_LEFT_PARTIAL_WRITE'; END IF;
END$$;
\echo V452_PG17_ROLLBACK_REMOVES_JOB_AND_RECEIPT_PASS
DO $$DECLARE error_text text;BEGIN
 BEGIN
  UPDATE v452_private.qa_job_receipts SET new_version=999;
  RAISE EXCEPTION 'V452_RECEIPT_EDITED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS error_text=MESSAGE_TEXT;
  IF error_text<>'V452_RECEIPTS_APPEND_ONLY' THEN RAISE;END IF;
 END;
 BEGIN
  DELETE FROM v452_private.qa_job_receipts;
  RAISE EXCEPTION 'V452_RECEIPT_DELETED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS error_text=MESSAGE_TEXT;
  IF error_text<>'V452_RECEIPTS_APPEND_ONLY' THEN RAISE;END IF;
 END;
END$$;
\echo V452_PG17_RECEIPT_UPDATE_DELETE_REJECTED_PASS
-- Eight callers of the SAME request ID on job 4528 race: one applied, 7 duplicates.
-- Eight DISTINCT request IDs on job 4529 race: one applied, 7 version conflicts.

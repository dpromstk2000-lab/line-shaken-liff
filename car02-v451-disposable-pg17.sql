-- DPRO CAR02 V4.51 - isolated OWNER / ASSIGNED STAFF least-privilege job CAS QA.
-- PostgreSQL 17 disposable CI ONLY. Do NOT run on shared or production Supabase.
-- Login rows, shops, jobs and JWT verification are 100% SYNTHETIC.
-- No actual auth.sessions, LINE messages, Worker, production SQL or real data.
\set ON_ERROR_STOP on
DO $$BEGIN IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V451_DISPOSABLE_PG17_ONLY'; END IF;END$$;
CREATE ROLE v451_anon NOLOGIN;
CREATE ROLE v451_authenticated NOLOGIN;
CREATE SCHEMA v451_private;
REVOKE ALL ON SCHEMA v451_private FROM PUBLIC,v451_anon,v451_authenticated;
CREATE TABLE v451_private.qa_members (
 shop_code text NOT NULL CHECK(shop_code ~ '^[A-Za-z0-9_-]{1,64}$'),
 user_sub uuid NOT NULL,active boolean NOT NULL,
 staff_role text NOT NULL CHECK(staff_role IN ('staff','owner')),
 auth_version integer NOT NULL CHECK(auth_version>=1),generation_nonce uuid NOT NULL,
 postcommit_fence_at timestamptz,
 PRIMARY KEY(shop_code,user_sub)
);
CREATE TABLE v451_private.qa_provider_sessions (
 session_id uuid PRIMARY KEY,user_sub uuid NOT NULL,
 created_at timestamptz NOT NULL,active boolean NOT NULL
);
CREATE TABLE v451_private.qa_jobs (
 shop_code text NOT NULL,id uuid NOT NULL,
 state_version integer NOT NULL CHECK(state_version>=1),
 assigned_sub uuid,locked boolean NOT NULL,archived boolean NOT NULL,
 PRIMARY KEY(shop_code,id)
);
REVOKE ALL ON v451_private.qa_members,v451_private.qa_provider_sessions,v451_private.qa_jobs
 FROM PUBLIC,v451_anon,v451_authenticated;
CREATE FUNCTION v451_private.qa_role_bound_job_cas(
 p_shop text,p_sub uuid,p_session uuid,p_job uuid,p_expected integer)
RETURNS TABLE(applied boolean,new_version integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,v451_private AS $$
DECLARE verified_role text; updated integer;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR
    p_sub IS NULL OR p_session IS NULL OR p_job IS NULL OR
    p_expected IS NULL OR p_expected<1 OR p_expected>=2147483647
 THEN RAISE EXCEPTION 'V451_INVALID_INPUT'; END IF;
 -- Lock AUTHORIZATION rows: a concurrent role revocation cannot commit between
 -- checking membership and the UPDATE of the job in this transaction.
 SELECT m.staff_role INTO verified_role
 FROM v451_private.qa_members m
 JOIN v451_private.qa_provider_sessions s ON s.user_sub=m.user_sub
 WHERE m.shop_code=p_shop AND m.user_sub=p_sub AND m.active=true AND
       m.postcommit_fence_at IS NOT NULL AND
       s.session_id=p_session AND s.active=true AND
       s.created_at>m.postcommit_fence_at
 FOR UPDATE OF m,s;
 IF NOT FOUND THEN RAISE EXCEPTION 'V451_SESSION_NOT_ALLOWED'; END IF;
 -- Role and assignment come from DB ONLY. Locked jobs cannot be touched by
 -- assigned staff; archived jobs cannot be edited by anyone, including owner.
 UPDATE v451_private.qa_jobs o SET state_version=o.state_version+1
 WHERE o.shop_code=p_shop AND o.id=p_job AND o.state_version=p_expected
   AND o.archived=false
   AND (verified_role='owner' OR
     (verified_role='staff' AND o.locked=false AND o.assigned_sub=p_sub))
 RETURNING o.state_version INTO updated;
 IF NOT FOUND THEN RAISE EXCEPTION 'V451_JOB_POLICY_OR_CAS_DENIED'; END IF;
 RETURN QUERY SELECT true,updated;
END$$;
REVOKE ALL ON FUNCTION v451_private.qa_role_bound_job_cas(text,uuid,uuid,uuid,integer)
 FROM PUBLIC,v451_anon,v451_authenticated;
DO $$BEGIN
 IF has_schema_privilege('v451_anon','v451_private','USAGE') OR
    has_table_privilege('v451_authenticated','v451_private.qa_jobs','UPDATE') OR
    has_table_privilege('v451_anon','v451_private.qa_provider_sessions','SELECT') OR
    has_function_privilege('v451_authenticated',
      'v451_private.qa_role_bound_job_cas(text,uuid,uuid,uuid,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'V451_UNPRIVILEGED_JOB_ACCESS_OPEN'; END IF;
END$$;
\echo V451_PG17_PRIVATE_ROLE_DENY_PASS
INSERT INTO v451_private.qa_members VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004511',true,'owner',3,'00000000-0000-0000-0000-000000004531',clock_timestamp()-interval '30 minutes'),
 ('qa_shop_a','00000000-0000-0000-0000-000000004513',true,'staff',3,'00000000-0000-0000-0000-000000004532',clock_timestamp()-interval '30 minutes'),
 ('qa_shop_b','00000000-0000-0000-0000-000000004511',false,'owner',3,'00000000-0000-0000-0000-000000004533',clock_timestamp()-interval '30 minutes');
INSERT INTO v451_private.qa_provider_sessions VALUES
 ('00000000-0000-0000-0000-000000004512','00000000-0000-0000-0000-000000004511',clock_timestamp()-interval '1 minute',true),
 ('00000000-0000-0000-0000-000000004514','00000000-0000-0000-0000-000000004513',clock_timestamp()-interval '1 minute',true),
 ('00000000-0000-0000-0000-000000004517','00000000-0000-0000-0000-000000004513',clock_timestamp()-interval '2 hours',true);
INSERT INTO v451_private.qa_jobs VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004518',1,'00000000-0000-0000-0000-000000004513',false,false),
 ('qa_shop_a','00000000-0000-0000-0000-000000004519',1,'00000000-0000-0000-0000-000000004511',false,false),
 ('qa_shop_a','00000000-0000-0000-0000-000000004520',1,'00000000-0000-0000-0000-000000004513',true,false),
 ('qa_shop_a','00000000-0000-0000-0000-000000004521',1,'00000000-0000-0000-0000-000000004513',false,true),
 ('qa_shop_a','00000000-0000-0000-0000-000000004522',1,NULL,false,false),
 ('qa_shop_a','00000000-0000-0000-0000-000000004523',1,'00000000-0000-0000-0000-000000004513',false,false),
 ('qa_shop_a','00000000-0000-0000-0000-000000004524',1,NULL,false,false),
 ('qa_shop_a','00000000-0000-0000-0000-000000004525',1,'00000000-0000-0000-0000-000000004513',false,false),
 ('qa_shop_b','00000000-0000-0000-0000-000000004518',1,'00000000-0000-0000-0000-000000004513',false,false);
DO $$DECLARE got record;BEGIN
 SELECT * INTO got FROM v451_private.qa_role_bound_job_cas('qa_shop_a',
 '00000000-0000-0000-0000-000000004513','00000000-0000-0000-0000-000000004514',
 '00000000-0000-0000-0000-000000004518',1);
 IF got.applied IS DISTINCT FROM true OR got.new_version<>2 THEN RAISE EXCEPTION 'V451_ASSIGNED_STAFF_FAILED';END IF;
 SELECT * INTO got FROM v451_private.qa_role_bound_job_cas('qa_shop_a',
 '00000000-0000-0000-0000-000000004511','00000000-0000-0000-0000-000000004512',
 '00000000-0000-0000-0000-000000004522',1);
 IF got.applied IS DISTINCT FROM true OR got.new_version<>2 THEN RAISE EXCEPTION 'V451_OWNER_UNASSIGNED_FAILED';END IF;
 IF (SELECT state_version FROM v451_private.qa_jobs WHERE shop_code='qa_shop_b' AND id='00000000-0000-0000-0000-000000004518')<>1
 THEN RAISE EXCEPTION 'V451_OTHER_SHOP_CHANGED';END IF;
END$$;
\echo V451_PG17_ASSIGNED_STAFF_OWNER_AND_TENANT_PASS
DO $$DECLARE error_text text; v record;BEGIN
 -- Forbidden attempts must ALWAYS throw the exact policy or session exception.
 FOR v IN SELECT * FROM (VALUES
   ('00000000-0000-0000-0000-000000004513'::uuid,'00000000-0000-0000-0000-000000004514'::uuid,'00000000-0000-0000-0000-000000004519'::uuid,1,'V451_JOB_POLICY_OR_CAS_DENIED'),
   ('00000000-0000-0000-0000-000000004513'::uuid,'00000000-0000-0000-0000-000000004514'::uuid,'00000000-0000-0000-0000-000000004520'::uuid,1,'V451_JOB_POLICY_OR_CAS_DENIED'),
   ('00000000-0000-0000-0000-000000004511'::uuid,'00000000-0000-0000-0000-000000004512'::uuid,'00000000-0000-0000-0000-000000004521'::uuid,1,'V451_JOB_POLICY_OR_CAS_DENIED'),
   ('00000000-0000-0000-0000-000000004513'::uuid,'00000000-0000-0000-0000-000000004514'::uuid,'00000000-0000-0000-0000-000000004522'::uuid,2,'V451_JOB_POLICY_OR_CAS_DENIED'),
   ('00000000-0000-0000-0000-000000004513'::uuid,'00000000-0000-0000-0000-000000004517'::uuid,'00000000-0000-0000-0000-000000004525'::uuid,1,'V451_SESSION_NOT_ALLOWED'),
   ('00000000-0000-0000-0000-000000004513'::uuid,'00000000-0000-0000-0000-000000004514'::uuid,'00000000-0000-0000-0000-000000004518'::uuid,1,'V451_JOB_POLICY_OR_CAS_DENIED')
  ) q(sub,sid,job,ver,expect_error) LOOP
    BEGIN
     PERFORM * FROM v451_private.qa_role_bound_job_cas('qa_shop_a',v.sub,v.sid,v.job,v.ver);
     RAISE EXCEPTION 'V451_FORBIDDEN_WRITE_ACCEPTED';
    EXCEPTION WHEN raise_exception THEN
     GET STACKED DIAGNOSTICS error_text=MESSAGE_TEXT;
     IF error_text<>v.expect_error THEN RAISE; END IF;
    END;
  END LOOP;
 IF (SELECT state_version FROM v451_private.qa_jobs WHERE shop_code='qa_shop_a' AND id='00000000-0000-0000-0000-000000004519')<>1 OR
    (SELECT state_version FROM v451_private.qa_jobs WHERE shop_code='qa_shop_a' AND id='00000000-0000-0000-0000-000000004521')<>1
 THEN RAISE EXCEPTION 'V451_DENIED_WRITES_MUTATED_JOB';END IF;
END$$;
\echo V451_PG17_ASSIGNMENT_LOCK_ARCHIVE_REPLAY_AND_OLD_SESSION_DENY_PASS
-- Downgrading owner to staff revokes unassigned-job mutation within same locked gate.
UPDATE v451_private.qa_members SET staff_role='staff' WHERE shop_code='qa_shop_a'
 AND user_sub='00000000-0000-0000-0000-000000004511';
DO $$DECLARE error_text text;BEGIN
 BEGIN
  PERFORM * FROM v451_private.qa_role_bound_job_cas('qa_shop_a',
  '00000000-0000-0000-0000-000000004511','00000000-0000-0000-0000-000000004512',
  '00000000-0000-0000-0000-000000004524',1);
  RAISE EXCEPTION 'V451_DOWNGRADED_OWNER_EDITED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS error_text=MESSAGE_TEXT;
  IF error_text<>'V451_JOB_POLICY_OR_CAS_DENIED' THEN RAISE;END IF;
 END;
END$$;
\echo V451_PG17_ROLE_DOWNGRADE_IMMEDIATE_DENY_PASS
BEGIN;
SELECT * FROM v451_private.qa_role_bound_job_cas('qa_shop_a',
 '00000000-0000-0000-0000-000000004513','00000000-0000-0000-0000-000000004514',
 '00000000-0000-0000-0000-000000004525',1);
ROLLBACK;
DO $$BEGIN
 IF (SELECT state_version FROM v451_private.qa_jobs WHERE shop_code='qa_shop_a' AND id='00000000-0000-0000-0000-000000004525')<>1
 THEN RAISE EXCEPTION 'V451_ROLLBACK_LEFT_PARTIAL_WRITE';END IF;
END$$;
\echo V451_PG17_ROLLBACK_NO_PARTIAL_WRITE_PASS
-- No one with a terminated session can write even with an otherwise matching role.
UPDATE v451_private.qa_provider_sessions SET active=false
WHERE session_id='00000000-0000-0000-0000-000000004512';
DO $$DECLARE error_text text;BEGIN
 BEGIN
 PERFORM * FROM v451_private.qa_role_bound_job_cas('qa_shop_a',
 '00000000-0000-0000-0000-000000004511','00000000-0000-0000-0000-000000004512',
 '00000000-0000-0000-0000-000000004519',1);
 RAISE EXCEPTION 'V451_TERMINATED_SESSION_EDITED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS error_text=MESSAGE_TEXT;
  IF error_text<>'V451_SESSION_NOT_ALLOWED' THEN RAISE; END IF;
 END;
END$$;
\echo V451_PG17_TERMINATED_SESSION_REJECTED_PASS
-- CI races 8 staff writers against order 4523. Only 1 version 1->2 accepted.

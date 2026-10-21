-- DPRO CAR02 V4.53 — atomic JOB + REQUEST RECEIPT + PENDING OUTBOX.
-- Disposable PostgreSQL 17 ONLY. NEVER run on shared/production Supabase.
-- Synthetic JWT/session/role state; pending event is NOT LINE delivery evidence.
-- No dispatcher or message sender exists. This is NON-DEPLOYABLE QA only.
\set ON_ERROR_STOP on
DO $$BEGIN
 IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V453_DISPOSABLE_PG17_ONLY'; END IF;
END$$;
CREATE ROLE v453_anon NOLOGIN;
CREATE ROLE v453_authenticated NOLOGIN;
CREATE SCHEMA v453_private;
REVOKE ALL ON SCHEMA v453_private FROM PUBLIC,v453_anon,v453_authenticated;
CREATE TABLE v453_private.qa_members(
 shop_code text NOT NULL CHECK(shop_code ~ '^[A-Za-z0-9_-]{1,64}$'),
 user_sub uuid NOT NULL,active boolean NOT NULL,
 staff_role text NOT NULL CHECK(staff_role IN ('owner','staff')),
 auth_version integer NOT NULL CHECK(auth_version>0),generation_nonce uuid NOT NULL,
 postcommit_fence_at timestamptz,PRIMARY KEY(shop_code,user_sub)
);
CREATE TABLE v453_private.qa_sessions(
 session_id uuid PRIMARY KEY,user_sub uuid NOT NULL,
 created_at timestamptz NOT NULL,active boolean NOT NULL
);
CREATE TABLE v453_private.qa_jobs(
 shop_code text NOT NULL,id uuid NOT NULL,state_version integer NOT NULL CHECK(state_version>=1),
 assigned_sub uuid,locked boolean NOT NULL,archived boolean NOT NULL,
 PRIMARY KEY(shop_code,id)
);
CREATE TABLE v453_private.qa_receipts(
 shop_code text NOT NULL,request_id uuid NOT NULL,actor_sub uuid NOT NULL,
 session_id uuid NOT NULL,job_id uuid NOT NULL,expected_version integer NOT NULL,
 new_version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(shop_code,request_id),
 FOREIGN KEY(shop_code,job_id) REFERENCES v453_private.qa_jobs(shop_code,id) ON DELETE RESTRICT,
 CHECK(expected_version>=1),CHECK(new_version=expected_version+1)
);
CREATE TABLE v453_private.qa_outbox(
 shop_code text NOT NULL,event_id uuid NOT NULL,job_id uuid NOT NULL,
 new_version integer NOT NULL CHECK(new_version>=2),
 dispatch_state text NOT NULL DEFAULT 'pending' CHECK(dispatch_state='pending'),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts=0),
 inserted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(shop_code,event_id),
 FOREIGN KEY(shop_code,job_id) REFERENCES v453_private.qa_jobs(shop_code,id) ON DELETE RESTRICT
);
REVOKE ALL ON v453_private.qa_members,v453_private.qa_sessions,v453_private.qa_jobs,
 v453_private.qa_receipts,v453_private.qa_outbox FROM PUBLIC,v453_anon,v453_authenticated;
CREATE FUNCTION v453_private.qa_reject_immutable_change() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,v453_private AS $$
BEGIN RAISE EXCEPTION 'V453_APPEND_ONLY_LEDGER'; END$$;
CREATE TRIGGER v453_receipt_immutable BEFORE UPDATE OR DELETE ON v453_private.qa_receipts
 FOR EACH ROW EXECUTE FUNCTION v453_private.qa_reject_immutable_change();
CREATE TRIGGER v453_outbox_immutable BEFORE UPDATE OR DELETE ON v453_private.qa_outbox
 FOR EACH ROW EXECUTE FUNCTION v453_private.qa_reject_immutable_change();
-- Deliberate, disposable fault injector: same-transaction outbox failure must
-- roll back both business state update AND receipt insert, not leave half a state.
CREATE FUNCTION v453_private.qa_fail_selected_outbox() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,v453_private AS $$
BEGIN
 IF NEW.event_id='00000000-0000-0000-0000-000000004539'::uuid THEN
  RAISE EXCEPTION 'V453_SYNTHETIC_OUTBOX_FAILURE';
 END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER v453_outbox_fault BEFORE INSERT ON v453_private.qa_outbox
 FOR EACH ROW EXECUTE FUNCTION v453_private.qa_fail_selected_outbox();
CREATE FUNCTION v453_private.qa_touch_and_queue(
 p_shop text,p_sub uuid,p_session uuid,p_job uuid,p_expected integer,p_request uuid)
RETURNS TABLE(applied boolean,new_version integer,event_id uuid,dispatch_state text)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,v453_private AS $$
DECLARE allowed_role text; current_job record; prior record; queued record; updated integer;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR
    p_sub IS NULL OR p_session IS NULL OR p_job IS NULL OR p_request IS NULL OR
    p_expected IS NULL OR p_expected<1 OR p_expected>=2147483647
 THEN RAISE EXCEPTION 'V453_INVALID_INPUT'; END IF;
 -- CURRENT session and role are locked; neither the request UUID nor a JWT role
 -- permits a stale/revoked or cross-tenant actor to replay an outbox receipt.
 SELECT m.staff_role INTO allowed_role FROM v453_private.qa_members m
 JOIN v453_private.qa_sessions s ON s.user_sub=m.user_sub
 WHERE m.shop_code=p_shop AND m.user_sub=p_sub AND m.active=true
  AND m.postcommit_fence_at IS NOT NULL
  AND s.session_id=p_session AND s.active=true AND s.created_at>m.postcommit_fence_at
 FOR UPDATE OF m,s;
 IF NOT FOUND THEN RAISE EXCEPTION 'V453_SESSION_DENIED'; END IF;
 SELECT j.state_version,j.assigned_sub,j.locked,j.archived INTO current_job
 FROM v453_private.qa_jobs j WHERE j.shop_code=p_shop AND j.id=p_job FOR UPDATE;
 IF NOT FOUND OR current_job.archived OR
    (allowed_role='staff' AND (current_job.locked OR current_job.assigned_sub IS DISTINCT FROM p_sub))
 THEN RAISE EXCEPTION 'V453_JOB_POLICY_DENIED'; END IF;
 SELECT r.actor_sub,r.session_id,r.job_id,r.expected_version,r.new_version INTO prior
 FROM v453_private.qa_receipts r
 WHERE r.shop_code=p_shop AND r.request_id=p_request FOR UPDATE;
 IF FOUND THEN
   IF prior.actor_sub<>p_sub OR prior.session_id<>p_session OR prior.job_id<>p_job OR
      prior.expected_version<>p_expected OR prior.new_version<>p_expected+1
   THEN RAISE EXCEPTION 'V453_REQUEST_ID_CONFLICT'; END IF;
   SELECT o.job_id,o.new_version,o.dispatch_state,o.attempts INTO queued
   FROM v453_private.qa_outbox o WHERE o.shop_code=p_shop AND o.event_id=p_request;
   IF NOT FOUND OR queued.job_id<>p_job OR queued.new_version<>prior.new_version OR
       queued.dispatch_state<>'pending' OR queued.attempts<>0
   THEN RAISE EXCEPTION 'V453_MISSING_OR_CHANGED_OUTBOX'; END IF;
   RETURN QUERY SELECT false,prior.new_version,p_request,'pending'::text;RETURN;
 END IF;
 IF current_job.state_version<>p_expected THEN RAISE EXCEPTION 'V453_JOB_VERSION_CONFLICT'; END IF;
 UPDATE v453_private.qa_jobs j SET state_version=j.state_version+1
 WHERE j.shop_code=p_shop AND j.id=p_job AND j.state_version=p_expected
 RETURNING j.state_version INTO updated;
 IF NOT FOUND OR updated<>p_expected+1 THEN RAISE EXCEPTION 'V453_JOB_CAS_MISSED'; END IF;
 INSERT INTO v453_private.qa_receipts
 (shop_code,request_id,actor_sub,session_id,job_id,expected_version,new_version)
 VALUES(p_shop,p_request,p_sub,p_session,p_job,p_expected,updated);
 INSERT INTO v453_private.qa_outbox(shop_code,event_id,job_id,new_version,dispatch_state,attempts)
 VALUES(p_shop,p_request,p_job,updated,'pending',0);
 RETURN QUERY SELECT true,updated,p_request,'pending'::text;
END$$;
REVOKE ALL ON FUNCTION v453_private.qa_touch_and_queue(text,uuid,uuid,uuid,integer,uuid),
 v453_private.qa_reject_immutable_change(),v453_private.qa_fail_selected_outbox()
 FROM PUBLIC,v453_anon,v453_authenticated;
DO $$BEGIN
 IF has_schema_privilege('v453_anon','v453_private','USAGE') OR
   has_table_privilege('v453_authenticated','v453_private.qa_outbox','SELECT') OR
   has_table_privilege('v453_authenticated','v453_private.qa_jobs','UPDATE') OR
   has_function_privilege('v453_authenticated',
    'v453_private.qa_touch_and_queue(text,uuid,uuid,uuid,integer,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'V453_UNPRIVILEGED_ACCESS';END IF;
END$$;
\echo V453_PG17_PRIVATE_ROLE_DENY_PASS
INSERT INTO v453_private.qa_members VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004513',true,'staff',3,
  '00000000-0000-0000-0000-000000004551',clock_timestamp()-interval '30 minutes'),
 ('qa_shop_a','00000000-0000-0000-0000-000000004511',true,'owner',3,
  '00000000-0000-0000-0000-000000004552',clock_timestamp()-interval '30 minutes'),
 ('qa_shop_b','00000000-0000-0000-0000-000000004513',false,'staff',3,
  '00000000-0000-0000-0000-000000004553',clock_timestamp()-interval '30 minutes');
INSERT INTO v453_private.qa_sessions VALUES
 ('00000000-0000-0000-0000-000000004514','00000000-0000-0000-0000-000000004513',clock_timestamp()-interval '1 minute',true),
 ('00000000-0000-0000-0000-000000004512','00000000-0000-0000-0000-000000004511',clock_timestamp()-interval '1 minute',true),
 ('00000000-0000-0000-0000-000000004517','00000000-0000-0000-0000-000000004513',clock_timestamp()-interval '2 hours',true);
INSERT INTO v453_private.qa_jobs VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004538',1,'00000000-0000-0000-0000-000000004513',false,false),
 ('qa_shop_a','00000000-0000-0000-0000-000000004537',1,NULL,false,false),
 ('qa_shop_a','00000000-0000-0000-0000-000000004536',1,'00000000-0000-0000-0000-000000004513',true,false),
 ('qa_shop_a','00000000-0000-0000-0000-000000004535',1,'00000000-0000-0000-0000-000000004513',false,true),
 ('qa_shop_a','00000000-0000-0000-0000-000000004539',1,'00000000-0000-0000-0000-000000004513',false,false),
 ('qa_shop_a','00000000-0000-0000-0000-000000004540',1,'00000000-0000-0000-0000-000000004513',false,false),
 ('qa_shop_a','00000000-0000-0000-0000-000000004541',1,'00000000-0000-0000-0000-000000004513',false,false),
 ('qa_shop_b','00000000-0000-0000-0000-000000004538',1,'00000000-0000-0000-0000-000000004513',false,false);
DO $$DECLARE r record;BEGIN
 SELECT * INTO r FROM v453_private.qa_touch_and_queue('qa_shop_a',
  '00000000-0000-0000-0000-000000004513','00000000-0000-0000-0000-000000004514',
  '00000000-0000-0000-0000-000000004538',1,'00000000-0000-0000-0000-000000004533');
 IF r.applied IS DISTINCT FROM true OR r.new_version<>2 OR
    r.event_id<>'00000000-0000-0000-0000-000000004533'::uuid OR r.dispatch_state<>'pending'
 THEN RAISE EXCEPTION 'V453_INITIAL_ATOMIC_QUEUE_FAILED';END IF;
 SELECT * INTO r FROM v453_private.qa_touch_and_queue('qa_shop_a',
  '00000000-0000-0000-0000-000000004513','00000000-0000-0000-0000-000000004514',
  '00000000-0000-0000-0000-000000004538',1,'00000000-0000-0000-0000-000000004533');
 IF r.applied IS DISTINCT FROM false OR r.new_version<>2 OR
    (SELECT count(*) FROM v453_private.qa_outbox)<>1 OR
    (SELECT count(*) FROM v453_private.qa_receipts)<>1
 THEN RAISE EXCEPTION 'V453_REPLAY_INSERTED_QUEUE';END IF;
END$$;
\echo V453_PG17_ATOMIC_JOB_RECEIPT_OUTBOX_PASS
\echo V453_PG17_DUPLICATE_QUEUE_PREVENTED_PASS
-- Test failing outbox insert after a job UPDATE and receipt INSERT; no partial write survives.
DO $$DECLARE err text;BEGIN
 BEGIN
  PERFORM * FROM v453_private.qa_touch_and_queue('qa_shop_a',
   '00000000-0000-0000-0000-000000004513','00000000-0000-0000-0000-000000004514',
   '00000000-0000-0000-0000-000000004539',1,'00000000-0000-0000-0000-000000004539');
  RAISE EXCEPTION 'V453_UNEXPECTED_OUTBOX_COMMIT';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
  IF err<>'V453_SYNTHETIC_OUTBOX_FAILURE' THEN RAISE; END IF;
 END;
 IF (SELECT state_version FROM v453_private.qa_jobs WHERE shop_code='qa_shop_a' AND
   id='00000000-0000-0000-0000-000000004539')<>1 OR
   EXISTS(SELECT 1 FROM v453_private.qa_receipts WHERE request_id='00000000-0000-0000-0000-000000004539') OR
   EXISTS(SELECT 1 FROM v453_private.qa_outbox WHERE event_id='00000000-0000-0000-0000-000000004539')
 THEN RAISE EXCEPTION 'V453_PARTIAL_WRITE_AFTER_QUEUE_FAILURE'; END IF;
END$$;
\echo V453_PG17_OUTBOX_FAILURE_ROLLS_BACK_ALL_THREE_PASS
-- Current policy is checked BEFORE duplicate receipt. Suspended staff cannot replay.
UPDATE v453_private.qa_members SET active=false,auth_version=4,
 generation_nonce='00000000-0000-0000-0000-000000004554',postcommit_fence_at=NULL
 WHERE shop_code='qa_shop_a' AND user_sub='00000000-0000-0000-0000-000000004513';
DO $$DECLARE err text;BEGIN
 BEGIN
  PERFORM * FROM v453_private.qa_touch_and_queue('qa_shop_a',
   '00000000-0000-0000-0000-000000004513','00000000-0000-0000-0000-000000004514',
   '00000000-0000-0000-0000-000000004538',1,'00000000-0000-0000-0000-000000004533');
  RAISE EXCEPTION 'V453_OLD_RECEIPT_AUTH';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
  IF err<>'V453_SESSION_DENIED' THEN RAISE; END IF;
 END;
END$$;
\echo V453_PG17_REVOKED_STAFF_CANNOT_REPLAY_PASS
UPDATE v453_private.qa_members SET active=true,auth_version=5,
 generation_nonce='00000000-0000-0000-0000-000000004555',postcommit_fence_at=clock_timestamp()
 WHERE shop_code='qa_shop_a' AND user_sub='00000000-0000-0000-0000-000000004513';
DO $$DECLARE err text;BEGIN
 BEGIN
  PERFORM * FROM v453_private.qa_touch_and_queue('qa_shop_a',
   '00000000-0000-0000-0000-000000004513','00000000-0000-0000-0000-000000004514',
   '00000000-0000-0000-0000-000000004538',1,'00000000-0000-0000-0000-000000004533');
  RAISE EXCEPTION 'V453_OLD_SESSION_AFTER_REACTIVATE';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
  IF err<>'V453_SESSION_DENIED' THEN RAISE; END IF;
 END;
END$$;
SELECT pg_sleep(0.02);
INSERT INTO v453_private.qa_sessions VALUES
 ('00000000-0000-0000-0000-000000004556','00000000-0000-0000-0000-000000004513',clock_timestamp(),true);
DO $$DECLARE err text;BEGIN
 BEGIN
  PERFORM * FROM v453_private.qa_touch_and_queue('qa_shop_a',
   '00000000-0000-0000-0000-000000004513','00000000-0000-0000-0000-000000004556',
   '00000000-0000-0000-0000-000000004536',1,'00000000-0000-0000-0000-000000004557');
  RAISE EXCEPTION 'V453_LOCKED_JOB_UPDATED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
  IF err<>'V453_JOB_POLICY_DENIED' THEN RAISE; END IF;
 END;
 IF (SELECT state_version FROM v453_private.qa_jobs WHERE shop_code='qa_shop_b')<>1
 THEN RAISE EXCEPTION 'V453_CROSS_TENANT_CHANGED'; END IF;
END$$;
\echo V453_PG17_OLD_SESSION_POLICY_AND_TENANT_DENIED_PASS
-- Neither receipt nor outbox row is editable, regardless of state.
DO $$DECLARE err text;BEGIN
 BEGIN
  UPDATE v453_private.qa_outbox SET dispatch_state='pending';
  RAISE EXCEPTION 'V453_OUTBOX_WAS_UPDATED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
  IF err<>'V453_APPEND_ONLY_LEDGER' THEN RAISE; END IF;
 END;
 BEGIN
  DELETE FROM v453_private.qa_receipts;
  RAISE EXCEPTION 'V453_RECEIPTS_DELETED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
  IF err<>'V453_APPEND_ONLY_LEDGER' THEN RAISE; END IF;
 END;
END$$;
\echo V453_PG17_OUTBOX_AND_RECEIPT_APPEND_ONLY_PASS
-- CI launches 8 duplicate request writers (job 4540 / event 4540), and
-- 8 distinct request IDs on job 4541 with the same expected version.

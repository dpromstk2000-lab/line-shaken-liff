-- DPRO CAR02 V4.55 dual-person review attestation; DISPOSABLE PG17 ONLY.
-- Requires exact V453 + corrected V454 synthetic fixtures. NEVER PRODUCTION.
-- No LINE sends, delivery claims, real supervisor IAM, trustworthy WORM storage.
\set ON_ERROR_STOP on
DO $$BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR
    to_regclass('v453_private.qa_outbox') IS NULL OR
    to_regclass('v454_private.qa_claims') IS NULL
 THEN RAISE EXCEPTION 'V455_DISPOSABLE_V453_V454_REQUIRED'; END IF;
END$$;
CREATE ROLE v455_anon NOLOGIN;
CREATE ROLE v455_authenticated NOLOGIN;
CREATE SCHEMA v455_private;
REVOKE ALL ON SCHEMA v455_private FROM PUBLIC,v455_anon,v455_authenticated;
CREATE TABLE v455_private.qa_reviewer_roster(
 shop_code text NOT NULL, user_sub uuid NOT NULL,
 review_role text NOT NULL CHECK(review_role IN ('investigator','supervisor')),
 active boolean NOT NULL,
 PRIMARY KEY(shop_code,user_sub)
);
CREATE TABLE v455_private.qa_cases(
 shop_code text NOT NULL,event_id uuid NOT NULL,
 stage text NOT NULL CHECK(stage IN ('awaiting_independent_signoff','closed_without_delivery_assertion')),
 investigator_sub uuid NOT NULL,investigation_evidence text NOT NULL CHECK(investigation_evidence ~ '^[a-f0-9]{64}$'),
 supervisor_sub uuid,signoff_evidence text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),closed_at timestamptz,
 PRIMARY KEY(shop_code,event_id),
 FOREIGN KEY(shop_code,event_id) REFERENCES v454_private.qa_claims(shop_code,event_id) ON DELETE RESTRICT,
 CHECK ((stage='awaiting_independent_signoff' AND supervisor_sub IS NULL AND signoff_evidence IS NULL AND closed_at IS NULL) OR
 (stage='closed_without_delivery_assertion' AND supervisor_sub IS NOT NULL AND supervisor_sub<>investigator_sub AND
  signoff_evidence ~ '^[a-f0-9]{64}$' AND signoff_evidence<>investigation_evidence AND closed_at IS NOT NULL))
);
CREATE TABLE v455_private.qa_review_audit(
 shop_code text NOT NULL,event_id uuid NOT NULL,seq smallint NOT NULL CHECK(seq IN (1,2)),
 actor_sub uuid NOT NULL,action text NOT NULL CHECK(action IN ('investigate','close_no_delivery_claim')),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(shop_code,event_id,seq),
 FOREIGN KEY(shop_code,event_id) REFERENCES v455_private.qa_cases(shop_code,event_id) ON DELETE RESTRICT,
 CHECK((seq=1 AND action='investigate') OR (seq=2 AND action='close_no_delivery_claim'))
);
REVOKE ALL ON v455_private.qa_reviewer_roster,v455_private.qa_cases,v455_private.qa_review_audit
 FROM PUBLIC,v455_anon,v455_authenticated;
CREATE FUNCTION v455_private.qa_deny_audit_edit() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,v455_private AS $$
BEGIN RAISE EXCEPTION 'V455_AUDIT_APPEND_ONLY';END$$;
CREATE TRIGGER v455_deny_audit_mutation BEFORE UPDATE OR DELETE ON v455_private.qa_review_audit
 FOR EACH ROW EXECUTE FUNCTION v455_private.qa_deny_audit_edit();
CREATE FUNCTION v455_private.qa_guard_case() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,v455_private AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'V455_CASE_IRREVERSIBLE';END IF;
 IF OLD.stage<>'awaiting_independent_signoff' OR NEW.stage<>'closed_without_delivery_assertion' OR
   NEW.shop_code IS DISTINCT FROM OLD.shop_code OR NEW.event_id IS DISTINCT FROM OLD.event_id OR
   NEW.investigator_sub IS DISTINCT FROM OLD.investigator_sub OR
   NEW.investigation_evidence IS DISTINCT FROM OLD.investigation_evidence OR
   NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.supervisor_sub IS NULL OR
   NEW.supervisor_sub=OLD.investigator_sub OR NEW.signoff_evidence IS NULL OR
   NEW.signoff_evidence=OLD.investigation_evidence OR NEW.closed_at IS NULL
 THEN RAISE EXCEPTION 'V455_CASE_IRREVERSIBLE';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER v455_guard_case_mutation BEFORE UPDATE OR DELETE ON v455_private.qa_cases
 FOR EACH ROW EXECUTE FUNCTION v455_private.qa_guard_case();
CREATE FUNCTION v455_private.qa_review_attest(p_shop text,p_event uuid,p_actor uuid,p_action text,p_evidence text)
 RETURNS TABLE(stage text,case_id uuid)
 LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,v455_private,v454_private AS $$
DECLARE reviewer_role text; quarantined_state text; existing v455_private.qa_cases%ROWTYPE;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR p_event IS NULL OR p_actor IS NULL OR
    p_evidence IS NULL OR p_evidence !~ '^[a-f0-9]{64}$' OR p_evidence=repeat('0',64) OR
    p_action IS NULL OR p_action NOT IN ('investigate','close_no_delivery_claim')
 THEN RAISE EXCEPTION 'V455_INVALID_REVIEW_SCOPE';END IF;
 SELECT r.review_role INTO reviewer_role FROM v455_private.qa_reviewer_roster r
 WHERE r.shop_code=p_shop AND r.user_sub=p_actor AND r.active=true FOR UPDATE;
 IF NOT FOUND OR
  (p_action='investigate' AND reviewer_role<>'investigator') OR
  (p_action='close_no_delivery_claim' AND reviewer_role<>'supervisor')
 THEN RAISE EXCEPTION 'V455_UNAUTHORIZED_REVIEWER';END IF;
 SELECT c.state INTO quarantined_state FROM v454_private.qa_claims c
 WHERE c.shop_code=p_shop AND c.event_id=p_event FOR UPDATE;
 IF NOT FOUND OR quarantined_state<>'manual_review' THEN RAISE EXCEPTION 'V455_NOT_QUARANTINED';END IF;
 IF p_action='investigate' THEN
  SELECT * INTO existing FROM v455_private.qa_cases k
  WHERE k.shop_code=p_shop AND k.event_id=p_event FOR UPDATE;
  IF FOUND THEN RAISE EXCEPTION 'V455_INVESTIGATION_ALREADY_RECORDED'; END IF;
  INSERT INTO v455_private.qa_cases(shop_code,event_id,stage,investigator_sub,investigation_evidence)
  VALUES(p_shop,p_event,'awaiting_independent_signoff',p_actor,p_evidence);
  INSERT INTO v455_private.qa_review_audit(shop_code,event_id,seq,actor_sub,action,evidence_sha256)
  VALUES(p_shop,p_event,1,p_actor,'investigate',p_evidence);
  RETURN QUERY SELECT 'awaiting_independent_signoff'::text,p_event; RETURN;
 END IF;
 SELECT * INTO existing FROM v455_private.qa_cases k
 WHERE k.shop_code=p_shop AND k.event_id=p_event FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'V455_INVESTIGATION_MISSING';END IF;
 IF existing.stage<>'awaiting_independent_signoff' THEN RAISE EXCEPTION 'V455_CASE_ALREADY_CLOSED';END IF;
 IF existing.investigator_sub=p_actor OR existing.investigation_evidence=p_evidence
 THEN RAISE EXCEPTION 'V455_NOT_INDEPENDENT';END IF;
 UPDATE v455_private.qa_cases k
 SET stage='closed_without_delivery_assertion',supervisor_sub=p_actor,
     signoff_evidence=p_evidence,closed_at=clock_timestamp()
 WHERE k.shop_code=p_shop AND k.event_id=p_event;
 INSERT INTO v455_private.qa_review_audit(shop_code,event_id,seq,actor_sub,action,evidence_sha256)
 VALUES(p_shop,p_event,2,p_actor,'close_no_delivery_claim',p_evidence);
 RETURN QUERY SELECT 'closed_without_delivery_assertion'::text,p_event;
END$$;
REVOKE ALL ON FUNCTION v455_private.qa_deny_audit_edit(),v455_private.qa_guard_case(),
 v455_private.qa_review_attest(text,uuid,uuid,text,text) FROM PUBLIC,v455_anon,v455_authenticated;
DO $$ BEGIN
 IF has_schema_privilege('v455_authenticated','v455_private','USAGE') OR
  has_table_privilege('v455_anon','v455_private.qa_review_audit','INSERT') OR
  has_function_privilege('v455_authenticated','v455_private.qa_review_attest(text,uuid,uuid,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'V455_PUBLIC_REVIEW_ACCESS';END IF;
END$$;
\echo V455_PG17_PRIVATE_REVIEW_ROSTER_AND_PUBLIC_DENIED_PASS
INSERT INTO v455_private.qa_reviewer_roster VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004551','investigator',true),
 ('qa_shop_a','00000000-0000-0000-0000-000000004552','supervisor',true),
 ('qa_shop_a','00000000-0000-0000-0000-000000004553','investigator',true),
 ('qa_shop_a','00000000-0000-0000-0000-000000004554','supervisor',true),
 ('qa_shop_a','00000000-0000-0000-0000-000000004555','investigator',false),
 ('qa_shop_b','00000000-0000-0000-0000-000000004552','supervisor',true);
INSERT INTO v455_private.qa_reviewer_roster(shop_code,user_sub,review_role,active)
 SELECT 'qa_shop_a',('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'supervisor',true
 FROM generate_series(4561,4568) AS t(i);
DO $$DECLARE r record;n integer;message text;BEGIN
 -- V454 first event 4533 is already quarantined by previous script.
 SELECT * INTO r FROM v455_private.qa_review_attest('qa_shop_a','00000000-0000-0000-0000-000000004533',
 '00000000-0000-0000-0000-000000004551','investigate',repeat('a',64));
 IF r.stage IS DISTINCT FROM 'awaiting_independent_signoff' THEN RAISE EXCEPTION 'V455_INVESTIGATE_MISSING';END IF;
 BEGIN
  PERFORM * FROM v455_private.qa_review_attest('qa_shop_a','00000000-0000-0000-0000-000000004533',
  '00000000-0000-0000-0000-000000004551','investigate',repeat('a',64));
  RAISE EXCEPTION 'UNEXPECTED_DUPLICATE_INVESTIGATION';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'V455_INVESTIGATION_ALREADY_RECORDED' THEN RAISE;END IF;
 END;
 BEGIN
  PERFORM * FROM v455_private.qa_review_attest('qa_shop_a','00000000-0000-0000-0000-000000004533',
  '00000000-0000-0000-0000-000000004552','close_no_delivery_claim',repeat('a',64));
  RAISE EXCEPTION 'UNEXPECTED_SAME_EVIDENCE_SIGNOFF';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'V455_NOT_INDEPENDENT' THEN RAISE;END IF;
 END;
 SELECT * INTO r FROM v455_private.qa_review_attest('qa_shop_a','00000000-0000-0000-0000-000000004533',
 '00000000-0000-0000-0000-000000004552','close_no_delivery_claim',repeat('b',64));
 IF r.stage IS DISTINCT FROM 'closed_without_delivery_assertion' THEN RAISE EXCEPTION 'V455_SIGNOFF_NOT_FINAL';END IF;
 SELECT COUNT(*) INTO n FROM v455_private.qa_review_audit WHERE event_id='00000000-0000-0000-0000-000000004533';
 IF n<>2 THEN RAISE EXCEPTION 'V455_AUDIT_COUNT_WRONG';END IF;
END$$;
\echo V455_PG17_DISTINCT_INVESTIGATOR_SUPERVISOR_ATOMIC_SIGNOFF_PASS
DO $$DECLARE message text;BEGIN
 BEGIN
  PERFORM * FROM v455_private.qa_review_attest('qa_shop_a','00000000-0000-0000-0000-000000004533',
  '00000000-0000-0000-0000-000000004552','close_no_delivery_claim',repeat('c',64));
  RAISE EXCEPTION 'UNEXPECTED_DUPLICATE_SIGNOFF';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'V455_CASE_ALREADY_CLOSED' THEN RAISE;END IF;
 END;
 BEGIN
  PERFORM * FROM v455_private.qa_review_attest('qa_shop_b','00000000-0000-0000-0000-000000004533',
  '00000000-0000-0000-0000-000000004552','close_no_delivery_claim',repeat('c',64));
  RAISE EXCEPTION 'UNEXPECTED_CROSS_SHOP_SIGNOFF';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'V455_NOT_QUARANTINED' THEN RAISE;END IF;
 END;
 BEGIN
  PERFORM * FROM v455_private.qa_review_attest('qa_shop_a','00000000-0000-0000-0000-000000004533',
  '00000000-0000-0000-0000-000000004555','investigate',repeat('c',64));
  RAISE EXCEPTION 'UNEXPECTED_INACTIVE_REVIEWER';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'V455_UNAUTHORIZED_REVIEWER' THEN RAISE;END IF;
 END;
 IF (SELECT dispatch_state FROM v453_private.qa_outbox WHERE event_id='00000000-0000-0000-0000-000000004533')<>'pending' OR
    (SELECT state FROM v454_private.qa_claims WHERE event_id='00000000-0000-0000-0000-000000004533')<>'manual_review'
 THEN RAISE EXCEPTION 'V455_SOURCE_MUTATED';END IF;
END$$;
\echo V455_PG17_DUPLICATE_CROSSSHOP_REVOKED_AND_SOURCE_PROTECTED_PASS
DO $$DECLARE message text;BEGIN
 BEGIN
  UPDATE v455_private.qa_review_audit SET evidence_sha256=repeat('f',64);
  RAISE EXCEPTION 'UNEXPECTED_AUDIT_EDIT';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'V455_AUDIT_APPEND_ONLY' THEN RAISE;END IF;
 END;
 BEGIN
  DELETE FROM v455_private.qa_cases;
  RAISE EXCEPTION 'UNEXPECTED_CASE_DELETE';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'V455_CASE_IRREVERSIBLE' THEN RAISE;END IF;
 END;
 IF (SELECT COUNT(*) FROM v455_private.qa_review_audit)<>2 THEN RAISE EXCEPTION 'V455_PARTIAL_HISTORY';END IF;
END$$;
\echo V455_PG17_APPEND_ONLY_AND_IRREVERSIBLE_CASE_PASS
-- Prepare second quarantined event 4541 for eight independent competing supervisors.
DO $$DECLARE ticket record;done boolean;r record;BEGIN
 SELECT * INTO ticket FROM v454_private.qa_claim_outbox('qa_shop_a',
  '00000000-0000-0000-0000-000000004541','00000000-0000-0000-0000-000000004540');
 IF ticket.state IS DISTINCT FROM 'claimed' THEN RAISE EXCEPTION 'V455_SECOND_SOURCE_NOT_CLAIMABLE';END IF;
 SELECT quarantined INTO done FROM v454_private.qa_quarantine_claim('qa_shop_a',ticket.event_id,
  '00000000-0000-0000-0000-000000004540',ticket.claim_token,'provider_no_receipt');
 IF done IS DISTINCT FROM true THEN RAISE EXCEPTION 'V455_SECOND_SOURCE_NOT_QUARANTINED';END IF;
 SELECT * INTO r FROM v455_private.qa_review_attest('qa_shop_a',ticket.event_id,
  '00000000-0000-0000-0000-000000004553','investigate',repeat('d',64));
 IF r.stage IS DISTINCT FROM 'awaiting_independent_signoff' THEN RAISE EXCEPTION 'V455_RACE_NOT_READY';END IF;
END$$;
\echo V455_PG17_EIGHT_REVIEWERS_RACE_FIXTURE_READY_PASS
-- No provider call, no delivery state, no automatic retry.

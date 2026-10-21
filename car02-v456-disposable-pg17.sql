-- CAR02 V4.56: disposable POSTGRES17 read-only cross-ledger review consistency.
-- Prerequisites: full existing V453, V454R1, V455 OFFLINE synthetic QA fixtures.
-- NEVER DEPLOY: no real Supabase auth.sessions, LINE provider delivery proof or WORM.
\set ON_ERROR_STOP on
DO $$BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR
    to_regclass('v453_private.qa_outbox') IS NULL OR
    to_regclass('v454_private.qa_claims') IS NULL OR
    to_regclass('v455_private.qa_review_audit') IS NULL
 THEN RAISE EXCEPTION 'V456_DISPOSABLE_DEPENDENCIES_REQUIRED';END IF;
END$$;
CREATE ROLE v456_anon NOLOGIN;
CREATE ROLE v456_authenticated NOLOGIN;
CREATE SCHEMA v456_private;
REVOKE ALL ON SCHEMA v456_private FROM PUBLIC,v456_anon,v456_authenticated;
-- A consistency report is a point-in-time OBSERVATION, not permission to retry,
-- a signed customer record, evidence of LINE sending or a delivery receipt.
CREATE FUNCTION v456_private.qa_review_consistency(p_shop text,p_event uuid)
 RETURNS TABLE(integrity_state text,event_id uuid,review_stage text,audit_steps integer)
 LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,v456_private AS $$
DECLARE source_row record; claim_row record; case_row record;
        first_audit record; second_audit record; n integer;
        source_ok boolean; first_ok boolean; second_ok boolean;
        status text;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR p_event IS NULL
 THEN RAISE EXCEPTION 'V456_INVALID_READ_SCOPE';END IF;
 SELECT o.event_id,o.inserted_at,o.dispatch_state,o.attempts,o.job_id,o.new_version,
        r.request_id,r.job_id AS receipt_job,r.new_version AS receipt_version,r.created_at AS receipt_at
 INTO source_row FROM v453_private.qa_outbox o
 JOIN v453_private.qa_receipts r ON r.shop_code=o.shop_code AND r.request_id=o.event_id
 WHERE o.shop_code=p_shop AND o.event_id=p_event;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT c.state,c.review_reason,c.claimed_at,c.reviewed_at
 INTO claim_row FROM v454_private.qa_claims c
 WHERE c.shop_code=p_shop AND c.event_id=p_event;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT c.stage,c.investigator_sub,c.investigation_evidence,c.supervisor_sub,
  c.signoff_evidence,c.created_at,c.closed_at
 INTO case_row FROM v455_private.qa_cases c
 WHERE c.shop_code=p_shop AND c.event_id=p_event;
 IF NOT FOUND THEN RETURN;END IF;
 SELECT count(*) INTO n FROM v455_private.qa_review_audit a
 WHERE a.shop_code=p_shop AND a.event_id=p_event;
 SELECT a.seq,a.actor_sub,a.action,a.evidence_sha256,a.recorded_at
 INTO first_audit FROM v455_private.qa_review_audit a
 WHERE a.shop_code=p_shop AND a.event_id=p_event AND a.seq=1;
 SELECT a.seq,a.actor_sub,a.action,a.evidence_sha256,a.recorded_at
 INTO second_audit FROM v455_private.qa_review_audit a
 WHERE a.shop_code=p_shop AND a.event_id=p_event AND a.seq=2;
 source_ok := source_row.dispatch_state='pending' AND source_row.attempts=0 AND
   source_row.job_id=source_row.receipt_job AND
   source_row.new_version=source_row.receipt_version AND
   source_row.receipt_at<=source_row.inserted_at AND
   claim_row.state='manual_review' AND
   claim_row.review_reason IN ('send_unknown','provider_no_receipt','worker_crash') AND
   claim_row.claimed_at<=claim_row.reviewed_at AND
   source_row.inserted_at<=claim_row.claimed_at AND
   claim_row.reviewed_at<=case_row.created_at;
 first_ok := first_audit.seq=1 AND first_audit.action='investigate' AND
   first_audit.actor_sub=case_row.investigator_sub AND
   first_audit.evidence_sha256=case_row.investigation_evidence AND
   first_audit.recorded_at>=case_row.created_at;
 second_ok := second_audit.seq=2 AND second_audit.action='close_no_delivery_claim' AND
   second_audit.actor_sub=case_row.supervisor_sub AND
   second_audit.actor_sub<>case_row.investigator_sub AND
   second_audit.evidence_sha256=case_row.signoff_evidence AND
   second_audit.evidence_sha256<>first_audit.evidence_sha256 AND
   case_row.closed_at>=case_row.created_at AND
   second_audit.recorded_at>=case_row.closed_at AND
   second_audit.recorded_at>=first_audit.recorded_at;
 status := 'inconsistent';
 IF source_ok IS TRUE AND first_ok IS TRUE AND
    case_row.stage='awaiting_independent_signoff' AND
    case_row.supervisor_sub IS NULL AND case_row.signoff_evidence IS NULL AND
    case_row.closed_at IS NULL AND n=1
 THEN status:='consistent_awaiting';
 ELSIF source_ok IS TRUE AND first_ok IS TRUE AND second_ok IS TRUE AND
    case_row.stage='closed_without_delivery_assertion' AND n=2
 THEN status:='consistent_closed';END IF;
 RETURN QUERY SELECT status,p_event,case_row.stage,n;
END$$;
REVOKE ALL ON FUNCTION v456_private.qa_review_consistency(text,uuid)
 FROM PUBLIC,v456_anon,v456_authenticated;
DO $$BEGIN
 IF has_schema_privilege('v456_authenticated','v456_private','USAGE') OR
    has_function_privilege('v456_authenticated','v456_private.qa_review_consistency(text,uuid)','EXECUTE') OR
    has_table_privilege('v456_anon','v455_private.qa_review_audit','SELECT')
 THEN RAISE EXCEPTION 'V456_PUBLIC_AUDIT_EXPOSED';END IF;
END$$;
\echo V456_PG17_AUDIT_PRIVATE_ROLE_DENY_PASS
DO $$DECLARE z record;BEGIN
 SELECT * INTO z FROM v456_private.qa_review_consistency('qa_shop_a',
 '00000000-0000-0000-0000-000000004533');
 IF z.integrity_state IS DISTINCT FROM 'consistent_closed' OR z.audit_steps<>2 OR
    z.review_stage<>'closed_without_delivery_assertion'
 THEN RAISE EXCEPTION 'V456_CLOSED_CHAIN_NOT_CONSISTENT';END IF;
 IF EXISTS(SELECT 1 FROM v456_private.qa_review_consistency('qa_shop_b',
 '00000000-0000-0000-0000-000000004533'))
 THEN RAISE EXCEPTION 'V456_CROSS_SHOP_AUDIT_LEAK';END IF;
END$$;
\echo V456_PG17_FOUR_LEDGER_TWO_REVIEWERS_CONSISTENT_PASS
DO $$DECLARE z record;BEGIN
 SELECT * INTO z FROM v456_private.qa_review_consistency('qa_shop_a',
 '00000000-0000-0000-0000-000000004541');
 IF z.integrity_state IS DISTINCT FROM 'consistent_awaiting' OR z.audit_steps<>1 OR
    z.review_stage<>'awaiting_independent_signoff'
 THEN RAISE EXCEPTION 'V456_PENDING_SECOND_SIGNOFF_MISMATCH';END IF;
END$$;
\echo V456_PG17_PARTIAL_REVIEW_NOT_A_CLOSED_CASE_PASS
-- PostgreSQL superuser/DBA can bypass local triggers; demonstrate detection
-- of mismatching audit/case, but DO NOT claim this resists a compromised DBA
-- rewriting BOTH records or establishes true independent WORM history.
BEGIN;
ALTER TABLE v455_private.qa_review_audit DISABLE TRIGGER v455_deny_audit_mutation;
UPDATE v455_private.qa_review_audit SET evidence_sha256=repeat('f',64)
 WHERE shop_code='qa_shop_a' AND event_id='00000000-0000-0000-0000-000000004533' AND seq=2;
DO $$DECLARE z record;BEGIN
 SELECT * INTO z FROM v456_private.qa_review_consistency('qa_shop_a',
 '00000000-0000-0000-0000-000000004533');
 IF z.integrity_state IS DISTINCT FROM 'inconsistent'
 THEN RAISE EXCEPTION 'V456_TAMPER_NOT_DETECTED';END IF;
END$$;
ROLLBACK;
\echo V456_PG17_TAMPERED_REVIEW_AUDIT_DETECTED_AND_ROLLED_BACK_PASS
BEGIN;
ALTER TABLE v455_private.qa_cases DISABLE TRIGGER v455_guard_case_mutation;
UPDATE v455_private.qa_cases SET investigation_evidence=repeat('e',64)
 WHERE shop_code='qa_shop_a' AND event_id='00000000-0000-0000-0000-000000004533';
DO $$DECLARE z record;BEGIN
 SELECT * INTO z FROM v456_private.qa_review_consistency('qa_shop_a',
 '00000000-0000-0000-0000-000000004533');
 IF z.integrity_state IS DISTINCT FROM 'inconsistent'
 THEN RAISE EXCEPTION 'V456_CASE_TAMPER_NOT_DETECTED';END IF;
END$$;
ROLLBACK;
\echo V456_PG17_TAMPERED_CASE_DETECTED_AND_ROLLED_BACK_PASS
DO $$DECLARE z record;BEGIN
 SELECT * INTO z FROM v456_private.qa_review_consistency('qa_shop_a',
 '00000000-0000-0000-0000-000000004533');
 IF z.integrity_state IS DISTINCT FROM 'consistent_closed' THEN
   RAISE EXCEPTION 'V456_DISPOSABLE_TAMPER_ROLLBACK_FAILED';END IF;
 IF (SELECT dispatch_state FROM v453_private.qa_outbox
   WHERE event_id='00000000-0000-0000-0000-000000004533')<>'pending'
 THEN RAISE EXCEPTION 'V456_PROVIDER_DELIVERY_FALSE_CLAIM';END IF;
END$$;
\echo V456_PG17_ORIGINAL_OUTBOX_STILL_PENDING_NO_DELIVERY_ASSERTION_PASS
-- Workflow additionally runs 8 concurrent REPEATABLE READ, READ ONLY clients.

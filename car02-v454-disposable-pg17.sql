-- DPRO CAR02 V4.54 — SYNTHETIC V453 outbox claim and manual review.
-- MUST first load exact V453 disposable SQL into a throwaway PostgreSQL 17 DB.
-- NO LINE send, delivery status, retry path, real worker IAM, or production connection.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V454_PG17_DISPOSABLE_ONLY'; END IF;
 IF to_regclass('v453_private.qa_outbox') IS NULL OR
    to_regclass('v453_private.qa_receipts') IS NULL
 THEN RAISE EXCEPTION 'V454_V453_FIXTURE_REQUIRED'; END IF;
END $$;
CREATE ROLE v454_anon NOLOGIN;
CREATE ROLE v454_authenticated NOLOGIN;
CREATE SCHEMA v454_private;
REVOKE ALL ON SCHEMA v454_private FROM PUBLIC,v454_anon,v454_authenticated;
CREATE TABLE v454_private.qa_claims(
 shop_code text NOT NULL,event_id uuid NOT NULL,worker_id uuid NOT NULL,
 claim_token uuid NOT NULL DEFAULT gen_random_uuid(),
 state text NOT NULL CHECK(state IN ('claimed','manual_review')),
 review_reason text CHECK(review_reason IN ('send_unknown','provider_no_receipt','worker_crash')),
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reviewed_at timestamptz,
 PRIMARY KEY(shop_code,event_id),
 UNIQUE(claim_token),
 FOREIGN KEY(shop_code,event_id) REFERENCES v453_private.qa_outbox(shop_code,event_id)
   ON DELETE RESTRICT,
 CHECK ((state='claimed' AND review_reason IS NULL AND reviewed_at IS NULL) OR
        (state='manual_review' AND review_reason IS NOT NULL AND reviewed_at IS NOT NULL))
);
REVOKE ALL ON v454_private.qa_claims FROM PUBLIC,v454_anon,v454_authenticated;
CREATE FUNCTION v454_private.qa_guard_claim_update() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,v454_private AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'V454_CLAIM_IMMUTABLE'; END IF;
 IF OLD.state<>'claimed' OR NEW.state<>'manual_review' OR
   NEW.shop_code IS DISTINCT FROM OLD.shop_code OR
   NEW.event_id IS DISTINCT FROM OLD.event_id OR
   NEW.worker_id IS DISTINCT FROM OLD.worker_id OR
   NEW.claim_token IS DISTINCT FROM OLD.claim_token OR
   NEW.claimed_at IS DISTINCT FROM OLD.claimed_at OR
   NEW.review_reason IS NULL OR NEW.reviewed_at IS NULL
 THEN RAISE EXCEPTION 'V454_CLAIM_IMMUTABLE';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER v454_claim_guard BEFORE UPDATE OR DELETE ON v454_private.qa_claims
 FOR EACH ROW EXECUTE FUNCTION v454_private.qa_guard_claim_update();
CREATE FUNCTION v454_private.qa_claim_outbox(p_shop text,p_event uuid,p_worker uuid)
RETURNS TABLE(event_id uuid,claim_token uuid,state text)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,v454_private,v453_private AS $$
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR
    p_event IS NULL OR p_worker IS NULL
 THEN RAISE EXCEPTION 'V454_BAD_CLAIM_SCOPE'; END IF;
 -- The sole eligible source is an immutable V453 pending event with its
 -- matching durable receipt. No caller may manufacture an event in this function.
 RETURN QUERY
 INSERT INTO v454_private.qa_claims AS qa_claims(shop_code,event_id,worker_id,state)
 SELECT o.shop_code,o.event_id,p_worker,'claimed'::text
 FROM v453_private.qa_outbox o
 JOIN v453_private.qa_receipts r ON r.shop_code=o.shop_code AND r.request_id=o.event_id
 WHERE o.shop_code=p_shop AND o.event_id=p_event AND
       o.dispatch_state='pending' AND o.attempts=0 AND
       r.job_id=o.job_id AND r.new_version=o.new_version
 ON CONFLICT(shop_code,event_id) DO NOTHING
 RETURNING qa_claims.event_id,qa_claims.claim_token,qa_claims.state;
END $$;
CREATE FUNCTION v454_private.qa_quarantine_claim(p_shop text,p_event uuid,p_worker uuid,
 p_token uuid,p_reason text)
RETURNS TABLE(quarantined boolean)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,v454_private AS $$
DECLARE n integer;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR
    p_event IS NULL OR p_worker IS NULL OR p_token IS NULL OR
    p_reason IS NULL OR p_reason NOT IN ('send_unknown','provider_no_receipt','worker_crash')
 THEN RAISE EXCEPTION 'V454_BAD_REVIEW_SCOPE';END IF;
 UPDATE v454_private.qa_claims c
 SET state='manual_review',review_reason=p_reason,reviewed_at=clock_timestamp()
 WHERE c.shop_code=p_shop AND c.event_id=p_event AND c.worker_id=p_worker
 AND c.claim_token=p_token AND c.state='claimed';
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN QUERY SELECT n=1;
END $$;
REVOKE ALL ON FUNCTION v454_private.qa_guard_claim_update(),
 v454_private.qa_claim_outbox(text,uuid,uuid),
 v454_private.qa_quarantine_claim(text,uuid,uuid,uuid,text)
 FROM PUBLIC,v454_anon,v454_authenticated;
DO $$ BEGIN
 IF has_schema_privilege('v454_authenticated','v454_private','USAGE') OR
    has_table_privilege('v454_anon','v454_private.qa_claims','INSERT') OR
    has_function_privilege('v454_authenticated','v454_private.qa_claim_outbox(text,uuid,uuid)','EXECUTE') OR
    has_function_privilege('v454_anon','v454_private.qa_quarantine_claim(text,uuid,uuid,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'V454_PUBLIC_DISPATCH_AVAILABLE';END IF;
END $$;
\echo V454_PG17_DISPOSABLE_PRIVILEGE_GUARDS_PASS
DO $$ DECLARE ticket record; n integer; ok boolean; BEGIN
 SELECT * INTO ticket FROM v454_private.qa_claim_outbox('qa_shop_a',
   '00000000-0000-0000-0000-000000004533','00000000-0000-0000-0000-000000004541');
 IF ticket.event_id IS DISTINCT FROM '00000000-0000-0000-0000-000000004533'::uuid OR
    ticket.claim_token IS NULL OR ticket.state<>'claimed'
 THEN RAISE EXCEPTION 'V454_PENDING_SOURCE_NOT_CLAIMED';END IF;
 SELECT COUNT(*) INTO n FROM v454_private.qa_claim_outbox('qa_shop_a',
   '00000000-0000-0000-0000-000000004533','00000000-0000-0000-0000-000000004542');
 IF n<>0 THEN RAISE EXCEPTION 'V454_DIFFERENT_WORKER_RECLAIMED'; END IF;
 SELECT COUNT(*) INTO n FROM v454_private.qa_claim_outbox('qa_shop_b',
   '00000000-0000-0000-0000-000000004533','00000000-0000-0000-0000-000000004542');
 IF n<>0 THEN RAISE EXCEPTION 'V454_CROSSSHOP_CLAIM'; END IF;
 SELECT quarantined INTO ok FROM v454_private.qa_quarantine_claim('qa_shop_a',
   ticket.event_id,'00000000-0000-0000-0000-000000004541',
   '00000000-0000-0000-0000-000000004544','send_unknown');
 IF ok IS DISTINCT FROM false THEN RAISE EXCEPTION 'V454_WRONG_NONCE_QUARANTINED';END IF;
 SELECT quarantined INTO ok FROM v454_private.qa_quarantine_claim('qa_shop_a',
   ticket.event_id,'00000000-0000-0000-0000-000000004542',ticket.claim_token,'worker_crash');
 IF ok IS DISTINCT FROM false THEN RAISE EXCEPTION 'V454_WRONG_WORKER_QUARANTINED';END IF;
 SELECT quarantined INTO ok FROM v454_private.qa_quarantine_claim('qa_shop_a',
   ticket.event_id,'00000000-0000-0000-0000-000000004541',ticket.claim_token,'send_unknown');
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'V454_REVIEW_FLAG_MISSING';END IF;
 SELECT quarantined INTO ok FROM v454_private.qa_quarantine_claim('qa_shop_a',
   ticket.event_id,'00000000-0000-0000-0000-000000004541',ticket.claim_token,'send_unknown');
 IF ok IS DISTINCT FROM false THEN RAISE EXCEPTION 'V454_DOUBLE_QUARANTINE';END IF;
 SELECT COUNT(*) INTO n FROM v454_private.qa_claim_outbox('qa_shop_a',ticket.event_id,
    '00000000-0000-0000-0000-000000004541');
 IF n<>0 THEN RAISE EXCEPTION 'V454_REVIEW_REQUEUED';END IF;
 IF (SELECT dispatch_state FROM v453_private.qa_outbox WHERE event_id=ticket.event_id)<>'pending' OR
    (SELECT attempts FROM v453_private.qa_outbox WHERE event_id=ticket.event_id)<>0
 THEN RAISE EXCEPTION 'V454_ORIGINAL_OUTBOX_MUTATED';END IF;
END $$;
\echo V454_PG17_SINGLE_CLAIM_TENANT_NONCE_AND_REVIEW_PASS
DO $$ DECLARE reason text; BEGIN
 BEGIN
  UPDATE v454_private.qa_claims SET state='claimed',review_reason=NULL,reviewed_at=NULL;
  RAISE EXCEPTION 'UNEXPECTED_CLAIM_REARM';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;
  IF reason<>'V454_CLAIM_IMMUTABLE' THEN RAISE; END IF;
 END;
 BEGIN
  DELETE FROM v454_private.qa_claims;
  RAISE EXCEPTION 'UNEXPECTED_CLAIM_DELETE';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;
  IF reason<>'V454_CLAIM_IMMUTABLE' THEN RAISE; END IF;
 END;
 IF (SELECT COUNT(*) FROM v454_private.qa_claims)<>1 THEN RAISE EXCEPTION 'V454_CLAIM_LEDGER_TAMPERED';END IF;
END $$;
\echo V454_PG17_CLAIM_LEDGER_ONE_WAY_IMMUTABLE_PASS
-- Seed V453 PENDING outbox events (not deliveries!) for independent 8-way race.
DO $$ DECLARE a record;b record; BEGIN
 SELECT * INTO a FROM v453_private.qa_touch_and_queue('qa_shop_a',
  '00000000-0000-0000-0000-000000004513','00000000-0000-0000-0000-000000004556',
  '00000000-0000-0000-0000-000000004540',1,'00000000-0000-0000-0000-000000004540');
 SELECT * INTO b FROM v453_private.qa_touch_and_queue('qa_shop_a',
  '00000000-0000-0000-0000-000000004513','00000000-0000-0000-0000-000000004556',
  '00000000-0000-0000-0000-000000004541',1,'00000000-0000-0000-0000-000000004541');
 IF a.applied IS DISTINCT FROM true OR b.applied IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'V454_PENDING_SOURCE_MISSING';END IF;
 IF (SELECT COUNT(*) FROM v453_private.qa_outbox WHERE event_id IN (
    '00000000-0000-0000-0000-000000004540',
    '00000000-0000-0000-0000-000000004541'))<>2
 THEN RAISE EXCEPTION 'V454_SOURCE_EVENT_COUNT';END IF;
END $$;
\echo V454_PG17_INTEGRATED_V453_PENDING_SOURCE_PASS
-- This script does not create a LINE dispatcher, provider receipts or a retry route.

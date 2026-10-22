\set ON_ERROR_STOP on
-- V4.75 PRIVATE DISPOSABLE PG17 ONLY. Synthetic reviewer registry and evidence.
-- Prerequisite V471->V472->V473->V474 PG17 fixture scripts. NEVER release, send, update bookings.
CREATE SCHEMA v475_private;
REVOKE ALL ON SCHEMA v475_private FROM PUBLIC;
CREATE ROLE v475_untrusted NOLOGIN;
CREATE TABLE v475_private.qa_reviewer_registry(
 reviewer_id text PRIMARY KEY CHECK(reviewer_id ~ '^reviewer_[a-z0-9]{1,32}$'),
 reviewer_group text NOT NULL UNIQUE CHECK(reviewer_group IN ('independent_group_a','independent_group_b')),
 shop_code text NOT NULL, active boolean NOT NULL
);
INSERT INTO v475_private.qa_reviewer_registry VALUES
 ('reviewer_a','independent_group_a','qa_shop_a',true),
 ('reviewer_b','independent_group_b','qa_shop_a',true);
CREATE TABLE v475_private.qa_reviews(
 event_id varchar(26) NOT NULL REFERENCES v474_private.qa_quarantines(event_id),
 shop_code text NOT NULL,
 event_digest char(64) NOT NULL,
 evidence_digest char(64) NOT NULL,
 reviewer_id text NOT NULL REFERENCES v475_private.qa_reviewer_registry(reviewer_id),
 reviewer_group text NOT NULL,
 review_state text NOT NULL DEFAULT 'quarantine_audit_recorded'
  CHECK(review_state='quarantine_audit_recorded'),
 PRIMARY KEY(event_id,reviewer_id),
 UNIQUE(event_id,reviewer_group)
);
REVOKE ALL ON ALL TABLES IN SCHEMA v475_private FROM PUBLIC;
CREATE FUNCTION v475_private.qa_review(p_event varchar,p_shop text,p_digest text,p_evidence text,p_reviewer text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE q v474_private.qa_quarantines%ROWTYPE; r v475_private.qa_reviewer_registry%ROWTYPE; existing v475_private.qa_reviews%ROWTYPE;
BEGIN
 IF p_event IS NULL OR p_event !~ '^[0-9A-HJKMNP-TV-Z]{26}$'
 OR p_shop IS NULL OR p_shop !~ '^[a-z0-9][a-z0-9_-]{1,63}$'
 OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
 OR p_evidence IS NULL OR p_evidence !~ '^[a-f0-9]{64}$'
 OR p_reviewer IS NULL OR p_reviewer !~ '^reviewer_[a-z0-9]{1,32}$'
 THEN RETURN 'invalid_disposable_review'; END IF;
 SELECT * INTO q FROM v474_private.qa_quarantines WHERE event_id=p_event FOR UPDATE;
 IF NOT FOUND THEN RETURN 'not_quarantined'; END IF;
 IF q.shop_code<>p_shop OR q.event_digest<>p_digest OR q.review_state<>'quarantined_review_only'
 THEN RETURN 'quarantine_binding_refused'; END IF;
 SELECT * INTO r FROM v475_private.qa_reviewer_registry WHERE reviewer_id=p_reviewer;
 IF NOT FOUND OR r.shop_code<>p_shop OR r.active IS NOT TRUE THEN RETURN 'mock_reviewer_unverified'; END IF;
 SELECT * INTO existing FROM v475_private.qa_reviews WHERE event_id=p_event AND reviewer_id=p_reviewer;
 IF FOUND THEN
   IF existing.shop_code=p_shop AND existing.event_digest=p_digest AND existing.evidence_digest=p_evidence
      AND existing.reviewer_group=r.reviewer_group AND existing.review_state='quarantine_audit_recorded'
   THEN RETURN 'already_recorded'; END IF;
   RETURN 'review_conflict_refused';
 END IF;
 IF EXISTS(SELECT 1 FROM v475_private.qa_reviews WHERE event_id=p_event AND evidence_digest<>p_evidence)
 THEN RETURN 'evidence_conflict_refused'; END IF;
 IF EXISTS(SELECT 1 FROM v475_private.qa_reviews WHERE event_id=p_event AND reviewer_group=r.reviewer_group)
 THEN RETURN 'not_independent'; END IF;
 INSERT INTO v475_private.qa_reviews(event_id,shop_code,event_digest,evidence_digest,reviewer_id,reviewer_group)
 VALUES(p_event,p_shop,p_digest,p_evidence,p_reviewer,r.reviewer_group);
 RETURN 'synthetic_review_recorded';
END $$;
CREATE FUNCTION v475_private.qa_pair_status(p_event varchar,p_shop text,p_digest text,p_evidence text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE n integer; v_groups integer;
BEGIN
 SELECT count(*),count(DISTINCT reviewer_group) INTO n,v_groups FROM v475_private.qa_reviews
 WHERE event_id=p_event AND shop_code=p_shop AND event_digest=p_digest AND evidence_digest=p_evidence
 AND review_state='quarantine_audit_recorded';
 IF n=2 AND v_groups=2 AND EXISTS(SELECT 1 FROM v474_private.qa_quarantines
  WHERE event_id=p_event AND shop_code=p_shop AND event_digest=p_digest AND review_state='quarantined_review_only')
 THEN RETURN 'two_independent_mock_reviews_still_no_go'; END IF;
 RETURN 'incomplete_review_no_go';
END $$;
REVOKE ALL ON FUNCTION v475_private.qa_review(varchar,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION v475_private.qa_pair_status(varchar,text,text,text) FROM PUBLIC;
DO $$ BEGIN
 IF has_schema_privilege('v475_untrusted','v475_private','USAGE')
 OR has_table_privilege('v475_untrusted','v475_private.qa_reviews','SELECT')
 OR has_table_privilege('v475_untrusted','v475_private.qa_reviews','INSERT')
 OR has_function_privilege('v475_untrusted','v475_private.qa_review(varchar,text,text,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'V475_UNTRUSTED_REVIEW_ACCESS'; END IF;
END $$;
SELECT 'V475_PG17_PRIVATE_REVIEW_ROLE_AND_FUNCTION_DENIED_PASS';
DO $$ BEGIN
 IF v475_private.qa_review('01ARZ3NDEKTSV4RRFFQ69G5FAY','qa_shop_b',repeat('b',64),repeat('f',64),'reviewer_a')<>'quarantine_binding_refused'
 THEN RAISE EXCEPTION 'CROSS_SHOP_APPROVAL'; END IF;
 IF v475_private.qa_review('01ARZ3NDEKTSV4RRFFQ69G5FAY','qa_shop_a',repeat('c',64),repeat('f',64),'reviewer_a')<>'quarantine_binding_refused'
 THEN RAISE EXCEPTION 'DIGEST_TAMPER'; END IF;
 IF v475_private.qa_review('01ARZ3NDEKTSV4RRFFQ69G5FAZ','qa_shop_a',repeat('c',64),repeat('f',64),'reviewer_a')<>'not_quarantined'
 THEN RAISE EXCEPTION 'NOT_QUARANTINED'; END IF;
 IF v475_private.qa_review('01ARZ3NDEKTSV4RRFFQ69G5FAY','qa_shop_a',repeat('b',64),repeat('f',64),'reviewer_fake')<>'mock_reviewer_unverified'
 THEN RAISE EXCEPTION 'UNVERIFIED_REVIEWER'; END IF;
 IF v475_private.qa_pair_status('01ARZ3NDEKTSV4RRFFQ69G5FAY','qa_shop_a',repeat('b',64),repeat('f',64))<>'incomplete_review_no_go'
 THEN RAISE EXCEPTION 'ZERO_REVIEW_ALLOW'; END IF;
END $$;
SELECT 'V475_PG17_CROSS_TENANT_DIGEST_AND_UNQUARANTINED_REFUSED_PASS';
BEGIN;
DO $$ BEGIN
 IF v475_private.qa_review('01ARZ3NDEKTSV4RRFFQ69G5FAY','qa_shop_a',repeat('b',64),repeat('f',64),'reviewer_a')<>'synthetic_review_recorded'
 THEN RAISE EXCEPTION 'ROLLBACK_TEST_FAILED'; END IF;
END $$;
ROLLBACK;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM v475_private.qa_reviews) THEN RAISE EXCEPTION 'ROLLBACK_LEAK'; END IF;
END $$;
SELECT 'V475_PG17_ROLLBACK_AND_NO_REAL_WRITES_PASS';
DO $$ BEGIN
 IF v475_private.qa_review('01ARZ3NDEKTSV4RRFFQ69G5FAY','qa_shop_a',repeat('b',64),repeat('f',64),'reviewer_b')<>'synthetic_review_recorded'
 THEN RAISE EXCEPTION 'REVIEWER_B_SETUP'; END IF;
 IF v475_private.qa_review('01ARZ3NDEKTSV4RRFFQ69G5FAY','qa_shop_a',repeat('b',64),repeat('g',64),'reviewer_b')<>'invalid_disposable_review'
 THEN RAISE EXCEPTION 'INVALID_HASH_ACCEPTED'; END IF;
 IF v475_private.qa_review('01ARZ3NDEKTSV4RRFFQ69G5FAY','qa_shop_a',repeat('b',64),repeat('e',64),'reviewer_b')<>'review_conflict_refused'
 THEN RAISE EXCEPTION 'CHANGED_EVIDENCE_ACCEPTED'; END IF;
 IF v475_private.qa_pair_status('01ARZ3NDEKTSV4RRFFQ69G5FAY','qa_shop_a',repeat('b',64),repeat('f',64))<>'incomplete_review_no_go'
 THEN RAISE EXCEPTION 'ONE_REVIEWER_SUFFICIENT'; END IF;
END $$;
SELECT 'V475_PG17_ONE_PERSON_NO_RELEASE_AND_EVIDENCE_IMMUTABLE_PASS';
SELECT 'V475_FINAL_RELEASE_NO_GO_HOLD_TRUE';

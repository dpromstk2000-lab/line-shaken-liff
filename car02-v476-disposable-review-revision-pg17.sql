\set ON_ERROR_STOP on
-- CAR02 V4.76 synthetic review revocation fence (disposable PostgreSQL17 ONLY).
-- Prerequisites V471..V475 fixtures. No real personnel, auth, reservations, LINE, or release.
CREATE SCHEMA v476_private;
REVOKE ALL ON SCHEMA v476_private FROM PUBLIC;
CREATE ROLE v476_untrusted NOLOGIN;
CREATE TABLE v476_private.qa_revision_fence (
 event_id varchar(26) PRIMARY KEY REFERENCES v474_private.qa_quarantines(event_id),
 shop_code text NOT NULL,
 event_digest char(64) NOT NULL,
 evidence_digest char(64) NOT NULL,
 revision bigint NOT NULL CHECK (revision > 0),
 invalidated boolean NOT NULL DEFAULT false,
 observed_at_ms bigint NOT NULL CHECK(observed_at_ms > 0)
);
CREATE TABLE v476_private.qa_revision_events (
 event_id varchar(26) NOT NULL REFERENCES v476_private.qa_revision_fence(event_id),
 previous_revision bigint NOT NULL,
 new_revision bigint NOT NULL,
 reason text NOT NULL CHECK (reason IN ('evidence_superseded','reviewer_revoked','quarantine_revision_changed')),
 recorded_at_ms bigint NOT NULL,
 PRIMARY KEY(event_id,new_revision)
);
REVOKE ALL ON ALL TABLES IN SCHEMA v476_private FROM PUBLIC;
-- Seed synthetic second reviewer; two recorded attestations DO NOT authorize release.
DO $$ BEGIN
 IF v475_private.qa_review('01ARZ3NDEKTSV4RRFFQ69G5FAY','qa_shop_a',repeat('b',64),repeat('f',64),'reviewer_a')<>'synthetic_review_recorded'
 THEN RAISE EXCEPTION 'V476_SYNTHETIC_PAIR_SETUP'; END IF;
END $$;
INSERT INTO v476_private.qa_revision_fence(event_id,shop_code,event_digest,evidence_digest,revision,observed_at_ms)
VALUES ('01ARZ3NDEKTSV4RRFFQ69G5FAY','qa_shop_a',repeat('b',64),repeat('f',64),1,1800000000000);
CREATE FUNCTION v476_private.qa_pair_state(p_shop text,p_event varchar,p_event_digest text,p_evidence_digest text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE f v476_private.qa_revision_fence%ROWTYPE;
BEGIN
 SELECT * INTO f FROM v476_private.qa_revision_fence WHERE event_id=p_event;
 IF NOT FOUND OR f.shop_code IS DISTINCT FROM p_shop OR f.event_digest IS DISTINCT FROM p_event_digest
  OR f.evidence_digest IS DISTINCT FROM p_evidence_digest THEN RETURN 'binding_unverified_no_go'; END IF;
 IF f.invalidated IS TRUE THEN RETURN 'revision_invalidated_no_go'; END IF;
 IF v475_private.qa_pair_status(p_event,p_shop,p_event_digest,p_evidence_digest)='two_independent_mock_reviews_still_no_go'
 THEN RETURN 'two_mock_reviews_observed_still_no_go'; END IF;
 RETURN 'incomplete_mock_review_no_go';
END $$;
CREATE FUNCTION v476_private.qa_invalidate(p_shop text,p_event varchar,p_event_digest text,p_evidence_digest text,
 p_expected_revision bigint,p_reason text,p_now_ms bigint)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE f v476_private.qa_revision_fence%ROWTYPE; q v474_private.qa_quarantines%ROWTYPE;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[a-z0-9][a-z0-9_-]{1,63}$'
  OR p_event IS NULL OR p_event !~ '^[0-9A-HJKMNP-TV-Z]{26}$'
  OR p_event_digest IS NULL OR p_event_digest !~ '^[a-f0-9]{64}$'
  OR p_evidence_digest IS NULL OR p_evidence_digest !~ '^[a-f0-9]{64}$'
  OR p_expected_revision IS NULL OR p_expected_revision < 1
  OR p_reason IS NULL OR p_reason NOT IN ('evidence_superseded','reviewer_revoked','quarantine_revision_changed')
  OR p_now_ms IS NULL OR p_now_ms < 1 THEN RETURN 'invalid_disposable_invalidation'; END IF;
 SELECT * INTO f FROM v476_private.qa_revision_fence WHERE event_id=p_event FOR UPDATE;
 IF NOT FOUND OR f.shop_code <> p_shop OR f.event_digest <> p_event_digest
  OR f.evidence_digest <> p_evidence_digest THEN RETURN 'revision_binding_refused'; END IF;
 IF f.invalidated OR f.revision <> p_expected_revision THEN RETURN 'stale_revision'; END IF;
 IF p_now_ms < f.observed_at_ms THEN RETURN 'clock_rollback_refused'; END IF;
 SELECT * INTO q FROM v474_private.qa_quarantines WHERE event_id=p_event;
 IF NOT FOUND OR q.shop_code <> p_shop OR q.event_digest <> p_event_digest OR q.review_state <> 'quarantined_review_only'
 THEN RETURN 'quarantine_not_stable'; END IF;
 IF v475_private.qa_pair_status(p_event,p_shop,p_event_digest,p_evidence_digest) <> 'two_independent_mock_reviews_still_no_go'
 THEN RETURN 'two_reviews_unverified'; END IF;
 UPDATE v476_private.qa_revision_fence SET revision=revision+1,invalidated=true,observed_at_ms=p_now_ms WHERE event_id=p_event;
 INSERT INTO v476_private.qa_revision_events VALUES(p_event,f.revision,f.revision+1,p_reason,p_now_ms);
 RETURN 'mock_revision_invalidated';
END $$;
REVOKE ALL ON FUNCTION v476_private.qa_pair_state(text,varchar,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION v476_private.qa_invalidate(text,varchar,text,text,bigint,text,bigint) FROM PUBLIC;
DO $$ BEGIN
 IF has_schema_privilege('v476_untrusted','v476_private','USAGE') OR
    has_table_privilege('v476_untrusted','v476_private.qa_revision_fence','SELECT') OR
    has_table_privilege('v476_untrusted','v476_private.qa_revision_fence','UPDATE') OR
    has_function_privilege('v476_untrusted','v476_private.qa_invalidate(text,character varying,text,text,bigint,text,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'V476_REVIEW_FENCE_PUBLIC_LEAK'; END IF;
END $$;
SELECT 'V476_PG17_PRIVATE_REVISION_FENCE_ROLE_DENY_PASS';
DO $$ BEGIN
 IF v476_private.qa_pair_state('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),repeat('f',64)) <> 'two_mock_reviews_observed_still_no_go'
 THEN RAISE EXCEPTION 'V476_MISSING_PAIR_SETUP'; END IF;
 IF v476_private.qa_pair_state('qa_shop_b','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),repeat('f',64)) <> 'binding_unverified_no_go'
 THEN RAISE EXCEPTION 'V476_CROSS_SHOP_READ'; END IF;
END $$;
SELECT 'V476_PG17_TWO_MOCK_REVIEWS_STILL_NO_GO_PASS';
DO $$ BEGIN
 IF v476_private.qa_invalidate('qa_shop_b','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),repeat('f',64),1,'reviewer_revoked',1800000000100)<>'revision_binding_refused'
 THEN RAISE EXCEPTION 'V476_CROSS_SHOP_INVALIDATED'; END IF;
 IF v476_private.qa_invalidate('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('c',64),repeat('f',64),1,'reviewer_revoked',1800000000100)<>'revision_binding_refused'
 THEN RAISE EXCEPTION 'V476_OTHER_DIGEST_INVALIDATED'; END IF;
 IF v476_private.qa_invalidate('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),repeat('e',64),1,'reviewer_revoked',1800000000100)<>'revision_binding_refused'
 THEN RAISE EXCEPTION 'V476_OTHER_EVIDENCE_INVALIDATED'; END IF;
 IF v476_private.qa_invalidate('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),repeat('f',64),0,'reviewer_revoked',1800000000100)<>'invalid_disposable_invalidation'
 THEN RAISE EXCEPTION 'V476_ZERO_REVISION_INVALIDATED'; END IF;
 IF v476_private.qa_invalidate('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),repeat('f',64),1,'release_allowed',1800000000100)<>'invalid_disposable_invalidation'
 THEN RAISE EXCEPTION 'V476_RELEASE_REASON_ALLOWED'; END IF;
 IF v476_private.qa_invalidate('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),repeat('f',64),1,'reviewer_revoked',1799999999999)<>'clock_rollback_refused'
 THEN RAISE EXCEPTION 'V476_CLOCK_ROLLBACK_INVALIDATED'; END IF;
END $$;
SELECT 'V476_PG17_CROSS_TENANT_EVIDENCE_CLOCK_AND_REVISION_DENIED_PASS';
BEGIN;
DO $$ BEGIN
 IF v476_private.qa_invalidate('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),repeat('f',64),1,'evidence_superseded',1800000000100)<>'mock_revision_invalidated'
 THEN RAISE EXCEPTION 'V476_ROLLBACK_SETUP'; END IF;
 IF v476_private.qa_pair_state('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),repeat('f',64)) <> 'revision_invalidated_no_go'
 THEN RAISE EXCEPTION 'V476_INVALIDATION_NOT_VISIBLE'; END IF;
END $$;
ROLLBACK;
DO $$ BEGIN
 IF (SELECT revision FROM v476_private.qa_revision_fence WHERE event_id='01ARZ3NDEKTSV4RRFFQ69G5FAY') <> 1
 OR EXISTS(SELECT 1 FROM v476_private.qa_revision_events)
 OR v476_private.qa_pair_state('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),repeat('f',64)) <> 'two_mock_reviews_observed_still_no_go'
 THEN RAISE EXCEPTION 'V476_ROLLBACK_NOT_ATOMIC'; END IF;
END $$;
SELECT 'V476_PG17_REVISION_ROLLBACK_RESTORES_REVIEW_ONLY_PASS';
SELECT 'V476_FINAL_RELEASE_NO_GO_HOLD_TRUE';

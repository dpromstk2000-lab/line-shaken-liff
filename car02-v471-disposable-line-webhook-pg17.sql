\set ON_ERROR_STOP on
-- CAR02 V4.71 disposable PostgreSQL17 ONLY. Never run on shared/production DB.
-- Synthetic webhook ULIDs only; no phone numbers, LINE user IDs or tokens.
CREATE SCHEMA v471_private;
REVOKE ALL ON SCHEMA v471_private FROM PUBLIC;
CREATE TABLE v471_private.qa_webhook_events (
  event_id varchar(26) PRIMARY KEY,
  shop_code text NOT NULL CHECK (shop_code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  first_seen_at_ms bigint NOT NULL CHECK (first_seen_at_ms > 0)
);
REVOKE ALL ON ALL TABLES IN SCHEMA v471_private FROM PUBLIC;
CREATE ROLE v471_webhook_public NOLOGIN;
CREATE FUNCTION v471_private.qa_review(p_shop text,p_id varchar,p_digest text)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v471_private.qa_webhook_events WHERE event_id=p_id)
  THEN 'unseen_review_only'
  WHEN EXISTS (SELECT 1 FROM v471_private.qa_webhook_events
   WHERE event_id=p_id AND shop_code=p_shop AND payload_sha256=p_digest)
  THEN 'duplicate_review_only'
  ELSE 'collision_manual_review' END
$$;
REVOKE ALL ON FUNCTION v471_private.qa_review(text,varchar,text) FROM PUBLIC;
INSERT INTO v471_private.qa_webhook_events VALUES
 ('01ARZ3NDEKTSV4RRFFQ69G5FAV','qa_shop_a',repeat('a',64),1800000000000),
 ('01ARZ3NDEKTSV4RRFFQ69G5FAW','qa_shop_b',repeat('b',64),1800000000000);
DO $$ BEGIN
  IF has_schema_privilege('v471_webhook_public','v471_private','USAGE') OR
     has_table_privilege('v471_webhook_public','v471_private.qa_webhook_events','SELECT') OR
     has_table_privilege('v471_webhook_public','v471_private.qa_webhook_events','INSERT') OR
     has_function_privilege('v471_webhook_public','v471_private.qa_review(text,character varying,text)','EXECUTE')
  THEN RAISE EXCEPTION 'V471_PUBLIC_ROLE_LEAK'; END IF;
END $$;
SELECT 'V471_PG17_PRIVATE_LEDGER_AND_ROLE_DENY_PASS';
DO $$ BEGIN
  IF v471_private.qa_review('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAV',repeat('a',64)) <> 'duplicate_review_only'
    OR v471_private.qa_review('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAV',repeat('c',64)) <> 'collision_manual_review'
    OR v471_private.qa_review('qa_shop_b','01ARZ3NDEKTSV4RRFFQ69G5FAV',repeat('a',64)) <> 'collision_manual_review'
    OR v471_private.qa_review('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAX',repeat('a',64)) <> 'unseen_review_only'
  THEN RAISE EXCEPTION 'V471_REVIEW_STATE_INCONSISTENT'; END IF;
END $$;
SELECT 'V471_PG17_DUPLICATE_COLLISION_AND_CROSS_SHOP_REVIEW_PASS';
BEGIN;
INSERT INTO v471_private.qa_webhook_events VALUES
 ('01ARZ3NDEKTSV4RRFFQ69G5FAV','qa_shop_b',repeat('c',64),1800000000001)
 ON CONFLICT (event_id) DO NOTHING;
DO $$ BEGIN
 IF (SELECT count(*) FROM v471_private.qa_webhook_events) <> 2 OR
    (SELECT shop_code FROM v471_private.qa_webhook_events
     WHERE event_id='01ARZ3NDEKTSV4RRFFQ69G5FAV') <> 'qa_shop_a'
 THEN RAISE EXCEPTION 'V471_TENANT_COLLISION_INSERTED'; END IF;
END $$;
ROLLBACK;
SELECT 'V471_PG17_GLOBAL_EVENT_ID_UNIQUENESS_CROSS_TENANT_PASS';
SELECT 'V471_FINAL_RELEASE_NO_GO_HOLD_TRUE';

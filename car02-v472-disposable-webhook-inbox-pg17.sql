\set ON_ERROR_STOP on
-- DPRO CAR02 V4.72: DISPOSABLE PostgreSQL 17 ONLY. No live LINE messages or production DDL.
-- Store only synthetic event ID + content digest. No addresses, tokens, message body, or PII.
CREATE SCHEMA v472_private;
REVOKE ALL ON SCHEMA v472_private FROM PUBLIC;
CREATE ROLE v472_inbox_public NOLOGIN;
CREATE TABLE v472_private.qa_inbox (
 event_id varchar(26) PRIMARY KEY CHECK (event_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
 shop_code text NOT NULL CHECK (shop_code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
 event_digest char(64) NOT NULL CHECK (event_digest ~ '^[a-f0-9]{64}$'),
 receipt_state text NOT NULL DEFAULT 'pending' CHECK (receipt_state='pending'),
 first_seen_ms bigint NOT NULL CHECK (first_seen_ms > 0)
);
REVOKE ALL ON ALL TABLES IN SCHEMA v472_private FROM PUBLIC;
CREATE FUNCTION v472_private.qa_claim(p_shop text,p_id varchar,p_digest text,p_now bigint)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE v_saved v472_private.qa_inbox%ROWTYPE; v_inserted varchar(26);
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[a-z0-9][a-z0-9_-]{1,63}$'
    OR p_id IS NULL OR p_id !~ '^[0-9A-HJKMNP-TV-Z]{26}$'
    OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
    OR p_now IS NULL OR p_now <= 0 THEN
   RETURN 'refused_invalid';
 END IF;
 INSERT INTO v472_private.qa_inbox(event_id,shop_code,event_digest,first_seen_ms)
 VALUES (p_id,p_shop,p_digest,p_now)
 ON CONFLICT (event_id) DO NOTHING RETURNING event_id INTO v_inserted;
 IF v_inserted IS NOT NULL THEN RETURN 'claimed_pending'; END IF;
 SELECT * INTO v_saved FROM v472_private.qa_inbox WHERE event_id=p_id;
 IF NOT FOUND THEN RETURN 'unverified_conflict'; END IF;
 IF v_saved.shop_code=p_shop AND v_saved.event_digest=p_digest AND v_saved.receipt_state='pending'
 THEN RETURN 'duplicate_pending'; END IF;
 RETURN 'collision_manual_review';
END $$;
REVOKE ALL ON FUNCTION v472_private.qa_claim(text,varchar,text,bigint) FROM PUBLIC;
DO $$ BEGIN
 IF has_schema_privilege('v472_inbox_public','v472_private','USAGE')
 OR has_table_privilege('v472_inbox_public','v472_private.qa_inbox','SELECT')
 OR has_table_privilege('v472_inbox_public','v472_private.qa_inbox','INSERT')
 OR has_function_privilege('v472_inbox_public','v472_private.qa_claim(text,character varying,text,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'V472_PRIVATE_ACCESS_LEAK'; END IF;
END $$;
SELECT 'V472_PG17_PRIVATE_INBOX_ROLE_DENIED_PASS';
INSERT INTO v472_private.qa_inbox(event_id,shop_code,event_digest,first_seen_ms)
VALUES('01ARZ3NDEKTSV4RRFFQ69G5FAX','qa_shop_a',repeat('a',64),1800000000000);
DO $$ BEGIN
 IF v472_private.qa_claim('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAX',repeat('a',64),1800000000001) <> 'duplicate_pending'
 OR v472_private.qa_claim('qa_shop_b','01ARZ3NDEKTSV4RRFFQ69G5FAX',repeat('a',64),1800000000001) <> 'collision_manual_review'
 OR v472_private.qa_claim('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAX',repeat('b',64),1800000000001) <> 'collision_manual_review'
 OR v472_private.qa_claim('bad shop','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('a',64),1800000000001) <> 'refused_invalid'
 THEN RAISE EXCEPTION 'V472_DUPLICATE_OR_CROSS_TENANT_FAILURE'; END IF;
 IF (SELECT count(*) FROM v472_private.qa_inbox) <> 1 THEN
  RAISE EXCEPTION 'V472_DUPLICATE_CHANGED_ROWS'; END IF;
END $$;
SELECT 'V472_PG17_DUPLICATE_SAME_AND_CROSS_TENANT_DIFFERENT_REJECTED_PASS';
BEGIN;
DO $$ BEGIN
 IF v472_private.qa_claim('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAZ',repeat('c',64),1800000000003) <> 'claimed_pending'
 OR v472_private.qa_claim('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAZ',repeat('c',64),1800000000004) <> 'duplicate_pending'
 THEN RAISE EXCEPTION 'V472_ATOMIC_CLAIM_NOT_STABLE'; END IF;
END $$;
ROLLBACK;
DO $$ BEGIN
 IF (SELECT count(*) FROM v472_private.qa_inbox) <> 1 OR
    EXISTS (SELECT 1 FROM v472_private.qa_inbox WHERE receipt_state<>'pending')
 THEN RAISE EXCEPTION 'V472_ROLLBACK_OR_NO_DELIVERY_INVARIANT_BROKEN'; END IF;
END $$;
SELECT 'V472_PG17_TRANSACTION_ROLLBACK_AND_PENDING_NO_DELIVERY_PASS';
SELECT 'V472_FINAL_RELEASE_NO_GO_HOLD_TRUE';

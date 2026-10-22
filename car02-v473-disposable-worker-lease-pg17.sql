\set ON_ERROR_STOP on
-- CAR02 V4.73: disposable synthetic PostgreSQL17 ONLY. No real worker, LINE, Supabase or customer rows.
-- Precondition: v472_private.qa_inbox exists (disposable V472 fixture).
CREATE SCHEMA v473_private;
REVOKE ALL ON SCHEMA v473_private FROM PUBLIC;
CREATE ROLE v473_lease_public NOLOGIN;
CREATE TABLE v473_private.qa_leases(
 event_id varchar(26) PRIMARY KEY REFERENCES v472_private.qa_inbox(event_id),
 shop_code text NOT NULL,
 event_digest char(64) NOT NULL,
 lease_state text NOT NULL DEFAULT 'pending' CHECK(lease_state IN('pending','leased','review_only')),
 lease_epoch bigint NOT NULL DEFAULT 0 CHECK(lease_epoch>=0),
 lease_token_hash char(64),
 worker_id text,
 lease_started_ms bigint NOT NULL DEFAULT 0,
 lease_until_ms bigint NOT NULL DEFAULT 0,
 CHECK ((lease_state='pending' AND lease_epoch=0 AND lease_token_hash IS NULL AND worker_id IS NULL)
    OR (lease_state<>'pending' AND lease_epoch>0 AND lease_token_hash IS NOT NULL AND worker_id IS NOT NULL))
);
REVOKE ALL ON ALL TABLES IN SCHEMA v473_private FROM PUBLIC;
INSERT INTO v473_private.qa_leases(event_id,shop_code,event_digest)
 SELECT event_id,shop_code,event_digest FROM v472_private.qa_inbox;
CREATE FUNCTION v473_private.qa_acquire(p_shop text,p_id varchar,p_digest text,p_worker text,p_token text,p_now bigint,p_ttl bigint)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE v v473_private.qa_leases%ROWTYPE;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[a-z0-9][a-z0-9_-]{1,63}$'
 OR p_id IS NULL OR p_id !~ '^[0-9A-HJKMNP-TV-Z]{26}$'
 OR p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$'
 OR p_worker IS NULL OR p_worker !~ '^worker_[a-z0-9]{1,32}$'
 OR p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$'
 OR p_now IS NULL OR p_now<=0 OR p_ttl IS NULL OR p_ttl<1000 OR p_ttl>600000
 OR p_now > 9223372036854775807-p_ttl THEN RETURN 'refused_invalid'; END IF;
 SELECT * INTO v FROM v473_private.qa_leases WHERE event_id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 'unknown_event_refused'; END IF;
 IF v.shop_code<>p_shop OR v.event_digest<>p_digest THEN RETURN 'collision_refused'; END IF;
 IF NOT EXISTS(SELECT 1 FROM v472_private.qa_inbox
    WHERE event_id=p_id AND shop_code=p_shop AND event_digest=p_digest AND receipt_state='pending')
 THEN RETURN 'unverified_pending_receipt'; END IF;
 IF v.lease_state='review_only' THEN RETURN 'review_closed'; END IF;
 IF v.lease_state='leased' AND p_now < v.lease_started_ms THEN RETURN 'clock_rollback_refused'; END IF;
 IF v.lease_state='leased' AND p_now < v.lease_until_ms THEN RETURN 'active_lease_conflict'; END IF;
 UPDATE v473_private.qa_leases SET lease_state='leased',lease_epoch=v.lease_epoch+1,
    lease_token_hash=p_token,worker_id=p_worker,lease_started_ms=p_now,lease_until_ms=p_now+p_ttl
 WHERE event_id=p_id;
 RETURN 'leased_mock';
END $$;
CREATE FUNCTION v473_private.qa_finish_review(p_shop text,p_id varchar,p_worker text,p_token text,p_epoch bigint,p_now bigint)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE v v473_private.qa_leases%ROWTYPE;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[a-z0-9][a-z0-9_-]{1,63}$' OR p_id IS NULL OR p_id !~ '^[0-9A-HJKMNP-TV-Z]{26}$'
  OR p_worker IS NULL OR p_worker !~ '^worker_[a-z0-9]{1,32}$' OR p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$'
  OR p_epoch IS NULL OR p_epoch<1 OR p_now IS NULL OR p_now<1 THEN RETURN 'refused_invalid'; END IF;
 SELECT * INTO v FROM v473_private.qa_leases WHERE event_id=p_id FOR UPDATE;
 IF NOT FOUND OR v.shop_code<>p_shop THEN RETURN 'refused_unowned'; END IF;
 IF v.lease_state<>'leased' OR v.lease_epoch<>p_epoch OR v.lease_token_hash<>p_token OR v.worker_id<>p_worker
  OR p_now<v.lease_started_ms OR p_now>=v.lease_until_ms THEN RETURN 'stale_or_invalid_lease'; END IF;
 UPDATE v473_private.qa_leases SET lease_state='review_only' WHERE event_id=p_id;
 RETURN 'offline_review_closed_not_processed';
END $$;
REVOKE ALL ON FUNCTION v473_private.qa_acquire(text,varchar,text,text,text,bigint,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION v473_private.qa_finish_review(text,varchar,text,text,bigint,bigint) FROM PUBLIC;
DO $$ BEGIN
 IF has_schema_privilege('v473_lease_public','v473_private','USAGE')
 OR has_table_privilege('v473_lease_public','v473_private.qa_leases','SELECT')
 OR has_table_privilege('v473_lease_public','v473_private.qa_leases','UPDATE')
 OR has_function_privilege('v473_lease_public','v473_private.qa_acquire(text,character varying,text,text,text,bigint,bigint)','EXECUTE')
 OR has_function_privilege('v473_lease_public','v473_private.qa_finish_review(text,character varying,text,text,bigint,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'V473_ROLE_ACCESS_LEAK'; END IF;
END $$;
SELECT 'V473_PG17_PRIVATE_LEASE_FUNCTIONS_AND_TABLE_DENIED_PASS';
DO $$ BEGIN
 IF v473_private.qa_acquire('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAX',repeat('a',64),'worker_a',repeat('a',64),1800000000000,30000)<>'leased_mock'
 THEN RAISE EXCEPTION 'V473_FIRST_LEASE_NOT_GRANTED'; END IF;
 IF v473_private.qa_acquire('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAX',repeat('a',64),'worker_b',repeat('b',64),1800000000001,30000)<>'active_lease_conflict'
 THEN RAISE EXCEPTION 'V473_ACTIVE_LEASE_NOT_PROTECTED'; END IF;
 IF v473_private.qa_acquire('qa_shop_b','01ARZ3NDEKTSV4RRFFQ69G5FAX',repeat('a',64),'worker_b',repeat('b',64),1800000000001,30000)<>'collision_refused'
 THEN RAISE EXCEPTION 'V473_CROSS_TENANT_NOT_PROTECTED'; END IF;
 IF v473_private.qa_acquire('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAX',repeat('b',64),'worker_b',repeat('b',64),1800000000001,30000)<>'collision_refused'
 THEN RAISE EXCEPTION 'V473_EVENT_HASH_NOT_PROTECTED'; END IF;
 IF v473_private.qa_acquire('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAX',repeat('a',64),'worker_b',repeat('b',64),1799999999999,30000)<>'clock_rollback_refused'
 THEN RAISE EXCEPTION 'V473_CLOCK_ROLLBACK_NOT_PROTECTED'; END IF;
END $$;
SELECT 'V473_PG17_ONE_LEASE_OWNER_CROSS_TENANT_AND_CLOCK_ROLLBACK_DENIED_PASS';
DO $$ BEGIN
 IF v473_private.qa_acquire('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAX',repeat('a',64),'worker_b',repeat('b',64),1800000030000,30000)<>'leased_mock'
 THEN RAISE EXCEPTION 'V473_EXPIRED_RECLAIM_FAILED'; END IF;
 IF v473_private.qa_finish_review('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAX','worker_a',repeat('a',64),1,1800000030001)<>'stale_or_invalid_lease'
 THEN RAISE EXCEPTION 'V473_OLD_WORKER_ACCEPTED'; END IF;
 IF v473_private.qa_finish_review('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAX','worker_b',repeat('b',64),1,1800000030001)<>'stale_or_invalid_lease'
 THEN RAISE EXCEPTION 'V473_OLD_EPOCH_ACCEPTED'; END IF;
 IF v473_private.qa_finish_review('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAX','worker_b',repeat('b',64),2,1800000060000)<>'stale_or_invalid_lease'
 THEN RAISE EXCEPTION 'V473_EXPIRED_COMPLETION_ACCEPTED'; END IF;
 IF v473_private.qa_finish_review('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAX','worker_b',repeat('b',64),2,1800000030001)<>'offline_review_closed_not_processed'
 THEN RAISE EXCEPTION 'V473_REVIEW_CLOSE_FAILED'; END IF;
 IF v473_private.qa_acquire('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAX',repeat('a',64),'worker_a',repeat('a',64),1800000030002,30000)<>'review_closed'
 THEN RAISE EXCEPTION 'V473_CLOSED_ROW_RECLAIMED'; END IF;
 IF (SELECT lease_state FROM v473_private.qa_leases WHERE event_id='01ARZ3NDEKTSV4RRFFQ69G5FAX')<>'review_only'
 THEN RAISE EXCEPTION 'V473_REVIEW_ONLY_STATE_BROKEN'; END IF;
END $$;
SELECT 'V473_PG17_EXPIRED_RECLAIM_STALE_EPOCH_AND_NO_DELIVERY_PASS';
INSERT INTO v472_private.qa_inbox(event_id,shop_code,event_digest,first_seen_ms)
 VALUES('01ARZ3NDEKTSV4RRFFQ69G5FAY','qa_shop_a',repeat('b',64),1800000000000),
       ('01ARZ3NDEKTSV4RRFFQ69G5FAZ','qa_shop_a',repeat('c',64),1800000000000);
INSERT INTO v473_private.qa_leases(event_id,shop_code,event_digest)
 SELECT event_id,shop_code,event_digest FROM v472_private.qa_inbox WHERE event_id IN('01ARZ3NDEKTSV4RRFFQ69G5FAY','01ARZ3NDEKTSV4RRFFQ69G5FAZ');
BEGIN;
DO $$ BEGIN
 IF v473_private.qa_acquire('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),'worker_a',repeat('d',64),1800000000000,30000)<>'leased_mock'
 THEN RAISE EXCEPTION 'V473_EXPECTED_LEASE_IN_TRANSACTION'; END IF;
END $$;
ROLLBACK;
DO $$ BEGIN
 IF (SELECT lease_state FROM v473_private.qa_leases WHERE event_id='01ARZ3NDEKTSV4RRFFQ69G5FAY')<>'pending'
 THEN RAISE EXCEPTION 'V473_ROLLBACK_DID_NOT_RESTORE_PENDING'; END IF;
END $$;
SELECT 'V473_PG17_ROLLBACK_AND_PENDING_ONLY_PASS';
SELECT 'V473_FINAL_RELEASE_NO_GO_HOLD_TRUE';

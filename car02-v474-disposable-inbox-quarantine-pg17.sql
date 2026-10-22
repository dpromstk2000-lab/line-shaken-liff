\set ON_ERROR_STOP on
-- CAR02 V4.74 isolated disposable PG17 ONLY. Requires synthetic V471 -> V472 -> V473 fixtures.
-- No real provider, business processing, LINE delivery, webhook ACK, or deployment.
CREATE SCHEMA v474_private;
REVOKE ALL ON SCHEMA v474_private FROM PUBLIC;
CREATE ROLE v474_quarantine_public NOLOGIN;
CREATE TABLE v474_private.qa_quarantines(
 event_id varchar(26) PRIMARY KEY REFERENCES v473_private.qa_leases(event_id),
 shop_code text NOT NULL,
 event_digest char(64) NOT NULL,
 worker_id text NOT NULL,
 lease_epoch bigint NOT NULL CHECK(lease_epoch>0),
 lease_token_hash char(64) NOT NULL,
 quarantine_reason text NOT NULL CHECK(quarantine_reason IN ('integrity_mismatch','poison_event','manual_hold','max_retry_review')),
 review_state text NOT NULL DEFAULT 'quarantined_review_only' CHECK(review_state='quarantined_review_only'),
 observed_at_ms bigint NOT NULL CHECK(observed_at_ms>0)
);
REVOKE ALL ON ALL TABLES IN SCHEMA v474_private FROM PUBLIC;
CREATE FUNCTION v474_private.qa_quarantine(p_shop text,p_event varchar,p_digest text,p_worker text,
 p_token text,p_epoch bigint,p_reason text,p_now bigint)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE v v473_private.qa_leases%ROWTYPE; existing v474_private.qa_quarantines%ROWTYPE;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[a-z0-9][a-z0-9_-]{1,63}$'
 OR p_event IS NULL OR p_event !~ '^[0-9A-HJKMNP-TV-Z]{26}$'
 OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
 OR p_worker IS NULL OR p_worker !~ '^worker_[a-z0-9]{1,32}$'
 OR p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$'
 OR p_epoch IS NULL OR p_epoch<1 OR p_reason IS NULL OR p_reason NOT IN ('integrity_mismatch','poison_event','manual_hold','max_retry_review')
 OR p_now IS NULL OR p_now<1 THEN RETURN 'invalid_disposable_request'; END IF;
 SELECT * INTO v FROM v473_private.qa_leases WHERE event_id=p_event FOR UPDATE;
 IF NOT FOUND THEN RETURN 'unknown_event_refused'; END IF;
 IF v.shop_code<>p_shop OR v.event_digest<>p_digest THEN RETURN 'collision_refused'; END IF;
 SELECT * INTO existing FROM v474_private.qa_quarantines WHERE event_id=p_event;
 IF FOUND THEN
  IF existing.shop_code=p_shop AND existing.event_digest=p_digest AND existing.worker_id=p_worker
   AND existing.lease_token_hash=p_token AND existing.lease_epoch=p_epoch AND existing.quarantine_reason=p_reason
   AND existing.review_state='quarantined_review_only' AND v.lease_state='review_only'
  THEN RETURN 'already_quarantined'; END IF;
  RETURN 'quarantine_conflict_refused';
 END IF;
 IF v.lease_state<>'leased' OR v.worker_id<>p_worker OR v.lease_token_hash<>p_token OR v.lease_epoch<>p_epoch
  OR p_now<v.lease_started_ms OR p_now>=v.lease_until_ms THEN RETURN 'stale_or_invalid_lease'; END IF;
 IF NOT EXISTS(SELECT 1 FROM v472_private.qa_inbox WHERE event_id=p_event AND shop_code=p_shop
  AND event_digest=p_digest AND receipt_state='pending') THEN RETURN 'pending_receipt_unverified'; END IF;
 INSERT INTO v474_private.qa_quarantines(event_id,shop_code,event_digest,worker_id,lease_epoch,lease_token_hash,quarantine_reason,observed_at_ms)
 VALUES(p_event,p_shop,p_digest,p_worker,p_epoch,p_token,p_reason,p_now);
 UPDATE v473_private.qa_leases SET lease_state='review_only' WHERE event_id=p_event;
 RETURN 'quarantined_mock';
END $$;
REVOKE ALL ON FUNCTION v474_private.qa_quarantine(text,varchar,text,text,text,bigint,text,bigint) FROM PUBLIC;
DO $$ BEGIN
 IF has_schema_privilege('v474_quarantine_public','v474_private','USAGE')
 OR has_table_privilege('v474_quarantine_public','v474_private.qa_quarantines','SELECT')
 OR has_table_privilege('v474_quarantine_public','v474_private.qa_quarantines','INSERT')
 OR has_function_privilege('v474_quarantine_public','v474_private.qa_quarantine(text,character varying,text,text,text,bigint,text,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'V474_PUBLIC_QUARANTINE_ACCESS_LEAK'; END IF;
END $$;
SELECT 'V474_PG17_PRIVATE_QUARANTINE_ROLES_FUNCTIONS_DENIED_PASS';
DO $$ BEGIN
 IF v473_private.qa_acquire('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),'worker_a',repeat('a',64),1800000000000,30000)<>'leased_mock'
 THEN RAISE EXCEPTION 'V474_EXPECTED_LEASE_MISSING'; END IF;
 IF v474_private.qa_quarantine('qa_shop_b','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),'worker_a',repeat('a',64),1,'manual_hold',1800000000001)<>'collision_refused'
 THEN RAISE EXCEPTION 'V474_CROSS_SHOP_ALLOWED'; END IF;
 IF v474_private.qa_quarantine('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('c',64),'worker_a',repeat('a',64),1,'manual_hold',1800000000001)<>'collision_refused'
 THEN RAISE EXCEPTION 'V474_WRONG_DIGEST_ALLOWED'; END IF;
 IF v474_private.qa_quarantine('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),'worker_a',repeat('a',64),2,'manual_hold',1800000000001)<>'stale_or_invalid_lease'
 THEN RAISE EXCEPTION 'V474_STALE_EPOCH_ALLOWED'; END IF;
 IF v474_private.qa_quarantine('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),'worker_b',repeat('a',64),1,'manual_hold',1800000000001)<>'stale_or_invalid_lease'
 THEN RAISE EXCEPTION 'V474_OTHER_WORKER_ALLOWED'; END IF;
 IF v474_private.qa_quarantine('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),'worker_a',repeat('a',64),1,'customer_phone_123',1800000000001)<>'invalid_disposable_request'
 THEN RAISE EXCEPTION 'V474_FREE_TEXT_REASON_ALLOWED'; END IF;
 IF v474_private.qa_quarantine('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),'worker_a',repeat('a',64),1,'manual_hold',1800000030000)<>'stale_or_invalid_lease'
 THEN RAISE EXCEPTION 'V474_EXPIRED_LEASE_ALLOWED'; END IF;
END $$;
SELECT 'V474_PG17_TENANT_DIGEST_STALE_LEASE_REASON_AND_EXPIRY_DENIED_PASS';
DO $$ BEGIN
 IF v474_private.qa_quarantine('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),'worker_a',repeat('a',64),1,'manual_hold',1800000000001)<>'quarantined_mock'
 THEN RAISE EXCEPTION 'V474_VALID_QUARANTINE_NOT_RECORDED'; END IF;
 IF v474_private.qa_quarantine('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),'worker_a',repeat('a',64),1,'manual_hold',1800000000001)<>'already_quarantined'
 THEN RAISE EXCEPTION 'V474_IDEMPOTENCY_MISSING'; END IF;
 IF v474_private.qa_quarantine('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),'worker_a',repeat('a',64),1,'poison_event',1800000000001)<>'quarantine_conflict_refused'
 THEN RAISE EXCEPTION 'V474_REASON_COLLISION_ALLOWED'; END IF;
 IF v474_private.qa_quarantine('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAY',repeat('b',64),'worker_a',repeat('d',64),1,'manual_hold',1800000000001)<>'quarantine_conflict_refused'
 THEN RAISE EXCEPTION 'V474_OTHER_TOKEN_ALLOWED'; END IF;
 IF (SELECT review_state FROM v474_private.qa_quarantines WHERE event_id='01ARZ3NDEKTSV4RRFFQ69G5FAY')<>'quarantined_review_only'
 THEN RAISE EXCEPTION 'V474_INCORRECT_QUARANTINE_STATE'; END IF;
 IF (SELECT receipt_state FROM v472_private.qa_inbox WHERE event_id='01ARZ3NDEKTSV4RRFFQ69G5FAY')<>'pending'
 THEN RAISE EXCEPTION 'V474_PENDING_RECEIPT_MUTATED'; END IF;
END $$;
SELECT 'V474_PG17_QUARANTINE_IDEMPOTENT_AND_PENDING_NOT_PROCESSED_PASS';
BEGIN;
DO $$ BEGIN
 IF v473_private.qa_acquire('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAZ',repeat('c',64),'worker_a',repeat('d',64),1800000000000,30000)<>'leased_mock'
 THEN RAISE EXCEPTION 'V474_ROLLBACK_LEASE_MISSING'; END IF;
 IF v474_private.qa_quarantine('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAZ',repeat('c',64),'worker_a',repeat('d',64),1,'manual_hold',1800000000001)<>'quarantined_mock'
 THEN RAISE EXCEPTION 'V474_ROLLBACK_QUARANTINE_MISSING'; END IF;
END $$;
ROLLBACK;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM v474_private.qa_quarantines WHERE event_id='01ARZ3NDEKTSV4RRFFQ69G5FAZ')
 OR (SELECT lease_state FROM v473_private.qa_leases WHERE event_id='01ARZ3NDEKTSV4RRFFQ69G5FAZ')<>'pending'
 THEN RAISE EXCEPTION 'V474_ROLLBACK_NOT_ATOMIC'; END IF;
END $$;
SELECT 'V474_PG17_ROLLBACK_RESTORES_PENDING_NO_DELIVERY_PASS';
DO $$ BEGIN
 IF v473_private.qa_acquire('qa_shop_a','01ARZ3NDEKTSV4RRFFQ69G5FAZ',repeat('c',64),'worker_a',repeat('d',64),1800000000000,30000)<>'leased_mock'
 THEN RAISE EXCEPTION 'V474_RACE_SETUP_FAILED'; END IF;
END $$;
SELECT 'V474_FINAL_RELEASE_NO_GO_HOLD_TRUE';

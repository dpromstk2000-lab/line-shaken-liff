-- DPRO CAR02 V4.70 disposable PostgreSQL17 test fixtures ONLY.
-- Never execute in shared/production Supabase. No real LINE endpoint or user ID.
CREATE SCHEMA v470_private;
REVOKE ALL ON SCHEMA v470_private FROM PUBLIC;
CREATE ROLE v470_readonly NOLOGIN;
CREATE TABLE v470_private.qa_attempts(
 shop_code text NOT NULL CHECK(shop_code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
 event_id uuid NOT NULL,
 retry_key uuid NOT NULL UNIQUE,
 endpoint text NOT NULL CHECK(endpoint IN ('push','multicast','narrowcast','broadcast')),
 recipient_sha256 text NOT NULL CHECK(recipient_sha256 ~ '^[a-f0-9]{64}$'),
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),
 issued_at_ms bigint NOT NULL CHECK(issued_at_ms > 0),
 PRIMARY KEY(shop_code,event_id)
);
REVOKE ALL ON v470_private.qa_attempts FROM PUBLIC;
INSERT INTO v470_private.qa_attempts VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004701','00000000-0000-0000-0000-000000004703',
  'push',repeat('a',64),repeat('b',64),1799999900000),
 ('qa_shop_b','00000000-0000-0000-0000-000000004711','00000000-0000-0000-0000-000000004713',
  'multicast',repeat('c',64),repeat('d',64),1799999900000);
CREATE FUNCTION v470_private.qa_read_retry_review(
 p_shop text,p_event uuid,p_retry uuid,p_recipient text,p_body text,p_now_ms bigint
) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER
 SET search_path = pg_catalog, v470_private
AS $$
 SELECT CASE
  WHEN p_shop IS NULL OR p_event IS NULL OR p_retry IS NULL OR p_recipient IS NULL OR p_body IS NULL OR p_now_ms IS NULL
   THEN 'untrusted_input'
  WHEN NOT EXISTS (SELECT 1 FROM qa_attempts a WHERE a.shop_code=p_shop AND a.event_id=p_event
    AND a.retry_key=p_retry AND a.recipient_sha256=p_recipient AND a.body_sha256=p_body)
   THEN 'source_mismatch_or_wrong_tenant'
  WHEN EXISTS (SELECT 1 FROM qa_attempts a WHERE a.shop_code=p_shop AND a.event_id=p_event
    AND (p_now_ms < a.issued_at_ms OR p_now_ms - a.issued_at_ms >= 86400000))
   THEN 'expired_or_reversed_clock'
  ELSE 'manual_review_candidate_only'
 END;
$$;
REVOKE ALL ON FUNCTION v470_private.qa_read_retry_review(text,uuid,uuid,text,text,bigint) FROM PUBLIC;
DO $$ BEGIN
 IF has_schema_privilege('v470_readonly','v470_private','USAGE') OR
   has_table_privilege('v470_readonly','v470_private.qa_attempts','SELECT') OR
   has_function_privilege('v470_readonly','v470_private.qa_read_retry_review(text,uuid,uuid,text,text,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'V470 ROLE GRANT LEAK'; END IF;
END $$;
SELECT 'V470_PG17_PRIVATE_ROLE_AND_FUNCTION_DENY_PASS';
DO $$DECLARE r text; BEGIN
 SELECT v470_private.qa_read_retry_review('qa_shop_a',
  '00000000-0000-0000-0000-000000004701','00000000-0000-0000-0000-000000004703',
  repeat('a',64),repeat('b',64),1800000000000) INTO r;
 IF r <> 'manual_review_candidate_only' THEN RAISE EXCEPTION 'V470 VALID FIXTURE REVIEW FAILED: %',r; END IF;
 SELECT v470_private.qa_read_retry_review('qa_shop_b',
  '00000000-0000-0000-0000-000000004701','00000000-0000-0000-0000-000000004703',
  repeat('a',64),repeat('b',64),1800000000000) INTO r;
 IF r <> 'source_mismatch_or_wrong_tenant' THEN RAISE EXCEPTION 'V470 CROSS TENANT LEAK'; END IF;
 SELECT v470_private.qa_read_retry_review('qa_shop_a',
  '00000000-0000-0000-0000-000000004701','00000000-0000-0000-0000-000000004703',
  repeat('e',64),repeat('b',64),1800000000000) INTO r;
 IF r <> 'source_mismatch_or_wrong_tenant' THEN RAISE EXCEPTION 'V470 TARGET ALTER ACCEPTED'; END IF;
 SELECT v470_private.qa_read_retry_review('qa_shop_a',
  '00000000-0000-0000-0000-000000004701','00000000-0000-0000-0000-000000004703',
  repeat('a',64),repeat('f',64),1800000000000) INTO r;
 IF r <> 'source_mismatch_or_wrong_tenant' THEN RAISE EXCEPTION 'V470 PAYLOAD ALTER ACCEPTED'; END IF;
END $$;
SELECT 'V470_PG17_TENANT_RECIPIENT_AND_PAYLOAD_BOUND_REVIEW_PASS';
DO $$ DECLARE r text; BEGIN
 SELECT v470_private.qa_read_retry_review('qa_shop_a',
  '00000000-0000-0000-0000-000000004701','00000000-0000-0000-0000-000000004703',
  repeat('a',64),repeat('b',64),1799999900000 + 86400000) INTO r;
 IF r <> 'expired_or_reversed_clock' THEN RAISE EXCEPTION 'V470 24H BOUNDARY FAIL';END IF;
 SELECT v470_private.qa_read_retry_review('qa_shop_a',
  '00000000-0000-0000-0000-000000004701','00000000-0000-0000-0000-000000004703',
  repeat('a',64),repeat('b',64),1799999899999) INTO r;
 IF r <> 'expired_or_reversed_clock' THEN RAISE EXCEPTION 'V470 TIME ROLLBACK FAIL';END IF;
END $$;
SELECT 'V470_PG17_RETRY_24H_EXPIRY_AND_CLOCK_ROLLBACK_DENY_PASS';
DO $$ BEGIN
 BEGIN
  INSERT INTO v470_private.qa_attempts VALUES('qa_shop_x','00000000-0000-0000-0000-000000004799',
   '00000000-0000-0000-0000-000000004703','push',repeat('a',64),repeat('b',64),1799999900000);
  RAISE EXCEPTION 'V470 REUSED RETRY KEY WAS ALLOWED';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 IF (SELECT count(*) FROM v470_private.qa_attempts)<>2 THEN RAISE EXCEPTION 'V470 DUPLICATE INSERT CHANGED ROW COUNT'; END IF;
END $$;
SELECT 'V470_PG17_GLOBAL_RETRY_KEY_UNIQUE_CROSS_SHOP_PASS';
DO $$ BEGIN
 IF (SELECT count(*) FROM v470_private.qa_attempts)<>2 THEN RAISE EXCEPTION 'V470 FIXTURE CHANGED';END IF;
 IF EXISTS(SELECT 1 FROM v470_private.qa_attempts WHERE endpoint='reply') THEN RAISE EXCEPTION 'V470 REPLY ENDPOINT INCLUDED';END IF;
END $$;
SELECT 'V470_FINAL_RELEASE_NO_GO_HOLD_TRUE';

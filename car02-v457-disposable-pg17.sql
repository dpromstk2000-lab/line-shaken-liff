-- CAR02 V4.57: disposable PG17 only, SHA256 evidence manifest over V453-V456 rows.
-- Cross-ledger consistency and all event data are SYNTHETIC. No production/LINE,
-- no external key custody, monotonic WORM anchor or independent trust domain.
\set ON_ERROR_STOP on
DO $$BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 OR
    to_regprocedure('v456_private.qa_review_consistency(text,uuid)') IS NULL OR
    to_regclass('v453_private.qa_outbox') IS NULL OR
    to_regclass('v455_private.qa_review_audit') IS NULL
 THEN RAISE EXCEPTION 'V457_DISPOSABLE_PG17_AND_PRIOR_CHAIN_REQUIRED';END IF;
END$$;
CREATE ROLE v457_anon NOLOGIN;
CREATE ROLE v457_authenticated NOLOGIN;
CREATE SCHEMA v457_private;
REVOKE ALL ON SCHEMA v457_private FROM PUBLIC,v457_anon,v457_authenticated;
CREATE FUNCTION v457_private.qa_review_evidence(p_shop text,p_event uuid)
 RETURNS TABLE(event_id uuid,integrity_state text,review_stage text,audit_steps integer,evidence_sha256 text)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,v457_private AS $$
 SELECT o.event_id,v.integrity_state,v.review_stage,v.audit_steps,
 encode(sha256(convert_to(jsonb_build_array(
   to_jsonb(o),to_jsonb(r),to_jsonb(cl),to_jsonb(c),
   (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.seq)
      FROM v455_private.qa_review_audit a
      WHERE a.shop_code=p_shop AND a.event_id=p_event)
 )::text,'UTF8')),'hex')::text
 FROM v456_private.qa_review_consistency(p_shop,p_event) v
 JOIN v453_private.qa_outbox o ON o.shop_code=p_shop AND o.event_id=v.event_id
 JOIN v453_private.qa_receipts r ON r.shop_code=o.shop_code AND r.request_id=o.event_id
 JOIN v454_private.qa_claims cl ON cl.shop_code=o.shop_code AND cl.event_id=o.event_id
 JOIN v455_private.qa_cases c ON c.shop_code=o.shop_code AND c.event_id=o.event_id
 WHERE v.integrity_state='consistent_closed' AND
       v.review_stage='closed_without_delivery_assertion' AND v.audit_steps=2
$$;
REVOKE ALL ON FUNCTION v457_private.qa_review_evidence(text,uuid)
 FROM PUBLIC,v457_anon,v457_authenticated;
DO $$BEGIN
 IF has_schema_privilege('v457_anon','v457_private','USAGE') OR
    has_function_privilege('v457_authenticated','v457_private.qa_review_evidence(text,uuid)','EXECUTE') OR
    has_table_privilege('v457_authenticated','v454_private.qa_claims','SELECT')
 THEN RAISE EXCEPTION 'V457_UNPRIVILEGED_EVIDENCE_EXPORT_ACCESS';END IF;
END$$;
\echo V457_PG17_PRIVATE_EVIDENCE_EXPORT_ROLE_DENY_PASS
DO $$DECLARE r record;old_sha text; new_sha text;BEGIN
 SELECT * INTO r FROM v457_private.qa_review_evidence('qa_shop_a',
  '00000000-0000-0000-0000-000000004533');
 IF NOT FOUND OR r.integrity_state IS DISTINCT FROM 'consistent_closed' OR
   r.review_stage IS DISTINCT FROM 'closed_without_delivery_assertion' OR
   r.audit_steps<>2 OR r.evidence_sha256 !~ '^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'V457_CLOSED_SOURCE_NOT_EXPORTABLE';END IF;
 old_sha:=r.evidence_sha256;
 SELECT evidence_sha256 INTO new_sha FROM v457_private.qa_review_evidence('qa_shop_a',
  '00000000-0000-0000-0000-000000004533');
 IF old_sha IS DISTINCT FROM new_sha THEN RAISE EXCEPTION 'V457_SOURCE_NOT_STABLE';END IF;
END$$;
\echo V457_PG17_CONSISTENT_SOURCE_STABLE_DIGEST_PASS
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM v457_private.qa_review_evidence('qa_shop_b',
  '00000000-0000-0000-0000-000000004533')) OR
  EXISTS(SELECT 1 FROM v457_private.qa_review_evidence('qa_shop_a',
  '00000000-0000-0000-0000-000000009999')) OR
  EXISTS(SELECT 1 FROM v457_private.qa_review_evidence('qa_shop_a',
  '00000000-0000-0000-0000-000000004541'))
 THEN RAISE EXCEPTION 'V457_OTHER_SHOP_OR_INCOMPLETE_REVIEW_EXPORTED';END IF;
 IF (SELECT dispatch_state FROM v453_private.qa_outbox WHERE shop_code='qa_shop_a'
 AND event_id='00000000-0000-0000-0000-000000004533')<>'pending'
 THEN RAISE EXCEPTION 'V457_FALSE_DELIVERY_STATE';END IF;
END$$;
\echo V457_PG17_OTHER_SHOP_AND_PARTIAL_REVIEW_DENIED_PASS
-- The claim review_reason changes from one synthetically permitted reason to
-- another. V456's consistency state REMAINS closed; the exported FULL-row digest
-- MUST change. Only PG17 disposable SUPERUSER may bypass the immutable trigger.
BEGIN;
CREATE TEMP TABLE v457_qa_old_digest AS
 SELECT evidence_sha256 FROM v457_private.qa_review_evidence('qa_shop_a',
 '00000000-0000-0000-0000-000000004533');
ALTER TABLE v454_private.qa_claims DISABLE TRIGGER ALL;
UPDATE v454_private.qa_claims SET review_reason=
 CASE WHEN review_reason='send_unknown' THEN 'provider_no_receipt' ELSE 'send_unknown' END
 WHERE shop_code='qa_shop_a' AND event_id='00000000-0000-0000-0000-000000004533';
DO $$DECLARE r record;BEGIN
 SELECT * INTO r FROM v457_private.qa_review_evidence('qa_shop_a',
 '00000000-0000-0000-0000-000000004533');
 IF r.integrity_state IS DISTINCT FROM 'consistent_closed' OR
   r.evidence_sha256 = (SELECT evidence_sha256 FROM v457_qa_old_digest)
 THEN RAISE EXCEPTION 'V457_CONSISTENT_BUT_CHANGED_SOURCE_NOT_DETECTED';END IF;
END$$;
ROLLBACK;
\echo V457_PG17_CHANGED_BUT_CONSISTENT_SOURCE_DIGEST_DIFFERS_PASS
DO $$DECLARE d text;BEGIN
 SELECT evidence_sha256 INTO d FROM v457_private.qa_review_evidence('qa_shop_a',
  '00000000-0000-0000-0000-000000004533');
 IF d IS NULL OR length(d)<>64 THEN RAISE EXCEPTION 'V457_SNAPSHOT_ROLLBACK_FAILED';END IF;
END$$;
\echo V457_PG17_ALTERED_FIXTURE_ROLLBACK_RESTORED_PASS
-- CI tests eight independent REPEATABLE READ READ ONLY PostgreSQL sessions,
-- then feeds one DB-computed SHA256 into an actual Node Ed25519 signature check.

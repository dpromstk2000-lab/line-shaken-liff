-- DPRO CAR02 R93D. DISPOSABLE PostgreSQL 17 QA DATABASE ONLY.
-- Not a Supabase migration. NEVER run on liff-salon-reserve / any customer or production DB.
-- NO PUBLIC schema changes, no production table references, no real Storage or Worker access.
-- Intended invocation: docker exec QA postgres:17 container (database postgres).
BEGIN;
CREATE SCHEMA car02_r93d_qa;
REVOKE ALL ON SCHEMA car02_r93d_qa FROM PUBLIC;
CREATE TABLE car02_r93d_qa.cleanup_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 shop_code text NOT NULL CHECK (shop_code ~ '^[a-z][a-z0-9_]{2,63}$'),
 photo_id uuid NOT NULL,
 order_id uuid NOT NULL,
 report_id uuid NOT NULL,
 storage_bucket text NOT NULL DEFAULT 'ksh-car02-private-photos' CHECK (storage_bucket='ksh-car02-private-photos'),
 storage_path text NOT NULL,
 photo_state text NOT NULL CHECK (photo_state='deleted'),
 photo_created_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','leased','verified','escalated')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
 run_after timestamptz NOT NULL DEFAULT now(),
 lease_id uuid,
 lease_expires timestamptz,
 last_reason text NOT NULL DEFAULT '' CHECK (length(last_reason)<=120),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(shop_code,photo_id),
 CHECK (storage_path = shop_code || '/' || order_id::text || '/' || report_id::text || '/' ||
   split_part(storage_path, '/', 4)),
 CHECK (storage_path ~ '^[a-z][a-z0-9_]{2,63}/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|png|webp)$'),
 CHECK ((state='leased' AND lease_id IS NOT NULL AND lease_expires IS NOT NULL) OR
        (state<>'leased' AND lease_id IS NULL AND lease_expires IS NULL))
);
CREATE INDEX cleanup_due_idx ON car02_r93d_qa.cleanup_jobs (run_after,created_at)
 WHERE state IN ('queued','leased');
ALTER TABLE car02_r93d_qa.cleanup_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON car02_r93d_qa.cleanup_jobs FROM PUBLIC;

-- Atomic lease claims. This function must be called by a scoped, authorized
-- server-side adapter; it is not sufficient for a production implementation.
CREATE FUNCTION car02_r93d_qa.claim_one(p_now timestamptz)
RETURNS TABLE (job_id uuid, lease_token uuid, attempts_before integer)
LANGUAGE sql AS $$
 WITH picked AS (
  SELECT id FROM car02_r93d_qa.cleanup_jobs
  WHERE (state='queued' AND run_after<=p_now)
     OR (state='leased' AND lease_expires<=p_now)
  ORDER BY run_after,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
 ), changed AS (
  UPDATE car02_r93d_qa.cleanup_jobs j
  SET state='leased',lease_id=gen_random_uuid(),lease_expires=p_now+interval '30 seconds',updated_at=p_now
  FROM picked WHERE j.id=picked.id
  RETURNING j.id,j.lease_id,j.attempts
 ) SELECT id,lease_id,attempts FROM changed
$$;

-- All mutations require matching ephemeral lease token. This template intentionally
-- DOES NOT handle actual storage probes or securely authorize shop ownership.
CREATE FUNCTION car02_r93d_qa.defer_one(p_job uuid,p_lease uuid,p_now timestamptz,
 p_run_after timestamptz,p_reason text)
RETURNS boolean LANGUAGE sql AS $$
 WITH changed AS (
 UPDATE car02_r93d_qa.cleanup_jobs
 SET state='queued',attempts=attempts+1,run_after=p_run_after,lease_id=NULL,
     lease_expires=NULL,last_reason=p_reason,updated_at=p_now
 WHERE id=p_job AND lease_id=p_lease AND state='leased' AND lease_expires>p_now
  AND attempts<8 AND p_run_after>p_now AND p_run_after<=p_now+interval '24 hours'
  AND length(p_reason) BETWEEN 1 AND 120
 RETURNING id
 ) SELECT EXISTS(SELECT 1 FROM changed)
$$;
CREATE FUNCTION car02_r93d_qa.finish_one(p_job uuid,p_lease uuid,p_now timestamptz,
 p_state text,p_reason text)
RETURNS boolean LANGUAGE sql AS $$
 WITH changed AS (
 UPDATE car02_r93d_qa.cleanup_jobs
 SET state=p_state,lease_id=NULL,lease_expires=NULL,last_reason=p_reason,updated_at=p_now
 WHERE id=p_job AND lease_id=p_lease AND state='leased' AND lease_expires>p_now
 AND p_state IN ('verified','escalated') AND length(p_reason) BETWEEN 1 AND 120
 RETURNING id
 ) SELECT EXISTS(SELECT 1 FROM changed)
$$;
-- NOTE: finish_one(verified) requires an external authenticated 404 absence probe.
-- QA-only; the function itself does not prove object absence and MUST NOT be deployed.
REVOKE ALL ON FUNCTION car02_r93d_qa.claim_one(timestamptz),
 car02_r93d_qa.defer_one(uuid,uuid,timestamptz,timestamptz,text),
 car02_r93d_qa.finish_one(uuid,uuid,timestamptz,text,text) FROM PUBLIC;
COMMIT;

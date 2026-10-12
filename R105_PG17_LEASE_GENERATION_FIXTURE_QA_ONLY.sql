-- DPRO CAR02 R105: ephemeral PostgreSQL 17 ONLY. NEVER run in Supabase or a real studio DB.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'car02_r93q_qa_ci'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR to_regclass('public.ksh_car02_photos') IS NOT NULL
 OR to_regclass('car02_r93q_qa.cleanup_jobs') IS NULL
 OR to_regclass('car02_r93q_qa.r103_cleanup_receipts') IS NULL
 OR to_regclass('car02_r93q_qa.r105_generation_claims') IS NOT NULL
 THEN RAISE EXCEPTION 'R105_DISPOSABLE_PG17_ONLY'; END IF;
END $$;
CREATE TABLE car02_r93q_qa.r105_generation_claims (
 job_id uuid PRIMARY KEY REFERENCES car02_r93q_qa.cleanup_jobs(job_id),
 shop_code text NOT NULL,
 photo_id uuid NOT NULL,
 storage_path text NOT NULL,
 generation bigint NOT NULL CHECK(generation BETWEEN 1 AND 1000000),
 token uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('claimed','retry','done')),
 lease_until timestamptz,
 completed_at timestamptz,
 storage_proof text CHECK(storage_proof IN ('deleted','missing')),
 CHECK ((state='claimed' AND lease_until IS NOT NULL AND completed_at IS NULL AND storage_proof IS NULL)
  OR (state='retry' AND lease_until IS NULL AND completed_at IS NULL AND storage_proof IS NULL)
  OR (state='done' AND lease_until IS NULL AND completed_at IS NOT NULL AND storage_proof IS NOT NULL))
);
REVOKE ALL ON car02_r93q_qa.r105_generation_claims FROM PUBLIC;
COMMIT;
\echo R105_DISPOSABLE_GENERATION_FIXTURE_READY

-- CAR02 R103 DISPOSABLE PG17 ONLY. NEVER RUN IN SUPABASE OR ANY EXISTING DATABASE.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'car02_r93q_qa_ci'
 OR current_setting('server_version_num')::int < 170000
 OR current_setting('server_version_num')::int >= 180000
 OR to_regclass('public.ksh_car02_photos') IS NOT NULL
 OR to_regclass('car02_r93q_qa.photos') IS NULL
 OR to_regclass('car02_r93q_qa.upload_intents') IS NULL
 OR to_regclass('car02_r93q_qa.cleanup_jobs') IS NULL
 OR to_regclass('car02_r93q_qa.r103_cleanup_receipts') IS NOT NULL
 THEN RAISE EXCEPTION 'R103_DISPOSABLE_PG17_ONLY'; END IF;
END $$;
CREATE TABLE car02_r93q_qa.r103_cleanup_receipts (
 job_id uuid PRIMARY KEY REFERENCES car02_r93q_qa.cleanup_jobs(job_id),
 shop_code text NOT NULL,
 photo_id uuid NOT NULL,
 storage_path text NOT NULL,
 state text NOT NULL CHECK (state IN ('claimed','retry','done')),
 lease_token uuid NOT NULL,
 lease_until timestamptz NULL,
 attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 5),
 completed_at timestamptz NULL,
 CHECK ((state='claimed' AND lease_until IS NOT NULL AND completed_at IS NULL)
   OR (state='retry' AND lease_until IS NULL AND completed_at IS NULL)
   OR (state='done' AND lease_until IS NULL AND completed_at IS NOT NULL))
);
REVOKE ALL ON car02_r93q_qa.r103_cleanup_receipts FROM PUBLIC;
COMMIT;
\echo R103_DISPOSABLE_RECEIPTS_READY

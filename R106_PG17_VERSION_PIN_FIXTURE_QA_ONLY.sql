-- DPRO CAR02 R106: in-memory Storage version pin fixture ONLY. DO NOT execute on Supabase.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'car02_r93q_qa_ci'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR to_regclass('public.ksh_car02_photos') IS NOT NULL
 OR to_regclass('car02_r93q_qa.r105_generation_claims') IS NULL
 OR to_regclass('car02_r93q_qa.r106_object_pins') IS NOT NULL
 THEN RAISE EXCEPTION 'R106_DISPOSABLE_PG17_ONLY'; END IF;
END $$;
CREATE TABLE car02_r93q_qa.r106_object_pins (
 job_id uuid PRIMARY KEY REFERENCES car02_r93q_qa.cleanup_jobs(job_id),
 shop_code text NOT NULL,
 photo_id uuid NOT NULL,
 storage_path text NOT NULL,
 bucket text NOT NULL CHECK(bucket='ksh-car02-private-photos'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 object_version text NOT NULL CHECK(object_version ~ '^v[0-9]{3,9}$')
);
REVOKE ALL ON car02_r93q_qa.r106_object_pins FROM PUBLIC;
COMMIT;
\echo R106_DISPOSABLE_VERSION_PIN_SCHEMA_PASS

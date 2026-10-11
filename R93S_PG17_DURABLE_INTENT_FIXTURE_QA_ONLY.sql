-- R93S, CI ONLY: execute after R93R fixture in disposable PostgreSQL 17.
-- Never run this against Supabase or an existing database.
\set ON_ERROR_STOP on
DO $$BEGIN
 IF current_database()<>'car02_r93q_qa_ci' OR current_setting('server_version_num')::int<170000 OR
   to_regnamespace('car02_r93q_qa') IS NULL OR
   to_regclass('public.ksh_car02_photos') IS NOT NULL OR
   to_regclass('car02_r93q_qa.upload_intents') IS NOT NULL THEN
   RAISE EXCEPTION 'R93S_QA_ONLY'; END IF;
END $$;
CREATE TABLE car02_r93q_qa.upload_intents (
 shop_code text NOT NULL,
 intent_key uuid NOT NULL,
 photo_id uuid NOT NULL REFERENCES car02_r93q_qa.photos(id),
 order_id uuid NOT NULL,
 report_id uuid NOT NULL,
 staff_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('staff','owner')),
 storage_bucket text NOT NULL CHECK(storage_bucket='ksh-car02-private-photos'),
 storage_path text NOT NULL,
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
 byte_size bigint NOT NULL CHECK(byte_size BETWEEN 4 AND 5242880),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(shop_code,intent_key), UNIQUE(photo_id)
);
REVOKE ALL ON car02_r93q_qa.upload_intents FROM PUBLIC;
-- An accepted idempotency receipt is immutable. No rewrite of ownership/path.
CREATE FUNCTION car02_r93q_qa.r93s_intent_immutable() RETURNS trigger
 LANGUAGE plpgsql SET search_path=car02_r93q_qa,pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'R93S_INTENT_IMMUTABLE' USING ERRCODE='23514';
END $$;
CREATE TRIGGER r93s_intent_immutable BEFORE UPDATE OR DELETE
 ON car02_r93q_qa.upload_intents
 FOR EACH ROW EXECUTE FUNCTION car02_r93q_qa.r93s_intent_immutable();
REVOKE ALL ON FUNCTION car02_r93q_qa.r93s_intent_immutable() FROM PUBLIC;
DO $$BEGIN
 IF (SELECT count(*) FROM pg_constraint
  WHERE conrelid='car02_r93q_qa.upload_intents'::regclass AND contype='p')<>1
 THEN RAISE EXCEPTION 'R93S_INTENT_UNIQUE_MISSING'; END IF;
END $$;
\echo R93S_DISPOSABLE_DURABLE_INTENT_SCHEMA_READY

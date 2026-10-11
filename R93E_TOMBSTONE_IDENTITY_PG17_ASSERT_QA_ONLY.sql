-- DPRO CAR02 R93E: PostgreSQL 17 disposable QA only. NEVER run on live Supabase.
-- Run AFTER the R93D QA schema in the ephemeral postgres:17 service.
-- All R93E test rows and assertions are rolled back; no release or production change.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR to_regclass('car02_r93d_qa.cleanup_jobs') IS NULL
 THEN RAISE EXCEPTION 'R93E_DISPOSABLE_POSTGRES_REQUIRED'; END IF;
END $$;
CREATE TEMP TABLE r93e_photo_rows (
 id uuid PRIMARY KEY,shop_code text NOT NULL,order_id uuid NOT NULL,report_id uuid NOT NULL,
 storage_bucket text NOT NULL,storage_path text NOT NULL,upload_state text NOT NULL,
 created_at timestamptz NOT NULL
);
INSERT INTO r93e_photo_rows VALUES
('44444444-4444-4444-8444-444444444444', 'street_house_kitsuki',
 '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
 'ksh-car02-private-photos',
 'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.jpg',
 'deleted',now()-interval '2 hours'),
('88888888-8888-4888-8888-888888888888', 'street_house_kitsuki',
 '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
 'ksh-car02-private-photos',
 'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/99999999-9999-4999-8999-999999999999.jpg',
 'deleted',now()-interval '2 hours');
INSERT INTO car02_r93d_qa.cleanup_jobs
 (shop_code,photo_id,order_id,report_id,storage_path,photo_state,photo_created_at,run_after)
 SELECT shop_code,id,order_id,report_id,storage_path,upload_state,created_at,now()-interval '1 min'
 FROM r93e_photo_rows WHERE id='44444444-4444-4444-8444-444444444444';
CREATE TEMP TABLE r93e_claim AS SELECT * FROM car02_r93d_qa.claim_one(now());
-- These are demonstration queries for the necessary secure database adapter contract.
-- The product SQL currently does NOT implement production tombstone authorization.
CREATE TEMP VIEW r93e_authorized AS
 SELECT j.id AS job_id,j.lease_id,r.id AS photo_id
 FROM car02_r93d_qa.cleanup_jobs j JOIN r93e_photo_rows r
   ON r.id=j.photo_id AND r.shop_code=j.shop_code
   AND r.order_id=j.order_id AND r.report_id=j.report_id
   AND r.storage_bucket=j.storage_bucket AND r.storage_path=j.storage_path
   AND r.upload_state='deleted' AND j.photo_state='deleted'
   AND r.created_at=j.photo_created_at
 WHERE j.state='leased' AND j.lease_id IS NOT NULL AND j.lease_expires>now()
   AND j.storage_bucket='ksh-car02-private-photos';
DO $$ DECLARE n int; BEGIN
 SELECT count(*) INTO n FROM r93e_authorized;
 IF n<>1 THEN RAISE EXCEPTION 'R93E_VALID_TUPLE_REJECTED'; END IF;
 -- The blob UUID (777...) legitimately differs from the photo-row UUID (444...).
 IF EXISTS(SELECT 1 FROM r93e_photo_rows WHERE id='44444444-4444-4444-8444-444444444444'
   AND storage_path LIKE '%/44444444-4444-4444-8444-444444444444.jpg') THEN
   RAISE EXCEPTION 'R93E_WRONG_BLOB_ID_ASSUMPTION'; END IF;
END $$;
UPDATE r93e_photo_rows SET storage_path=(SELECT storage_path FROM r93e_photo_rows
 WHERE id='88888888-8888-4888-8888-888888888888')
 WHERE id='44444444-4444-4444-8444-444444444444';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM r93e_authorized) THEN
 RAISE EXCEPTION 'R93E_SAME_REPORT_SWAPPED_PHOTO_WAS_AUTHORIZED';END IF;END $$;
UPDATE r93e_photo_rows SET storage_path='street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.jpg'
 WHERE id='44444444-4444-4444-8444-444444444444';
UPDATE r93e_photo_rows SET upload_state='ready' WHERE id='44444444-4444-4444-8444-444444444444';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM r93e_authorized) THEN
 RAISE EXCEPTION 'R93E_READY_PHOTO_WAS_AUTHORIZED';END IF;END $$;
UPDATE r93e_photo_rows SET upload_state='deleted' WHERE id='44444444-4444-4444-8444-444444444444';
UPDATE car02_r93d_qa.cleanup_jobs SET lease_expires=now()-interval '1 sec'
 WHERE photo_id='44444444-4444-4444-8444-444444444444';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM r93e_authorized) THEN
 RAISE EXCEPTION 'R93E_EXPIRED_LEASE_WAS_AUTHORIZED';END IF;END $$;
ROLLBACK;
\echo R93E_PG17_IDENTITY_BINDING_QA_PASS

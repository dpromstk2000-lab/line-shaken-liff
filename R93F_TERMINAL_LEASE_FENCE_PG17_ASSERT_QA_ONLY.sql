-- DPRO CAR02 R93F — DISPOSABLE PostgreSQL 17 QA ONLY, not a Supabase migration.
-- Execute AFTER R93D_DURABLE_CLEANUP_OUTBOX_QA_ONLY.sql in a temporary postgres:17 service.
-- Conditional SQL below demonstrates the atomic lease/photo identity requirement.
-- A boolean p_confirmed_404 is NOT cryptographic proof. In production this signal must
-- come only from a trusted private Storage probe, never a client, JWT, or web request.
-- This entire script is rolled back and MUST NOT be deployed to the shared DB.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'postgres' OR to_regclass('car02_r93d_qa.cleanup_jobs') IS NULL
 THEN RAISE EXCEPTION 'R93F_EPHEMERAL_POSTGRES_REQUIRED'; END IF;
END $$;
CREATE TEMP TABLE r93f_photo_records (
 id uuid PRIMARY KEY, shop_code text NOT NULL, order_id uuid NOT NULL, report_id uuid NOT NULL,
 storage_bucket text NOT NULL, storage_path text NOT NULL, upload_state text NOT NULL,
 created_at timestamptz NOT NULL
) ON COMMIT DROP;
INSERT INTO r93f_photo_records VALUES
('44444444-4444-4444-8444-444444444444', 'street_house_kitsuki',
 '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
 'ksh-car02-private-photos',
 'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.jpg',
 'deleted', '2026-10-11T06:00:00Z'),
('88888888-8888-4888-8888-888888888888', 'street_house_kitsuki',
 '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
 'ksh-car02-private-photos',
 'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/99999999-9999-4999-8999-999999999999.jpg',
 'ready', '2026-10-11T06:00:00Z');
INSERT INTO car02_r93d_qa.cleanup_jobs
(shop_code,photo_id,order_id,report_id,storage_path,photo_state,photo_created_at,run_after)
SELECT shop_code,id,order_id,report_id,storage_path,upload_state,created_at,now()-interval '1 minute'
FROM r93f_photo_records WHERE id='44444444-4444-4444-8444-444444444444';
CREATE TEMP TABLE r93f_claim AS SELECT * FROM car02_r93d_qa.claim_one(now());

-- Inside a real DB adapter, the UPDATE must recheck all row predicates in ONE transaction.
-- This scoped function is defined and discarded in the test transaction only.
CREATE FUNCTION car02_r93d_qa.r93f_finish_verified(
 p_job uuid, p_lease uuid, p_shop text, p_photo uuid, p_path text,
 p_now timestamptz, p_confirmed_404 boolean
) RETURNS boolean LANGUAGE sql AS $$
 WITH changed AS (
   UPDATE car02_r93d_qa.cleanup_jobs j
   SET state='verified', lease_id=NULL, lease_expires=NULL,
       last_reason='PRIVATE_OBJECT_PROBE_404', updated_at=p_now
   FROM pg_temp.r93f_photo_records p
   WHERE p_confirmed_404 IS TRUE
     AND j.id=p_job AND j.lease_id=p_lease AND j.shop_code=p_shop
     AND j.photo_id=p_photo AND j.storage_path=p_path
     AND j.state='leased' AND j.lease_expires>p_now
     AND j.storage_bucket='ksh-car02-private-photos' AND j.photo_state='deleted'
     AND p.id=j.photo_id AND p.shop_code=j.shop_code
     AND p.order_id=j.order_id AND p.report_id=j.report_id
     AND p.storage_bucket=j.storage_bucket AND p.storage_path=j.storage_path
     AND p.upload_state='deleted' AND p.created_at=j.photo_created_at
   RETURNING j.id
 ) SELECT EXISTS(SELECT 1 FROM changed)
$$;
REVOKE ALL ON FUNCTION car02_r93d_qa.r93f_finish_verified(uuid,uuid,text,uuid,text,timestamptz,boolean) FROM PUBLIC;
DO $$
DECLARE
 j uuid; l uuid; p text; okay boolean;
BEGIN
 SELECT job_id,lease_token INTO STRICT j,l FROM r93f_claim;
 SELECT storage_path INTO STRICT p FROM r93f_photo_records WHERE id='44444444-4444-4444-8444-444444444444';
 SELECT car02_r93d_qa.r93f_finish_verified(j,l,'street_house_kitsuki','44444444-4444-4444-8444-444444444444',p,now(),false) INTO okay;
 IF okay THEN RAISE EXCEPTION 'R93F_FORGED_PROBE_ACCEPTED'; END IF;
 SELECT car02_r93d_qa.r93f_finish_verified(j,l,'other_shop','44444444-4444-4444-8444-444444444444',p,now(),true) INTO okay;
 IF okay THEN RAISE EXCEPTION 'R93F_OTHER_SHOP_ACCEPTED'; END IF;
 SELECT car02_r93d_qa.r93f_finish_verified(j,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','street_house_kitsuki','44444444-4444-4444-8444-444444444444',p,now(),true) INTO okay;
 IF okay THEN RAISE EXCEPTION 'R93F_FORGED_LEASE_ACCEPTED'; END IF;
 SELECT car02_r93d_qa.r93f_finish_verified(j,l,'street_house_kitsuki','88888888-8888-4888-8888-888888888888',p,now(),true) INTO okay;
 IF okay THEN RAISE EXCEPTION 'R93F_OTHER_PHOTO_ACCEPTED'; END IF;
 SELECT car02_r93d_qa.r93f_finish_verified(j,l,'street_house_kitsuki','44444444-4444-4444-8444-444444444444',
  replace(p,'77777777','99999999'),now(),true) INTO okay;
 IF okay THEN RAISE EXCEPTION 'R93F_SWAPPED_BLOB_ACCEPTED'; END IF;
 UPDATE r93f_photo_records SET upload_state='ready' WHERE id='44444444-4444-4444-8444-444444444444';
 SELECT car02_r93d_qa.r93f_finish_verified(j,l,'street_house_kitsuki','44444444-4444-4444-8444-444444444444',p,now(),true) INTO okay;
 IF okay THEN RAISE EXCEPTION 'R93F_READY_PHOTO_ACCEPTED'; END IF;
 UPDATE r93f_photo_records SET upload_state='deleted' WHERE id='44444444-4444-4444-8444-444444444444';
 UPDATE car02_r93d_qa.cleanup_jobs SET lease_expires=now()-interval '1 second' WHERE id=j;
 SELECT car02_r93d_qa.r93f_finish_verified(j,l,'street_house_kitsuki','44444444-4444-4444-8444-444444444444',p,now(),true) INTO okay;
 IF okay THEN RAISE EXCEPTION 'R93F_EXPIRED_LEASE_ACCEPTED'; END IF;
 UPDATE car02_r93d_qa.cleanup_jobs SET lease_expires=now()+interval '30 seconds' WHERE id=j;
 SELECT car02_r93d_qa.r93f_finish_verified(j,l,'street_house_kitsuki','44444444-4444-4444-8444-444444444444',p,now(),true) INTO okay;
 IF NOT okay THEN RAISE EXCEPTION 'R93F_VALID_FENCE_REJECTED'; END IF;
 SELECT car02_r93d_qa.r93f_finish_verified(j,l,'street_house_kitsuki','44444444-4444-4444-8444-444444444444',p,now(),true) INTO okay;
 IF okay THEN RAISE EXCEPTION 'R93F_DUPLICATE_FINALIZE_ACCEPTED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM car02_r93d_qa.cleanup_jobs WHERE id=j AND state='verified' AND lease_id IS NULL AND lease_expires IS NULL AND last_reason='PRIVATE_OBJECT_PROBE_404')
 THEN RAISE EXCEPTION 'R93F_TERMINAL_STATE_INVALID'; END IF;
END $$;
ROLLBACK;
\echo R93F_PG17_TERMINAL_LEASE_FENCE_PASS

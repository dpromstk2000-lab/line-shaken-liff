-- DPRO CAR02 R93G — QA ONLY. PostgreSQL 17 *disposable GitHub Actions container*.
-- NOT an executable Supabase migration. Never apply to any customer/production DB.
-- This schema demonstrates invariant and atomic rollback; it DOES NOT implement
-- server-side authorization, real Storage deletion, or production RLS integration.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR current_setting('server_version_num')::integer<170000 OR
   to_regclass('public.ksh_car02_photos') IS NOT NULL OR
   to_regclass('public.ksh_demo_customers') IS NOT NULL THEN
  RAISE EXCEPTION 'R93G_DISPOSABLE_POSTGRES17_ONLY';
 END IF;
END $$;
CREATE SCHEMA car02_r93g_qa;
REVOKE ALL ON SCHEMA car02_r93g_qa FROM PUBLIC;
CREATE TABLE car02_r93g_qa.photos (
 id uuid PRIMARY KEY, shop_code text NOT NULL, order_id uuid NOT NULL, report_id uuid NOT NULL,
 storage_bucket text NOT NULL CHECK(storage_bucket='ksh-car02-private-photos'),
 storage_path text NOT NULL UNIQUE, mime_type text NOT NULL,
 byte_size bigint NOT NULL CHECK (byte_size>0 AND byte_size<=5242880),
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 upload_state text NOT NULL CHECK (upload_state IN ('pending','ready','deleted')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE car02_r93g_qa.cleanup_jobs (
 job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 photo_id uuid NOT NULL UNIQUE, shop_code text NOT NULL,
 storage_path text NOT NULL, state text NOT NULL DEFAULT 'queued' CHECK (state='queued'),
 created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA car02_r93g_qa FROM PUBLIC;
CREATE FUNCTION car02_r93g_qa.photo_mutation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=car02_r93g_qa,pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.upload_state<>'pending' THEN
   RAISE EXCEPTION 'R93G_INSERT_MUST_BEGIN_PENDING' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'R93G_HARD_DELETE_PROHIBITED' USING ERRCODE='23514';
 END IF;
 IF OLD.upload_state='deleted' THEN
  RAISE EXCEPTION 'R93G_TOMBSTONE_FINAL' USING ERRCODE='23514';
 END IF;
 IF ROW(NEW.id,NEW.shop_code,NEW.order_id,NEW.report_id,NEW.storage_bucket,
        NEW.storage_path,NEW.mime_type,NEW.byte_size,NEW.sha256,NEW.created_at)
     IS DISTINCT FROM
    ROW(OLD.id,OLD.shop_code,OLD.order_id,OLD.report_id,OLD.storage_bucket,
        OLD.storage_path,OLD.mime_type,OLD.byte_size,OLD.sha256,OLD.created_at) THEN
  RAISE EXCEPTION 'R93G_METADATA_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF OLD.upload_state='ready' AND NEW.upload_state='pending' THEN
  RAISE EXCEPTION 'R93G_STATE_REGRESSION' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER car02_r93g_photo_guard
BEFORE INSERT OR UPDATE OR DELETE ON car02_r93g_qa.photos
FOR EACH ROW EXECUTE FUNCTION car02_r93g_qa.photo_mutation_guard();
CREATE FUNCTION car02_r93g_qa.enqueue_on_tombstone() RETURNS trigger
LANGUAGE plpgsql SET search_path=car02_r93g_qa,pg_catalog AS $$
BEGIN
 IF NEW.upload_state='deleted' AND OLD.upload_state IS DISTINCT FROM NEW.upload_state THEN
  INSERT INTO car02_r93g_qa.cleanup_jobs(photo_id,shop_code,storage_path)
  VALUES(NEW.id,NEW.shop_code,NEW.storage_path);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER car02_r93g_atomic_outbox
AFTER UPDATE OF upload_state ON car02_r93g_qa.photos
FOR EACH ROW EXECUTE FUNCTION car02_r93g_qa.enqueue_on_tombstone();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA car02_r93g_qa FROM PUBLIC;
-- A and B are distinct private photos. The blob UUID need not equal photo ID.
INSERT INTO car02_r93g_qa.photos(id,shop_code,order_id,report_id,storage_bucket,
 storage_path,mime_type,byte_size,sha256,upload_state) VALUES
('44444444-4444-4444-8444-444444444444','street_house_kitsuki',
 '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
 'ksh-car02-private-photos','street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.jpg',
 'image/jpeg',777,repeat('a',64),'pending'),
('88888888-8888-4888-8888-888888888888','street_house_kitsuki',
 '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
 'ksh-car02-private-photos','street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/99999999-9999-4999-8999-999999999999.jpg',
 'image/jpeg',777,repeat('b',64),'pending');
-- A privileged INSERT may not skip the pending state.
DO $$ BEGIN
 BEGIN
  INSERT INTO car02_r93g_qa.photos(id,shop_code,order_id,report_id,storage_bucket,
    storage_path,mime_type,byte_size,sha256,upload_state)
  VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','street_house_kitsuki',
   '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
   'ksh-car02-private-photos','street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
   'image/jpeg',777,repeat('c',64),'deleted');
  RAISE EXCEPTION 'R93G_DIRECT_DELETED_INSERT_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE car02_r93g_qa.photos SET upload_state='ready'
 WHERE id='44444444-4444-4444-8444-444444444444';
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM car02_r93g_qa.cleanup_jobs;
 IF n<>0 THEN RAISE EXCEPTION 'R93G_READY_CREATED_OUTBOX'; END IF;
END $$;
-- First tombstone and its outbox insert MUST be one transaction.
UPDATE car02_r93g_qa.photos SET upload_state='deleted'
 WHERE id='44444444-4444-4444-8444-444444444444';
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM car02_r93g_qa.cleanup_jobs j
 JOIN car02_r93g_qa.photos p ON p.id=j.photo_id
 WHERE p.upload_state='deleted' AND j.storage_path=p.storage_path
   AND j.shop_code=p.shop_code;
 IF n<>1 THEN RAISE EXCEPTION 'R93G_ATOMIC_ENQUEUE_MISSING'; END IF;
END $$;
-- All attempts at undoing deletion, tampering with the UUID/path, or hard deleting are rejected.
DO $$ DECLARE v text; BEGIN
 FOREACH v IN ARRAY ARRAY['pending','ready','deleted'] LOOP
  BEGIN
   UPDATE car02_r93g_qa.photos SET upload_state=v
   WHERE id='44444444-4444-4444-8444-444444444444';
   RAISE EXCEPTION 'R93G_TOMBSTONE_REANIMATED';
  EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
 BEGIN
  DELETE FROM car02_r93g_qa.photos WHERE id='44444444-4444-4444-8444-444444444444';
  RAISE EXCEPTION 'R93G_PHOTO_HARD_DELETED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE car02_r93g_qa.photos SET storage_path='other/secret.jpg'
   WHERE id='88888888-8888-4888-8888-888888888888';
  RAISE EXCEPTION 'R93G_STORAGE_PATH_MUTATED';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- Ready-to-pending regression is rejected with the current status intact.
UPDATE car02_r93g_qa.photos SET upload_state='ready'
 WHERE id='88888888-8888-4888-8888-888888888888';
DO $$ BEGIN
 BEGIN
  UPDATE car02_r93g_qa.photos SET upload_state='pending'
  WHERE id='88888888-8888-4888-8888-888888888888';
  RAISE EXCEPTION 'R93G_READY_REGRESSION_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- A simulated outbox uniqueness collision MUST ROLLBACK the photo-state change.
INSERT INTO car02_r93g_qa.cleanup_jobs(photo_id,shop_code,storage_path)
 SELECT id,shop_code,storage_path FROM car02_r93g_qa.photos
 WHERE id='88888888-8888-4888-8888-888888888888';
DO $$ BEGIN
 BEGIN
  UPDATE car02_r93g_qa.photos SET upload_state='deleted'
   WHERE id='88888888-8888-4888-8888-888888888888';
  RAISE EXCEPTION 'R93G_OUTBOX_FAILURE_DID_NOT_ROLLBACK';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 IF (SELECT upload_state FROM car02_r93g_qa.photos
     WHERE id='88888888-8888-4888-8888-888888888888')<>'ready'
 THEN RAISE EXCEPTION 'R93G_PARTIAL_TOMBSTONE'; END IF;
END $$;
DO $$ BEGIN
 IF (SELECT count(*) FROM car02_r93g_qa.cleanup_jobs)<>2
 THEN RAISE EXCEPTION 'R93G_OUTBOX_UNEXPECTED_COUNT'; END IF;
END $$;
ROLLBACK;
\echo R93G_PG17_ATOMIC_TOMBSTONE_OUTBOX_PASS

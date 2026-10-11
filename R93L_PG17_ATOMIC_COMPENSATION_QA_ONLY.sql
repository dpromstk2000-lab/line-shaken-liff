-- R93L PostgreSQL 17 DISPOSABLE CI DB ONLY. Never apply to Supabase, stage or production.
-- Executes real PG row locks, identity checks, photo tombstones, outbox insert, rollback.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'car02_r93l_qa_ci' OR current_setting('server_version_num')::int<170000 OR
    to_regclass('public.ksh_car02_photos') IS NOT NULL OR to_regclass('public.ksh_demo_reservations') IS NOT NULL
 THEN RAISE EXCEPTION 'R93L_DISPOSABLE_PG17_ONLY'; END IF;
END $$;
CREATE SCHEMA car02_r93l_qa;
REVOKE ALL ON SCHEMA car02_r93l_qa FROM PUBLIC;
CREATE TABLE car02_r93l_qa.staff(
 shop_code text NOT NULL,staff_id uuid NOT NULL,role text NOT NULL CHECK(role IN('owner','staff')),
 active boolean NOT NULL, PRIMARY KEY(shop_code,staff_id));
CREATE TABLE car02_r93l_qa.work_orders(id uuid PRIMARY KEY,shop_code text NOT NULL);
CREATE TABLE car02_r93l_qa.reports(id uuid PRIMARY KEY,shop_code text NOT NULL,order_id uuid NOT NULL REFERENCES car02_r93l_qa.work_orders(id));
CREATE TABLE car02_r93l_qa.photos(
 id uuid PRIMARY KEY,shop_code text NOT NULL,order_id uuid NOT NULL,report_id uuid NOT NULL REFERENCES car02_r93l_qa.reports(id),
 storage_bucket text NOT NULL CHECK(storage_bucket='ksh-car02-private-photos'),
 storage_path text NOT NULL UNIQUE,upload_state text NOT NULL CHECK(upload_state IN ('pending','ready','deleted')));
CREATE TABLE car02_r93l_qa.cleanup_jobs(
 job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),photo_id uuid NOT NULL UNIQUE REFERENCES car02_r93l_qa.photos(id),
 shop_code text NOT NULL,storage_path text NOT NULL,state text NOT NULL CHECK(state='queued'),
 reason text NOT NULL CHECK(reason='UPLOAD_UNCERTAIN'));
REVOKE ALL ON ALL TABLES IN SCHEMA car02_r93l_qa FROM PUBLIC;
-- Equivalent to the R93L JS adapter's transaction as one PL/pgSQL function for real PG QA.
CREATE FUNCTION car02_r93l_qa.qa_compensate(
 p_photo uuid,p_shop text,p_order uuid,p_report uuid,p_path text,p_staff uuid,p_role text)
RETURNS uuid LANGUAGE plpgsql SET search_path=car02_r93l_qa,pg_catalog AS $$
DECLARE s record; x record; changed uuid; created uuid;
BEGIN
 SELECT role,active INTO s FROM car02_r93l_qa.staff
  WHERE shop_code=p_shop AND staff_id=p_staff FOR UPDATE;
 IF NOT FOUND OR s.active IS DISTINCT FROM true OR s.role<>p_role
 THEN RAISE EXCEPTION 'R93L_STAFF_DENIED'; END IF;
 SELECT p.id,p.upload_state,p.storage_path,p.storage_bucket INTO x
 FROM car02_r93l_qa.photos p
 JOIN car02_r93l_qa.reports r ON r.id=p.report_id AND r.shop_code=p.shop_code
 JOIN car02_r93l_qa.work_orders o ON o.id=r.order_id AND o.shop_code=p.shop_code
 WHERE p.id=p_photo AND p.shop_code=p_shop AND p.order_id=p_order AND p.report_id=p_report AND o.id=p_order
 FOR UPDATE OF p,r,o;
 IF NOT FOUND OR x.upload_state<>'pending' OR x.storage_bucket<>'ksh-car02-private-photos' OR x.storage_path<>p_path
 THEN RAISE EXCEPTION 'R93L_PHOTO_NOT_PENDING_OR_SCOPE_MISMATCH'; END IF;
 UPDATE car02_r93l_qa.photos SET upload_state='deleted'
 WHERE id=p_photo AND shop_code=p_shop AND order_id=p_order AND report_id=p_report
 AND storage_bucket='ksh-car02-private-photos' AND storage_path=p_path AND upload_state='pending'
 RETURNING id INTO changed;
 IF changed IS DISTINCT FROM p_photo THEN RAISE EXCEPTION 'R93L_UPDATE_CONFLICT'; END IF;
 INSERT INTO car02_r93l_qa.cleanup_jobs(photo_id,shop_code,storage_path,state,reason)
 VALUES(p_photo,p_shop,p_path,'queued','UPLOAD_UNCERTAIN') RETURNING job_id INTO created;
 RETURN created;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA car02_r93l_qa FROM PUBLIC;
INSERT INTO car02_r93l_qa.work_orders VALUES
('22222222-2222-4222-8222-222222222222','street_house_kitsuki'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','other_shop');
INSERT INTO car02_r93l_qa.reports VALUES
('33333333-3333-4333-8333-333333333333','street_house_kitsuki','22222222-2222-4222-8222-222222222222'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','other_shop','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO car02_r93l_qa.staff VALUES
('street_house_kitsuki','11111111-1111-4111-8111-111111111111','staff',true),
('street_house_kitsuki','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','staff',false),
('other_shop','ffffffff-ffff-4fff-8fff-ffffffffffff','owner',true);
INSERT INTO car02_r93l_qa.photos VALUES
('44444444-4444-4444-8444-444444444444','street_house_kitsuki',
 '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
 'ksh-car02-private-photos',
 'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.jpg','pending'),
('88888888-8888-4888-8888-888888888888','street_house_kitsuki',
 '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
 'ksh-car02-private-photos',
 'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/99999999-9999-4999-8999-999999999999.jpg','pending');
-- wrong tenant/role/path/disabled staff all fail before photo state update
DO $$ DECLARE denied boolean; v text; BEGIN
 FOR v IN SELECT unnest(ARRAY['wrong_shop','inactive_staff','wrong_role','wrong_path','wrong_photo']) LOOP
 denied:=false;
 BEGIN
  PERFORM car02_r93l_qa.qa_compensate(
  CASE WHEN v='wrong_photo' THEN '99999999-9999-4999-8999-999999999998'::uuid ELSE '44444444-4444-4444-8444-444444444444'::uuid END,
  CASE WHEN v='wrong_shop' THEN 'other_shop' ELSE 'street_house_kitsuki' END,
  '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
  CASE WHEN v='wrong_path' THEN 'other/path.jpg' ELSE 'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.jpg' END,
  CASE WHEN v='inactive_staff' THEN 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid ELSE '11111111-1111-4111-8111-111111111111'::uuid END,
  CASE WHEN v='wrong_role' THEN 'owner' ELSE 'staff' END);
 EXCEPTION WHEN raise_exception THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'R93L_SCOPE_FAILURE_%',v; END IF;
 END LOOP;
 IF (SELECT count(*) FROM car02_r93l_qa.cleanup_jobs)<>0 OR
    (SELECT count(*) FROM car02_r93l_qa.photos WHERE upload_state='pending')<>2
 THEN RAISE EXCEPTION 'R93L_REFUSAL_MODIFIED_PHOTOS'; END IF;
END $$;
-- successful transaction returns a job, is exactly once, and binds path to photo
DO $$ DECLARE j uuid; rejected boolean:=false; BEGIN
 j:=car02_r93l_qa.qa_compensate('44444444-4444-4444-8444-444444444444',
 'street_house_kitsuki','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
 'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.jpg',
 '11111111-1111-4111-8111-111111111111','staff');
 IF j IS NULL OR (SELECT count(*) FROM car02_r93l_qa.cleanup_jobs WHERE job_id=j AND state='queued')<>1
 THEN RAISE EXCEPTION 'R93L_JOB_NOT_QUEUED'; END IF;
 BEGIN
 PERFORM car02_r93l_qa.qa_compensate('44444444-4444-4444-8444-444444444444',
 'street_house_kitsuki','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
 'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.jpg',
 '11111111-1111-4111-8111-111111111111','staff');
 EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'R93L_DUPLICATE_ALLOWED'; END IF;
 IF (SELECT count(*) FROM car02_r93l_qa.cleanup_jobs)<>1 THEN RAISE EXCEPTION 'R93L_DUPLICATED_OUTBOX'; END IF;
END $$;
-- queue unique collision causes photo update rollback (not a partial delete)
INSERT INTO car02_r93l_qa.cleanup_jobs(photo_id,shop_code,storage_path,state,reason)
SELECT id,shop_code,storage_path,'queued','UPLOAD_UNCERTAIN' FROM car02_r93l_qa.photos
WHERE id='88888888-8888-4888-8888-888888888888';
DO $$ DECLARE rejected boolean:=false; BEGIN
 BEGIN
 PERFORM car02_r93l_qa.qa_compensate('88888888-8888-4888-8888-888888888888',
 'street_house_kitsuki','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
 'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/99999999-9999-4999-8999-999999999999.jpg',
 '11111111-1111-4111-8111-111111111111','staff');
 EXCEPTION WHEN unique_violation THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'R93L_COLLISION_ALLOWED'; END IF;
 IF (SELECT upload_state FROM car02_r93l_qa.photos WHERE id='88888888-8888-4888-8888-888888888888')<>'pending'
 THEN RAISE EXCEPTION 'R93L_PARTIAL_TOMBSTONE'; END IF;
END $$;
ROLLBACK;
\echo R93L_PG17_REAL_TRANSACTION_AND_ROLLBACK_PASS

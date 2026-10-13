-- R120 QA FIXTURE ONLY. Not a migration. Never execute on Supabase or existing databases.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'car02_r120_qa_ci'
 OR current_setting('server_version_num')::integer<170000
 OR current_setting('server_version_num')::integer>=180000
 OR to_regclass('public.ksh_car02_photos') IS NOT NULL
 OR to_regclass('car02_r120_qa.bookings') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('car02_r120_a_ci','car02_r120_b_ci'))
 THEN RAISE EXCEPTION 'R120_DISPOSABLE_PG17_ONLY' USING ERRCODE='42501'; END IF;
END $$;
CREATE ROLE car02_r120_a_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r120-only-in-disposable-container';
CREATE ROLE car02_r120_b_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r120-only-in-disposable-container';
CREATE SCHEMA car02_r120_qa;
REVOKE ALL ON SCHEMA car02_r120_qa FROM PUBLIC;
GRANT USAGE ON SCHEMA car02_r120_qa TO car02_r120_a_ci, car02_r120_b_ci;
CREATE TABLE car02_r120_qa.bookings (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shop_code text NOT NULL CHECK(shop_code IN ('street_house_demo','other_demo')),
 request_key text NOT NULL CHECK(request_key ~ '^[a-zA-Z0-9_-]{12,64}$'),
 booking_day date NOT NULL,
 begins_at time(0) NOT NULL,
 service_code text NOT NULL CHECK(service_code IN ('INSPECTION','MAINTENANCE')),
 state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 cancelled_at timestamptz,
 CONSTRAINT r120_request_identity UNIQUE(shop_code,request_key),
 CONSTRAINT r120_half_hour CHECK (extract(second from begins_at)=0 AND extract(minute from begins_at) IN (0,30)),
 CONSTRAINT r120_hours CHECK(begins_at BETWEEN '09:00'::time AND '17:30'::time),
 CONSTRAINT r120_cancelled_timestamp CHECK((state='ACTIVE' AND cancelled_at IS NULL) OR (state='CANCELLED' AND cancelled_at IS NOT NULL))
);
-- A cancelled slot becomes available, but the old request identity remains permanently spent.
CREATE UNIQUE INDEX r120_one_active_per_slot ON car02_r120_qa.bookings(shop_code,booking_day,begins_at) WHERE state='ACTIVE';
CREATE TABLE car02_r120_qa.audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shop_code text NOT NULL,
 booking_id bigint NOT NULL REFERENCES car02_r120_qa.bookings(id),
 action text NOT NULL CHECK(action IN ('CREATED','CANCELLED')),
 event_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON car02_r120_qa.bookings,car02_r120_qa.audit_events FROM PUBLIC;
GRANT SELECT ON car02_r120_qa.bookings,car02_r120_qa.audit_events TO car02_r120_a_ci,car02_r120_b_ci;
ALTER TABLE car02_r120_qa.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r120_qa.bookings FORCE ROW LEVEL SECURITY;
ALTER TABLE car02_r120_qa.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r120_qa.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY r120_booking_tenant_read ON car02_r120_qa.bookings FOR SELECT TO car02_r120_a_ci,car02_r120_b_ci
 USING (shop_code=CASE session_user WHEN 'car02_r120_a_ci' THEN 'street_house_demo' WHEN 'car02_r120_b_ci' THEN 'other_demo' ELSE NULL END);
CREATE POLICY r120_audit_tenant_read ON car02_r120_qa.audit_events FOR SELECT TO car02_r120_a_ci,car02_r120_b_ci
 USING (shop_code=CASE session_user WHEN 'car02_r120_a_ci' THEN 'street_house_demo' WHEN 'car02_r120_b_ci' THEN 'other_demo' ELSE NULL END);
-- SECURITY DEFINER permitted ONLY for these two tightly-scoped functions in disposable CI.
-- Session identity is derived from the DB login; caller cannot select arbitrary tenant IDs.
CREATE FUNCTION car02_r120_qa.claim_slot(p_request_key text,p_booking_day date,p_begins_at time,p_service_code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,car02_r120_qa
AS $$
DECLARE v_shop text; v_now timestamp without time zone; v_existing car02_r120_qa.bookings%ROWTYPE; v_new_id bigint;
BEGIN
 v_shop:=CASE session_user WHEN 'car02_r120_a_ci' THEN 'street_house_demo' WHEN 'car02_r120_b_ci' THEN 'other_demo' ELSE NULL END;
 IF v_shop IS NULL THEN RAISE EXCEPTION 'R120_UNAPPROVED_IDENTITY' USING ERRCODE='42501'; END IF;
 v_now:=now() AT TIME ZONE 'Asia/Tokyo';
 IF p_request_key IS NULL OR p_request_key !~ '^[a-zA-Z0-9_-]{12,64}$'
 OR p_booking_day IS NULL OR p_booking_day<v_now::date OR p_booking_day>v_now::date+60
 OR extract(isodow from p_booking_day)=7
 OR p_begins_at IS NULL OR extract(minute from p_begins_at) NOT IN (0,30)
 OR extract(second from p_begins_at)<>0 OR p_begins_at<'09:00'::time OR p_begins_at>'17:30'::time
 OR (p_booking_day=v_now::date AND p_begins_at<=v_now::time)
 OR p_service_code IS NULL OR p_service_code NOT IN ('INSPECTION','MAINTENANCE')
 THEN RAISE EXCEPTION 'R120_INVALID_INPUT' USING ERRCODE='22023'; END IF;
 INSERT INTO car02_r120_qa.bookings(shop_code,request_key,booking_day,begins_at,service_code)
 VALUES(v_shop,p_request_key,p_booking_day,p_begins_at,p_service_code)
 ON CONFLICT DO NOTHING RETURNING id INTO v_new_id;
 IF v_new_id IS NOT NULL THEN
   INSERT INTO car02_r120_qa.audit_events(shop_code,booking_id,action) VALUES(v_shop,v_new_id,'CREATED');
   RETURN 'CREATED';
 END IF;
 SELECT * INTO v_existing FROM car02_r120_qa.bookings WHERE shop_code=v_shop AND request_key=p_request_key;
 IF FOUND THEN
   IF v_existing.booking_day<>p_booking_day OR v_existing.begins_at<>p_begins_at OR v_existing.service_code<>p_service_code
   THEN RAISE EXCEPTION 'R120_IDEMPOTENCY_MISMATCH' USING ERRCODE='22023'; END IF;
   RETURN CASE WHEN v_existing.state='CANCELLED' THEN 'CANCELLED_REQUEST' ELSE 'IDEMPOTENT' END;
 END IF;
 RETURN 'SLOT_TAKEN';
END $$;
CREATE FUNCTION car02_r120_qa.cancel_slot(p_request_key text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,car02_r120_qa
AS $$
DECLARE v_shop text; v_updated_id bigint; v_existing_state text;
BEGIN
 v_shop:=CASE session_user WHEN 'car02_r120_a_ci' THEN 'street_house_demo' WHEN 'car02_r120_b_ci' THEN 'other_demo' ELSE NULL END;
 IF v_shop IS NULL THEN RAISE EXCEPTION 'R120_UNAPPROVED_IDENTITY' USING ERRCODE='42501'; END IF;
 IF p_request_key IS NULL OR p_request_key !~ '^[a-zA-Z0-9_-]{12,64}$'
 THEN RAISE EXCEPTION 'R120_INVALID_KEY' USING ERRCODE='22023'; END IF;
 UPDATE car02_r120_qa.bookings SET state='CANCELLED',cancelled_at=clock_timestamp()
 WHERE shop_code=v_shop AND request_key=p_request_key AND state='ACTIVE'
 RETURNING id INTO v_updated_id;
 IF v_updated_id IS NOT NULL THEN
  INSERT INTO car02_r120_qa.audit_events(shop_code,booking_id,action) VALUES(v_shop,v_updated_id,'CANCELLED');
  RETURN 'CANCELLED';
 END IF;
 SELECT state INTO v_existing_state FROM car02_r120_qa.bookings WHERE shop_code=v_shop AND request_key=p_request_key;
 IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
 RETURN 'IDEMPOTENT_CANCEL';
END $$;
REVOKE ALL ON FUNCTION car02_r120_qa.claim_slot(text,date,time,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION car02_r120_qa.cancel_slot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION car02_r120_qa.claim_slot(text,date,time,text),car02_r120_qa.cancel_slot(text) TO car02_r120_a_ci,car02_r120_b_ci;
COMMIT;
\echo R120_DISPOSABLE_PG17_LIFECYCLE_SCHEMA_READY

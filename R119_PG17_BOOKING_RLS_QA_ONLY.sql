-- DPRO CAR02 R119: DISPOSABLE PostgreSQL 17 CI DATABASE ONLY.
-- NEVER run this SQL in Supabase, shared DB or production; synthetic fixture only.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'car02_r119_qa_ci'
     OR current_setting('server_version_num')::integer < 170000
     OR current_setting('server_version_num')::integer >= 180000
     OR to_regclass('public.ksh_car02_photos') IS NOT NULL
     OR to_regclass('car02_r119_qa.bookings') IS NOT NULL
     OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('car02_r119_a_ci','car02_r119_b_ci'))
  THEN RAISE EXCEPTION 'R119_DISPOSABLE_PG17_ONLY' USING ERRCODE='42501'; END IF;
END $$;
CREATE ROLE car02_r119_a_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r119-disposable-tenant-only';
CREATE ROLE car02_r119_b_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r119-disposable-tenant-only';
CREATE SCHEMA car02_r119_qa;
REVOKE ALL ON SCHEMA car02_r119_qa FROM PUBLIC;
GRANT USAGE ON SCHEMA car02_r119_qa TO car02_r119_a_ci,car02_r119_b_ci;
CREATE TABLE car02_r119_qa.bookings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_code text NOT NULL CHECK(shop_code IN ('street_house_demo','other_demo')),
  request_key text NOT NULL CHECK(request_key ~ '^[a-zA-Z0-9_-]{12,64}$'),
  booking_day date NOT NULL,
  begins_at time(0) without time zone NOT NULL,
  service_code text NOT NULL CHECK(service_code IN ('INSPECTION','MAINTENANCE')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT r119_unique_tenant_slot UNIQUE(shop_code,booking_day,begins_at),
  CONSTRAINT r119_unique_tenant_request UNIQUE(shop_code,request_key),
  CONSTRAINT r119_fixed_half_hour CHECK (extract(second from begins_at)=0 AND extract(minute from begins_at) IN (0,30)),
  CONSTRAINT r119_business_hours CHECK (begins_at BETWEEN '09:00'::time AND '17:30'::time)
);
REVOKE ALL ON TABLE car02_r119_qa.bookings FROM PUBLIC;
GRANT SELECT,INSERT ON car02_r119_qa.bookings TO car02_r119_a_ci,car02_r119_b_ci;
GRANT USAGE ON SEQUENCE car02_r119_qa.bookings_id_seq TO car02_r119_a_ci,car02_r119_b_ci;
ALTER TABLE car02_r119_qa.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r119_qa.bookings FORCE ROW LEVEL SECURITY;
CREATE POLICY r119_tenant_read ON car02_r119_qa.bookings FOR SELECT TO car02_r119_a_ci,car02_r119_b_ci
  USING(shop_code=CASE session_user WHEN 'car02_r119_a_ci' THEN 'street_house_demo'
    WHEN 'car02_r119_b_ci' THEN 'other_demo' ELSE NULL END);
CREATE POLICY r119_tenant_insert ON car02_r119_qa.bookings FOR INSERT TO car02_r119_a_ci,car02_r119_b_ci
  WITH CHECK(shop_code=CASE session_user WHEN 'car02_r119_a_ci' THEN 'street_house_demo'
    WHEN 'car02_r119_b_ci' THEN 'other_demo' ELSE NULL END);
-- Only low-privilege clients can invoke the booking function; no SECURITY DEFINER bypass.
CREATE FUNCTION car02_r119_qa.claim_slot(p_request_key text,p_booking_day date,p_begins_at time,p_service_code text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,car02_r119_qa
AS $$
DECLARE v_shop text;
        v_now_jp timestamp without time zone;
        v_old car02_r119_qa.bookings%ROWTYPE;
        v_id bigint;
BEGIN
 IF session_user <> current_user THEN
   RAISE EXCEPTION 'R119_ROLE_SWITCH_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 v_shop:=CASE session_user WHEN 'car02_r119_a_ci' THEN 'street_house_demo'
                            WHEN 'car02_r119_b_ci' THEN 'other_demo' ELSE NULL END;
 IF v_shop IS NULL THEN RAISE EXCEPTION 'R119_UNKNOWN_ROLE' USING ERRCODE='42501'; END IF;
 v_now_jp:=now() AT TIME ZONE 'Asia/Tokyo';
 IF p_request_key IS NULL OR p_request_key !~ '^[a-zA-Z0-9_-]{12,64}$'
   OR p_service_code IS NULL OR p_service_code NOT IN ('INSPECTION','MAINTENANCE')
   OR p_booking_day IS NULL OR p_booking_day < v_now_jp::date
   OR p_booking_day > v_now_jp::date + 60
   OR extract(isodow from p_booking_day) = 7
   OR p_begins_at IS NULL OR p_begins_at < '09:00'::time OR p_begins_at > '17:30'::time
   OR extract(minute from p_begins_at) NOT IN (0,30) OR extract(second from p_begins_at) <> 0
   OR (p_booking_day=v_now_jp::date AND p_begins_at <= v_now_jp::time)
 THEN RAISE EXCEPTION 'R119_INVALID_BOOKING_INPUT' USING ERRCODE='22023'; END IF;
 INSERT INTO car02_r119_qa.bookings(shop_code,request_key,booking_day,begins_at,service_code)
 VALUES (v_shop,p_request_key,p_booking_day,p_begins_at,p_service_code)
 ON CONFLICT DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NOT NULL THEN RETURN 'CREATED'; END IF;
 SELECT * INTO v_old FROM car02_r119_qa.bookings
  WHERE shop_code=v_shop AND request_key=p_request_key;
 IF FOUND THEN
  IF v_old.booking_day=p_booking_day AND v_old.begins_at=p_begins_at
       AND v_old.service_code=p_service_code THEN RETURN 'IDEMPOTENT'; END IF;
  RAISE EXCEPTION 'R119_IDEMPOTENCY_PAYLOAD_MISMATCH' USING ERRCODE='22023';
 END IF;
 RETURN 'SLOT_TAKEN';
END $$;
REVOKE ALL ON FUNCTION car02_r119_qa.claim_slot(text,date,time,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION car02_r119_qa.claim_slot(text,date,time,text) TO car02_r119_a_ci,car02_r119_b_ci;
COMMIT;
\echo R119_DISPOSABLE_PG17_SCHEMA_READY

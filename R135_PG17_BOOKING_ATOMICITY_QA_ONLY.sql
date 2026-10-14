-- DPRO CAR02 R135 PG17 DISPOSABLE TEST FIXTURE ONLY.
-- NEVER execute on Supabase, staging or any retained database.
-- This SQL requires an exact disposable CI database and PostgreSQL 17.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'car02_r135_qa_ci'
    OR current_setting('server_version_num')::integer < 170000
    OR current_setting('server_version_num')::integer >= 180000
    OR to_regnamespace('car02_r135_qa') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('car02_r135_a_ci','car02_r135_b_ci'))
 THEN RAISE EXCEPTION 'R135_DISPOSABLE_PG17_ONLY' USING ERRCODE='42501';
 END IF;
END $$;
CREATE ROLE car02_r135_a_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r135-only-in-disposable-container';
CREATE ROLE car02_r135_b_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r135-only-in-disposable-container';
CREATE SCHEMA car02_r135_qa;
REVOKE ALL ON SCHEMA car02_r135_qa FROM PUBLIC;
GRANT USAGE ON SCHEMA car02_r135_qa TO car02_r135_a_ci,car02_r135_b_ci;
CREATE TABLE car02_r135_qa.bookings (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shop_code text NOT NULL CHECK (shop_code IN ('street_house_demo','other_demo')),
 request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9_-]{12,64}$'),
 booking_day date NOT NULL,
 begins_at time(0) NOT NULL,
 service_code text NOT NULL CHECK (service_code IN ('INSPECTION','MAINTENANCE')),
 state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 cancelled_at timestamptz,
 CONSTRAINT r135_unique_request UNIQUE (shop_code,request_key),
 CONSTRAINT r135_half_hour CHECK (extract(second from begins_at)=0 AND extract(minute from begins_at) IN (0,30)),
 CONSTRAINT r135_hours CHECK (begins_at BETWEEN '09:00'::time AND '17:30'::time),
 CONSTRAINT r135_cancel_state CHECK ((state='ACTIVE' AND cancelled_at IS NULL) OR (state='CANCELLED' AND cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX r135_unique_active_slot ON car02_r135_qa.bookings (shop_code,booking_day,begins_at) WHERE state='ACTIVE';
CREATE TABLE car02_r135_qa.audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shop_code text NOT NULL,
 booking_id bigint NOT NULL REFERENCES car02_r135_qa.bookings(id),
 action text NOT NULL CHECK(action IN ('CREATED','CANCELLED')),
 event_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON car02_r135_qa.bookings,car02_r135_qa.audit_events FROM PUBLIC;
GRANT SELECT ON car02_r135_qa.bookings,car02_r135_qa.audit_events TO car02_r135_a_ci,car02_r135_b_ci;
ALTER TABLE car02_r135_qa.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r135_qa.bookings FORCE ROW LEVEL SECURITY;
ALTER TABLE car02_r135_qa.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r135_qa.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY r135_booking_read ON car02_r135_qa.bookings FOR SELECT TO car02_r135_a_ci,car02_r135_b_ci
 USING(shop_code=CASE session_user WHEN 'car02_r135_a_ci' THEN 'street_house_demo' WHEN 'car02_r135_b_ci' THEN 'other_demo' ELSE NULL END);
CREATE POLICY r135_audit_read ON car02_r135_qa.audit_events FOR SELECT TO car02_r135_a_ci,car02_r135_b_ci
 USING(shop_code=CASE session_user WHEN 'car02_r135_a_ci' THEN 'street_house_demo' WHEN 'car02_r135_b_ci' THEN 'other_demo' ELSE NULL END);
-- SECURITY DEFINER is confined to this guarded disposable CI schema.
-- Tenant is derived from the authenticated PostgreSQL session_user, never from a caller-provided tenant ID.
CREATE FUNCTION car02_r135_qa.claim_slot(p_key text,p_day date,p_time time,p_service text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,car02_r135_qa
AS $$
DECLARE v_shop text; v_now timestamp without time zone; v_id bigint; v_prev car02_r135_qa.bookings%ROWTYPE;
BEGIN
 v_shop:=CASE session_user WHEN 'car02_r135_a_ci' THEN 'street_house_demo' WHEN 'car02_r135_b_ci' THEN 'other_demo' ELSE NULL END;
 IF v_shop IS NULL THEN RAISE EXCEPTION 'R135_UNAPPROVED_LOGIN' USING ERRCODE='42501'; END IF;
 v_now:=now() AT TIME ZONE 'Asia/Tokyo';
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{12,64}$'
    OR p_day IS NULL OR p_day < v_now::date OR p_day > v_now::date + 60
    OR extract(isodow from p_day)=7
    OR p_time IS NULL OR extract(second from p_time)<>0 OR extract(minute from p_time) NOT IN(0,30)
    OR p_time < '09:00'::time OR p_time > '17:30'::time
    OR (p_day=v_now::date AND p_time<=v_now::time)
    OR p_service IS NULL OR p_service NOT IN ('INSPECTION','MAINTENANCE')
 THEN RAISE EXCEPTION 'R135_INVALID_BOOKING' USING ERRCODE='22023'; END IF;
 INSERT INTO car02_r135_qa.bookings(shop_code,request_key,booking_day,begins_at,service_code)
 VALUES (v_shop,p_key,p_day,p_time,p_service)
 ON CONFLICT DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NOT NULL THEN
  INSERT INTO car02_r135_qa.audit_events(shop_code,booking_id,action) VALUES(v_shop,v_id,'CREATED');
  RETURN 'CREATED';
 END IF;
 SELECT * INTO v_prev FROM car02_r135_qa.bookings WHERE shop_code=v_shop AND request_key=p_key;
 IF FOUND THEN
  IF v_prev.booking_day<>p_day OR v_prev.begins_at<>p_time OR v_prev.service_code<>p_service
  THEN RAISE EXCEPTION 'R135_REQUEST_PAYLOAD_CONFLICT' USING ERRCODE='22023'; END IF;
  RETURN CASE WHEN v_prev.state='CANCELLED' THEN 'CANCELLED_REQUEST' ELSE 'IDEMPOTENT' END;
 END IF;
 RETURN 'SLOT_TAKEN';
END $$;
CREATE FUNCTION car02_r135_qa.cancel_slot(p_key text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,car02_r135_qa
AS $$
DECLARE v_shop text; v_id bigint; v_state text;
BEGIN
 v_shop:=CASE session_user WHEN 'car02_r135_a_ci' THEN 'street_house_demo' WHEN 'car02_r135_b_ci' THEN 'other_demo' ELSE NULL END;
 IF v_shop IS NULL THEN RAISE EXCEPTION 'R135_UNAPPROVED_LOGIN' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{12,64}$'
 THEN RAISE EXCEPTION 'R135_INVALID_KEY' USING ERRCODE='22023'; END IF;
 UPDATE car02_r135_qa.bookings SET state='CANCELLED',cancelled_at=clock_timestamp()
 WHERE shop_code=v_shop AND request_key=p_key AND state='ACTIVE'
 RETURNING id INTO v_id;
 IF v_id IS NOT NULL THEN
  INSERT INTO car02_r135_qa.audit_events(shop_code,booking_id,action) VALUES(v_shop,v_id,'CANCELLED');
  RETURN 'CANCELLED';
 END IF;
 SELECT state INTO v_state FROM car02_r135_qa.bookings WHERE shop_code=v_shop AND request_key=p_key;
 RETURN CASE WHEN v_state IS NULL THEN 'NOT_FOUND' ELSE 'IDEMPOTENT_CANCEL' END;
END $$;
REVOKE ALL ON FUNCTION car02_r135_qa.claim_slot(text,date,time,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION car02_r135_qa.cancel_slot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION car02_r135_qa.claim_slot(text,date,time,text),car02_r135_qa.cancel_slot(text) TO car02_r135_a_ci,car02_r135_b_ci;
COMMIT;
\echo R135_DISPOSABLE_PG17_SCHEMA_READY

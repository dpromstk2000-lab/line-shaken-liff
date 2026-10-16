-- ISOLATED CI FIXTURE ONLY; NEVER run in shared Supabase, staging, or production.
-- Depends on BASELINE_QA_ONLY.sql and R13_MIGRATION_QA_ONLY.sql in disposable PG17 car02_qa.
BEGIN;
DO $$BEGIN
 IF current_database() <> 'car02_qa'
 OR current_setting('server_version_num')::integer < 170000
 OR current_setting('server_version_num')::integer >= 180000
 OR to_regnamespace('car02_basic_qa') IS NOT NULL
 OR to_regclass('public.ksh_car02_work_orders') IS NULL
 THEN RAISE EXCEPTION 'CAR02_BASIC_BOOKING_DISPOSABLE_ONLY' USING ERRCODE='42501'; END IF;
END $$;
CREATE SCHEMA car02_basic_qa;
REVOKE ALL ON SCHEMA car02_basic_qa FROM PUBLIC;
CREATE TABLE car02_basic_qa.bookings (
 id uuid PRIMARY KEY REFERENCES public.ksh_demo_reservations(id) ON DELETE RESTRICT,
 shop_code text NOT NULL,
 customer_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 day date NOT NULL,
 begins_at time(0) NOT NULL,
 request_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT qa_one_request UNIQUE(shop_code,request_key),
 CONSTRAINT qa_half_hour CHECK(extract(second from begins_at)=0 AND extract(minute from begins_at) IN(0,30)),
 CONSTRAINT qa_shop_hours CHECK(begins_at BETWEEN '09:00'::time AND '17:30'::time)
);
CREATE UNIQUE INDEX qa_one_active_slot ON car02_basic_qa.bookings(shop_code,day,begins_at);
ALTER TABLE car02_basic_qa.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_basic_qa.bookings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON car02_basic_qa.bookings FROM PUBLIC,anon,authenticated;
COMMIT;

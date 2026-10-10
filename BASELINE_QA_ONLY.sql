-- TEST ONLY: synthetic baseline for ephemeral PostgreSQL 17 GitHub Actions job.
DO $$BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END$$;
CREATE TABLE public.ksh_demo_shop_settings(shop_code text PRIMARY KEY);
CREATE TABLE public.ksh_demo_customers(id uuid PRIMARY KEY,shop_code text NOT NULL);
CREATE TABLE public.ksh_demo_vehicles(id uuid PRIMARY KEY,shop_code text NOT NULL,customer_id uuid NOT NULL);
CREATE TABLE public.ksh_demo_reservations(id uuid PRIMARY KEY,shop_code text NOT NULL,customer_id uuid,vehicle_id uuid);
INSERT INTO public.ksh_demo_shop_settings VALUES ('street_house_kitsuki'),('other_shop');
INSERT INTO public.ksh_demo_customers VALUES ('11111111-1111-4111-8111-111111111111','street_house_kitsuki'),('33333333-3333-4333-8333-333333333333','other_shop');
INSERT INTO public.ksh_demo_vehicles VALUES ('22222222-2222-4222-8222-222222222222','street_house_kitsuki','11111111-1111-4111-8111-111111111111'),('44444444-4444-4444-8444-444444444444','other_shop','33333333-3333-4333-8333-333333333333');

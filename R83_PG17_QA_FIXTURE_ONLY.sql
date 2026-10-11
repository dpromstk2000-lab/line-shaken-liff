-- DPRO CAR02 R83. DISPOSABLE GITHUB ACTIONS POSTGRESQL 17 FIXTURE ONLY.
-- NOT a migration. NEVER apply to shared Supabase or any production database.
DO $$ BEGIN
 IF current_database() !~ '^car02_r83_qa_[a-z0-9_]{1,48}$' THEN
   RAISE EXCEPTION 'CAR02_R83_ISOLATION_REQUIRED';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_tables
   WHERE schemaname='public' AND tablename LIKE 'ksh_car02_%') THEN
   RAISE EXCEPTION 'CAR02_R83_EXISTING_SCHEMA_REJECTED';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- Minimal R13/R46-compatible schema shapes, ONLY for disposable SQL assertions.
CREATE TABLE public.ksh_demo_shop_settings(shop_code text PRIMARY KEY);
CREATE TABLE public.ksh_car02_staff_access(
  shop_code text NOT NULL REFERENCES public.ksh_demo_shop_settings(shop_code),
  user_sub uuid NOT NULL,staff_role text NOT NULL CHECK (staff_role IN ('owner','staff')),
  active boolean NOT NULL DEFAULT false, PRIMARY KEY(shop_code,user_sub)
);
CREATE TABLE public.ksh_car02_work_orders(
  id uuid PRIMARY KEY, shop_code text NOT NULL REFERENCES public.ksh_demo_shop_settings(shop_code),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','approved','declined','completed'))
);
CREATE TABLE public.ksh_car02_reports(
  id uuid PRIMARY KEY,work_order_id uuid NOT NULL REFERENCES public.ksh_car02_work_orders(id)
);
CREATE TABLE public.ksh_car02_photos(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.ksh_car02_reports(id),
  storage_bucket text NOT NULL CHECK(storage_bucket='ksh-car02-private-photos'),
  storage_path text NOT NULL UNIQUE CHECK(storage_path<>''),
  mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size bigint NOT NULL CHECK(byte_size > 0 AND byte_size <= 5242880),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  upload_state text NOT NULL DEFAULT 'pending' CHECK(upload_state IN ('pending','ready','deleted'))
);
CREATE INDEX ksh_car02_photos_report_idx ON public.ksh_car02_photos(report_id);
ALTER TABLE public.ksh_car02_staff_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ksh_car02_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ksh_car02_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ksh_car02_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ksh_car02_staff_access,public.ksh_car02_work_orders,
 public.ksh_car02_reports,public.ksh_car02_photos FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ksh_car02_staff_access,
 public.ksh_car02_work_orders,public.ksh_car02_reports,public.ksh_car02_photos TO service_role;

INSERT INTO public.ksh_demo_shop_settings(shop_code) VALUES('street_house_kitsuki'),('other_shop');
INSERT INTO public.ksh_car02_staff_access(shop_code,user_sub,staff_role,active)
 VALUES('street_house_kitsuki','33333333-3333-4333-8333-333333333333','staff',true),
       ('other_shop','66666666-6666-4666-8666-666666666666','owner',true);
INSERT INTO public.ksh_car02_work_orders(id,shop_code,status)
 VALUES('11111111-1111-4111-8111-111111111111','street_house_kitsuki','draft'),
       ('77777777-7777-4777-8777-777777777777','other_shop','draft');
INSERT INTO public.ksh_car02_reports(id,work_order_id)
 VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111'),
       ('88888888-8888-4888-8888-888888888888','77777777-7777-4777-8777-777777777777');
INSERT INTO public.ksh_car02_photos(id,report_id,storage_bucket,storage_path,mime_type,byte_size,sha256,upload_state)
 VALUES
 ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',
  'ksh-car02-private-photos','street_house_kitsuki/order/report/photo1.png','image/png',120,repeat('a',64),'pending'),
 ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222',
  'ksh-car02-private-photos','street_house_kitsuki/order/report/photo2.png','image/png',140,repeat('b',64),'ready'),
 ('99999999-9999-4999-8999-999999999999','22222222-2222-4222-8222-222222222222',
  'ksh-car02-private-photos','street_house_kitsuki/order/report/photo3.png','image/png',160,repeat('c',64),'deleted'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','88888888-8888-4888-8888-888888888888',
  'ksh-car02-private-photos','other_shop/order/report/photo1.png','image/png',100,repeat('d',64),'pending');

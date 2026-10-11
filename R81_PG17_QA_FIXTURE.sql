-- DPRO CAR02 R81 temporary GitHub Actions PostgreSQL 17 fixture ONLY.
-- The actual R13/R46 upstream schema is independently reviewed; this is a
-- minimal, disposable structure to check R81 SQL DDL/constraints/privileges.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE TABLE public.ksh_demo_shop_settings (shop_code text PRIMARY KEY);
INSERT INTO public.ksh_demo_shop_settings(shop_code) VALUES ('street_house_kitsuki'),('other_shop');
-- R46-style staff grant table; production may not be inferred from this fixture.
CREATE TABLE public.ksh_car02_staff_access (
  shop_code text NOT NULL REFERENCES public.ksh_demo_shop_settings(shop_code) ON DELETE RESTRICT,
  user_sub uuid NOT NULL,staff_role text NOT NULL CHECK (staff_role IN ('owner','staff')),
  active boolean NOT NULL DEFAULT false, grant_source text NOT NULL DEFAULT 'manual-reviewed',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(shop_code,user_sub)
);
ALTER TABLE public.ksh_car02_staff_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ksh_car02_staff_access FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ksh_car02_staff_access TO service_role;

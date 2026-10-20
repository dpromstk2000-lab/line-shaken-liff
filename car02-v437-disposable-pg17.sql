-- DPRO CAR02 V4.37: disposable PostgreSQL 17 ONLY. No production schema updates.
-- The exact SQL below is the literal exported by CAR02_V437_TOUCH_SQL.
\set ON_ERROR_STOP on
DO $$BEGIN IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'V437_PG17_REQUIRED'; END IF; END$$;
CREATE TABLE public.ksh_car02_work_orders (
  id uuid PRIMARY KEY,
  shop_code text NOT NULL,
  state_version integer NOT NULL CHECK (state_version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.ksh_car02_work_orders FROM PUBLIC;
CREATE ROLE v437_anon NOLOGIN;
CREATE ROLE v437_authenticated NOLOGIN;
REVOKE ALL ON public.ksh_car02_work_orders FROM v437_anon,v437_authenticated;
INSERT INTO public.ksh_car02_work_orders (id,shop_code,state_version) VALUES
  ('00000000-0000-0000-0000-000000000437','street_house_kitsuki',1),
  ('00000000-0000-0000-0000-000000001437','other-shop',1);
DO $$BEGIN
 IF has_table_privilege('v437_anon','public.ksh_car02_work_orders','UPDATE') OR
    has_table_privilege('v437_authenticated','public.ksh_car02_work_orders','UPDATE')
 THEN RAISE EXCEPTION 'V437_UNPRIVILEGED_WRITE_OPEN'; END IF;
END$$;
\echo V437_DISPOSABLE_PG17_PRIVILEGE_DENY_PASS
-- Cross-tenant ID with source tenant must affect zero rows.
-- Unambiguous row-count checks and CAS rollback.
DO $$DECLARE cnt integer; BEGIN
 UPDATE public.ksh_car02_work_orders SET state_version=state_version+1,updated_at=clock_timestamp()
  WHERE shop_code='street_house_kitsuki' AND id='00000000-0000-0000-0000-000000001437' AND state_version=1;
 GET DIAGNOSTICS cnt=ROW_COUNT;
 IF cnt<>0 THEN RAISE EXCEPTION 'V437_CROSS_TENANT_WRITE_ALLOWED'; END IF;
 UPDATE public.ksh_car02_work_orders SET state_version=state_version+1,updated_at=clock_timestamp()
  WHERE shop_code='street_house_kitsuki' AND id='00000000-0000-0000-0000-000000000437' AND state_version=1;
 GET DIAGNOSTICS cnt=ROW_COUNT;
 IF cnt<>1 THEN RAISE EXCEPTION 'V437_OWN_TENANT_CAS_FAILED'; END IF;
 UPDATE public.ksh_car02_work_orders SET state_version=state_version+1,updated_at=clock_timestamp()
  WHERE shop_code='street_house_kitsuki' AND id='00000000-0000-0000-0000-000000000437' AND state_version=1;
 GET DIAGNOSTICS cnt=ROW_COUNT;
 IF cnt<>0 THEN RAISE EXCEPTION 'V437_STALE_CAS_ALLOWED'; END IF;
 IF (SELECT state_version FROM public.ksh_car02_work_orders WHERE id='00000000-0000-0000-0000-000000001437')<>1
 THEN RAISE EXCEPTION 'V437_OTHER_TENANT_MUTATED'; END IF;
END$$;
\echo V437_DISPOSABLE_PG17_TENANT_AND_VERSION_CAS_PASS
BEGIN;
UPDATE public.ksh_car02_work_orders SET state_version=state_version+1,updated_at=clock_timestamp()
  WHERE shop_code='other-shop' AND id='00000000-0000-0000-0000-000000001437' AND state_version=1;
ROLLBACK;
DO $$BEGIN
 IF (SELECT state_version FROM public.ksh_car02_work_orders WHERE id='00000000-0000-0000-0000-000000001437')<>1
 THEN RAISE EXCEPTION 'V437_ROLLBACK_FAILED'; END IF;
 IF (SELECT state_version FROM public.ksh_car02_work_orders WHERE id='00000000-0000-0000-0000-000000000437')<>2
 THEN RAISE EXCEPTION 'V437_COMMITTED_CAS_NOT_VISIBLE'; END IF;
END$$;
\echo V437_DISPOSABLE_PG17_ROLLBACK_ISOLATION_PASS

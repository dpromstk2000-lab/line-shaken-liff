-- CAR02 V4.65 DISPOSABLE POSTGRESQL 17 ONLY.
-- Creates fabricated EMPTY metadata tables. NO Supabase provider, Auth, LINE,
-- customer rows, production migrations, or externally hosted database access.
-- NEVER RUN AGAINST SHARED OR PRODUCTION DATABASE.
\set ON_ERROR_STOP on
DO $$BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
   RAISE EXCEPTION 'V465_REQUIRES_DISPOSABLE_PG17';
 END IF;
END$$;
CREATE ROLE v465_catalog_auditor NOLOGIN;
CREATE SCHEMA auth;
REVOKE ALL ON SCHEMA auth FROM PUBLIC, v465_catalog_auditor;
CREATE TABLE auth.sessions (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 created_at timestamptz NOT NULL
);
CREATE TABLE public.ksh_car02_staff_access (
 shop_code text NOT NULL,
 user_sub uuid NOT NULL,
 staff_role text NOT NULL,
 active boolean NOT NULL
);
REVOKE ALL ON TABLE auth.sessions, public.ksh_car02_staff_access FROM PUBLIC, v465_catalog_auditor;
DO $$BEGIN
 IF pg_catalog.has_table_privilege('v465_catalog_auditor','auth.sessions','SELECT') OR
    pg_catalog.has_table_privilege('v465_catalog_auditor','public.ksh_car02_staff_access','SELECT') OR
    pg_catalog.has_schema_privilege('v465_catalog_auditor','auth','USAGE') THEN
    RAISE EXCEPTION 'V465_AUTH_OR_STAFF_ROW_GRANT_LEAK';
 END IF;
END$$;
\echo V465_PG17_EMPTY_AUTH_FIXTURE_WITH_NO_ROW_READ_GRANTS_PASS
DO $$DECLARE got integer; BEGIN
 SELECT count(*) INTO got FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
 WHERE ((n.nspname='auth' AND c.relname='sessions') OR
 (n.nspname='public' AND c.relname='ksh_car02_staff_access'))
 AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped;
 IF got<>7 THEN RAISE EXCEPTION 'V465_REQUIRED_SEVEN_METADATA_FIELDS_ABSENT %',got; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
   WHERE n.nspname='auth' AND c.relname='sessions' AND
         a.attname='created_at' AND pg_catalog.format_type(a.atttypid,a.atttypmod)='timestamp with time zone')
 THEN RAISE EXCEPTION 'V465_SESSION_CREATED_AT_TYPE_NOT_EXPECTED';END IF;
END $$;
\echo V465_PG17_SEVEN_REQUIRED_COLUMNS_METADATA_READ_ONLY_PASS
BEGIN;
ALTER TABLE auth.sessions DROP COLUMN created_at;
DO $$DECLARE got integer;BEGIN
 SELECT count(*) INTO got FROM pg_catalog.pg_attribute a
 JOIN pg_catalog.pg_class c ON a.attrelid=c.oid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='auth' AND c.relname='sessions' AND a.attname='created_at'
 AND a.attnum>0 AND NOT a.attisdropped;
 IF got<>0 THEN RAISE EXCEPTION 'V465_MISSING_COLUMN_FALSE_NEGATIVE';END IF;
END$$;
ROLLBACK;
DO $$BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
 JOIN pg_catalog.pg_class c ON a.attrelid=c.oid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='auth' AND c.relname='sessions' AND a.attname='created_at'
 AND a.attnum>0 AND NOT a.attisdropped) THEN
 RAISE EXCEPTION 'V465_TAMPER_FIXTURE_TRANSACTION_NOT_ROLLED_BACK';END IF;
END$$;
\echo V465_PG17_NEGATIVE_MISSING_COLUMN_AND_ROLLBACK_PASS
-- No user data, no rows, and no authorizations are created in this fixture.
\echo V465_FINAL_RELEASE_NO_GO_HOLD_TRUE

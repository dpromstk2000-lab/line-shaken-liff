-- DPRO CAR02 R76: disposable PG17 source/restore comparison; NEVER run on production.
\set ON_ERROR_STOP on
DO $guard$
BEGIN
  IF current_database() NOT IN ('car02_qa','car02_r76_restore_qa') THEN
    RAISE EXCEPTION 'R76_DISPOSABLE_DATABASE_ONLY';
  END IF;
  IF current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'R76_POSTGRESQL17_REQUIRED';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_tables
      WHERE schemaname='public' AND tablename LIKE 'ksh_car02_%') <> 10 THEN
    RAISE EXCEPTION 'R76_EXPECTED_10_CAR02_TABLES';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_tables
      WHERE schemaname='public' AND tablename LIKE 'ksh_demo_%') <> 4 THEN
    RAISE EXCEPTION 'R76_EXPECTED_4_BASELINE_TABLES';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_tables
      WHERE schemaname='public' AND tablename LIKE 'ksh_car02_%' AND NOT rowsecurity) THEN
    RAISE EXCEPTION 'R76_RLS_NOT_ENABLED';
  END IF;
  IF EXISTS (
     SELECT 1 FROM pg_catalog.pg_tables t, (VALUES ('anon'),('authenticated')) role(role_name),
       (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) act(action_name)
     WHERE t.schemaname='public' AND t.tablename LIKE 'ksh_car02_%'
       AND has_table_privilege(role.role_name,format('%I.%I','public',t.tablename),act.action_name)
  ) THEN
    RAISE EXCEPTION 'R76_CAR02_CLIENT_GRANTS_EXPOSED';
  END IF;
  IF (SELECT count(*) FROM public.ksh_car02_staff_access WHERE user_sub='77777777-7777-4777-8777-777777777777') <> 1
     OR (SELECT count(*) FROM public.ksh_car02_staff_access_audit WHERE target_user_sub='77777777-7777-4777-8777-777777777777') <> 1 THEN
    RAISE EXCEPTION 'R76_SYNTHETIC_AUDIT_DATA_MISSING';
  END IF;
END $guard$;
CREATE TEMP TABLE r76_data_manifest(table_name text, row_count bigint, content_sha256 text) ON COMMIT PRESERVE ROWS;
DO $data$
DECLARE t record; n bigint; fingerprint text;
BEGIN
 FOR t IN SELECT schemaname,tablename FROM pg_catalog.pg_tables
    WHERE schemaname='public' AND (tablename LIKE 'ksh_demo_%' OR tablename LIKE 'ksh_car02_%')
    ORDER BY tablename
 LOOP
   EXECUTE format('SELECT count(*)::bigint,md5(coalesce(string_agg(to_jsonb(v)::text, E''\\n'' ORDER BY to_jsonb(v)::text),'''')) FROM %I.%I v',t.schemaname,t.tablename)
      INTO n,fingerprint;
   INSERT INTO r76_data_manifest VALUES(t.tablename,n,fingerprint);
 END LOOP;
END $data$;
-- All outputs are canonicalized to compare the source and restored database byte-for-byte.
SELECT 'DATA|'||table_name||'|'||row_count||'|'||content_sha256 FROM r76_data_manifest ORDER BY table_name;
SELECT 'TABLE|'||t.tablename||'|'||t.rowsecurity::text||'|'||role.role_name||'|'||act.action_name||'|'||
  has_table_privilege(role.role_name,format('%I.%I','public',t.tablename),act.action_name)::text
FROM pg_catalog.pg_tables t
CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) role(role_name)
CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) act(action_name)
WHERE t.schemaname='public' AND (t.tablename LIKE 'ksh_demo_%' OR t.tablename LIKE 'ksh_car02_%')
ORDER BY t.tablename,role.role_name,act.action_name;
SELECT 'INDEX|'||tablename||'|'||indexname||'|'||md5(indexdef) FROM pg_catalog.pg_indexes
 WHERE schemaname='public' AND (tablename LIKE 'ksh_demo_%' OR tablename LIKE 'ksh_car02_%') ORDER BY tablename,indexname;
SELECT 'CONSTRAINT|'||cl.relname||'|'||co.conname||'|'||md5(pg_get_constraintdef(co.oid,true))
 FROM pg_catalog.pg_constraint co JOIN pg_catalog.pg_class cl ON cl.oid=co.conrelid
 JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace
 WHERE ns.nspname='public' AND (cl.relname LIKE 'ksh_demo_%' OR cl.relname LIKE 'ksh_car02_%')
 ORDER BY cl.relname,co.conname;
SELECT 'TRIGGER|'||cl.relname||'|'||tr.tgname||'|'||md5(pg_get_triggerdef(tr.oid,true))
 FROM pg_catalog.pg_trigger tr JOIN pg_catalog.pg_class cl ON cl.oid=tr.tgrelid
 JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace
 WHERE ns.nspname='public' AND (cl.relname LIKE 'ksh_demo_%' OR cl.relname LIKE 'ksh_car02_%') AND NOT tr.tgisinternal
 ORDER BY cl.relname,tr.tgname;
SELECT 'POLICY|'||tablename||'|'||policyname||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') FROM pg_catalog.pg_policies
 WHERE schemaname='public' AND (tablename LIKE 'ksh_demo_%' OR tablename LIKE 'ksh_car02_%') ORDER BY tablename,policyname;
SELECT 'SEQUENCE|'||sequencename||'|'||data_type::text||'|'||start_value||'|'||increment_by
 FROM pg_catalog.pg_sequences WHERE schemaname='public' AND sequencename LIKE 'ksh_car02_%' ORDER BY sequencename;
SELECT 'FUNCTION|'||p.proname||'|'||md5(pg_get_functiondef(p.oid))
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace
 WHERE ns.nspname='public' AND p.proname LIKE 'ksh_car02_%' ORDER BY p.proname;

SELECT 'SEQUENCE_STATE|ksh_car02_staff_access_audit_id_seq|'||last_value::text||'|'||is_called::text FROM public.ksh_car02_staff_access_audit_id_seq;

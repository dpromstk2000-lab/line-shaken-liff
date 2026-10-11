#!/usr/bin/env bash
# R76 QA ONLY. Backs up and restores a disposable PostgreSQL 17 CI service; NO live access.
set -Eeuo pipefail
umask 077
fail() { printf 'R76 BLOCK: %s\n' "$*" >&2; exit 1; }
[[ "${GITHUB_ACTIONS:-}" == 'true' ]] || fail 'requires GitHub Actions'
[[ "${GITHUB_REPOSITORY:-}" == 'dpromstk2000-lab/line-shaken-liff' ]] || fail 'wrong GitHub repository'
[[ "${PGHOST:-}" == '127.0.0.1' && "${PGPORT:-}" == '5432' ]] || fail 'refuse non-loopback PostgreSQL'
[[ "${PGUSER:-}" == 'postgres' && "${PGDATABASE:-}" == 'car02_qa' ]] || fail 'refuse non-QA database/user'
[[ "${PGPASSWORD:-}" == 'qa_only_local' ]] || fail 'refuse non-QA database password'
[[ -f BASELINE_QA_ONLY.sql && -f R13_MIGRATION_QA_ONLY.sql && -f R46_STAFF_GRANTS_QA_ONLY.sql && -f R70_STAFF_PERMISSION_AUDIT_QA_ONLY.sql && -f car02-r76-database-manifest.sql ]] || fail 'missing reviewed QA files'
command -v docker >/dev/null || fail 'docker is required'
command -v sha256sum >/dev/null || fail 'sha256sum is required'
command -v cmp >/dev/null || fail 'cmp is required'
workspace="$(pwd -P)"
tmp="$(mktemp -d "${RUNNER_TEMP:-/tmp}/car02-r76-XXXXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT
# All tools run inside the exact postgres:17 container. Production hosts/credentials are never read.
pgtool() {
  docker run --rm --network host \
    -e PGHOST=127.0.0.1 -e PGPORT=5432 -e PGUSER=postgres \
    -e PGPASSWORD=qa_only_local -e PGCONNECT_TIMEOUT=5 \
    --mount "type=bind,source=${workspace},target=/repo,readonly" \
    --mount "type=bind,source=${tmp},target=/qa" \
    postgres:17 "$@"
}
# Confirm this is the dedicated, isolated PostgreSQL 17 service BEFORE any query mutates CI.
version="$(pgtool psql -X -qAt -v ON_ERROR_STOP=1 -d car02_qa -c 'SHOW server_version_num')"
[[ "$version" =~ ^[0-9]+$ ]] && (( version >= 170000 && version < 180000 )) || fail 'unexpected server version'
[[ "$(pgtool psql -X -qAt -v ON_ERROR_STOP=1 -d car02_qa -c 'SELECT current_database()')" == 'car02_qa' ]] || fail 'unexpected source DB'
[[ "$(pgtool psql -X -qAt -v ON_ERROR_STOP=1 -d car02_qa -c "SELECT COUNT(*) FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename LIKE 'ksh_car02_%'" )" == '0' ]] || fail 'source not pristine'
printf 'R76 PASS 01: disposable QA database and PostgreSQL 17 verified\n'
# Seed exactly the reviewed DPRO schema, without credentials or personal information.
for sql in BASELINE_QA_ONLY.sql R13_MIGRATION_QA_ONLY.sql R46_STAFF_GRANTS_QA_ONLY.sql R70_STAFF_PERMISSION_AUDIT_QA_ONLY.sql; do
  pgtool psql -X -q -v ON_ERROR_STOP=1 -d car02_qa -f "/repo/$sql"
done
pgtool psql -X -q -v ON_ERROR_STOP=1 -d car02_qa -c "
BEGIN;
INSERT INTO public.ksh_car02_staff_access(shop_code,user_sub,staff_role,active)
 VALUES ('street_house_kitsuki','77777777-7777-4777-8777-777777777777','staff',true);
INSERT INTO public.ksh_car02_staff_access_audit(shop_code,target_user_sub,actor_user_sub,before_role,before_active,after_role,after_active,reason)
 VALUES ('street_house_kitsuki','77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999','staff',false,'staff',true,'R76 synthetic restore-only audit');
COMMIT;"
printf 'R76 PASS 02: reviewed QA schemas and synthetic staff audit data loaded\n'
pgtool psql -X -qAt -v ON_ERROR_STOP=1 -d car02_qa -f /repo/car02-r76-database-manifest.sql > "$tmp/source.manifest"
[[ $(grep -c '^DATA|' "$tmp/source.manifest") == 14 ]] || fail 'source manifest table count mismatch'
printf 'R76 PASS 03: source RLS, ACLs, constraints, audit and data manifest verified\n'
# Real custom-format PostgreSQL backup; kept only on the ephemeral Actions runner.
pgtool pg_dump -Fc --no-password -d car02_qa -f /qa/car02-r76.backup
[[ -s "$tmp/car02-r76.backup" ]] || fail 'backup is empty'
sha256sum "$tmp/car02-r76.backup" > "$tmp/car02-r76.sha256"
(cd "$tmp" && sha256sum -c car02-r76.sha256 >/dev/null)
pgtool pg_restore -l /qa/car02-r76.backup > "$tmp/toc.txt"
for needed in ksh_car02_work_orders ksh_car02_staff_access ksh_car02_staff_access_audit ksh_demo_customers; do
 grep -F "$needed" "$tmp/toc.txt" >/dev/null || fail "missing in pg_dump: $needed"
done
printf 'R76 PASS 04: pg_dump custom archive created, checksummed, and TOC verified\n'
# Restore into a NEW, otherwise empty test DB. No --clean and no source drop possible.
pgtool createdb --no-password car02_r76_restore_qa
pgtool pg_restore --no-password --exit-on-error --single-transaction -d car02_r76_restore_qa /qa/car02-r76.backup
pgtool psql -X -qAt -v ON_ERROR_STOP=1 -d car02_r76_restore_qa -f /repo/car02-r76-database-manifest.sql > "$tmp/restored.manifest"
cmp -s "$tmp/source.manifest" "$tmp/restored.manifest" || {
  diff -u "$tmp/source.manifest" "$tmp/restored.manifest" | head -80 >&2 || true
  fail 'restored data/schema/security does not match source'
}
printf 'R76 PASS 05: pg_restore matches source data, roles, RLS, indexes, triggers, constraints and audit\n'
# Check the SOURCE did not change during backup and restore.
pgtool psql -X -qAt -v ON_ERROR_STOP=1 -d car02_qa -f /repo/car02-r76-database-manifest.sql > "$tmp/source-after.manifest"
cmp -s "$tmp/source.manifest" "$tmp/source-after.manifest" || fail 'source changed during restore'
printf 'R76 PASS 06: source database unchanged after backup/restore rehearsal\n'
printf 'R76 BACKUP + RESTORE: 6/6 PASS; synthetic local CI ONLY; real Supabase backup and restore NOT VERIFIED\n'

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$repo_root/tests/apple/postgres"
up="$repo_root/supabase/migrations/20260722010000_apple_entitlement_ledger_phase_1a.sql"
down="$repo_root/supabase/rollbacks/20260722010000_apple_entitlement_ledger_phase_1a_down.sql"
preflight="$repo_root/supabase/verification/20260722010000_apple_entitlement_production_preflight.sql"
postflight="$repo_root/supabase/verification/20260722010000_apple_entitlement_postflight.sql"
rollback_preflight="$repo_root/supabase/verification/20260722010000_apple_entitlement_rollback_preflight.sql"
approval="ROLLBACK_SAFE:5e03dc81ec469c469ccdfe47681e81dff9059e0dc894336c5360e69b93f687d4"

find_pg_binary() {
  local name="$1"
  if [[ -n "${POSTGRES_BIN:-}" && -x "$POSTGRES_BIN/$name" ]]; then
    printf '%s\n' "$POSTGRES_BIN/$name"
    return
  fi
  return 1
}

missing=()
for binary in initdb pg_ctl createdb psql postgres; do
  if ! path="$(find_pg_binary "$binary")"; then
    missing+=("$binary")
  else
    case "$binary" in
      initdb) PG_INITDB="$path" ;;
      pg_ctl) PG_PG_CTL="$path" ;;
      createdb) PG_CREATEDB="$path" ;;
      psql) PG_PSQL="$path" ;;
      postgres) PG_POSTGRES="$path" ;;
    esac
  fi
done
if ((${#missing[@]})); then
  echo "ERROR: PostgreSQL 17 binaries required via POSTGRES_BIN (${missing[*]} missing)." >&2
  exit 2
fi

version="$($PG_POSTGRES --version)"
major="$(sed -E 's/.* ([0-9]+).*/\1/' <<<"$version")"
smoke_only=0
if [[ "$major" != 17 && "${APPLE_READINESS_ALLOW_NON17_SMOKE:-0}" != 1 ]]; then
  echo "ERROR: exact PostgreSQL major 17 required; found $version" >&2
  exit 2
elif [[ "$major" != 17 ]]; then
  smoke_only=1
  echo "WARNING: non-PG17 syntax smoke only on $version; this cannot satisfy readiness." >&2
fi

work_dir="$(mktemp -d "/tmp/cipmusic-apple-pg17.XXXXXX")"
data_dir="$work_dir/data"
socket_dir="$work_dir/socket"
log_dir="$work_dir/logs"
mkdir -p "$socket_dir" "$log_dir"
server_started=0
success=0
start_epoch="$(date +%s)"

cleanup() {
  local rc=$?
  if ((server_started)); then "$PG_PG_CTL" -D "$data_dir" -m fast stop >/dev/null 2>&1 || true; fi
  if ((success)); then
    find "$work_dir" -type f -delete 2>/dev/null || true
    find "$work_dir" -depth -type d -empty -delete 2>/dev/null || true
  else
    echo "PG17 readiness test failed; sanitized logs retained at: $log_dir" >&2
  fi
  exit "$rc"
}
trap cleanup EXIT INT TERM

"$PG_INITDB" -D "$data_dir" --auth-local=trust --auth-host=reject --no-locale --encoding=UTF8 >"$log_dir/initdb.log" 2>&1
{
  echo "listen_addresses = ''"
  echo "unix_socket_directories = '$socket_dir'"
  echo "port = 55440"
  echo "log_min_messages = warning"
  echo "log_statement = 'none'"
} >>"$data_dir/postgresql.conf"
"$PG_PG_CTL" -D "$data_dir" -l "$log_dir/postgres.log" start >/dev/null
server_started=1
export PGHOST="$socket_dir" PGPORT=55440 PGUSER="$(id -un)"

schema_fingerprint_sql="select md5(coalesce(string_agg(format('%s:%s:%s:%s:%s',ordinal_position,column_name,data_type,is_nullable,coalesce(column_default,'')),'|' order by ordinal_position),'')) from information_schema.columns where table_schema='public' and table_name='user_membership'"
payment_fingerprint_sql="select md5(coalesce(string_agg(format('%s:%s:%s:%s',n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner)),'|' order by n.nspname,c.relname),'')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and (c.relname='user_membership' or c.relname='membership_orders' or c.relname like '%stripe%' or c.relname like '%google_play%' or c.relname like '%zpay%')"
payment_function_fingerprint_sql="select md5(coalesce(string_agg(format('%s:%s:%s',n.nspname,p.oid::regprocedure::text,pg_get_userbyid(p.proowner)),'|' order by n.nspname,p.oid::regprocedure::text),'')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%stripe%' or p.proname like '%google_play%' or p.proname like '%zpay%' or p.proname like '%membership%')"

bootstrap_db() {
  local db="$1"
  "$PG_CREATEDB" "$db"
  "$PG_PSQL" "postgresql:///$db" -X -v ON_ERROR_STOP=1 -f "$test_root/readiness-bootstrap.sql" >"$log_dir/$db-bootstrap.log" 2>&1
}

baseline_vars() {
  local db="$1"
  baseline_rows="$($PG_PSQL "postgresql:///$db" -X -Atqc 'select count(*) from public.user_membership')"
  baseline_schema="$($PG_PSQL "postgresql:///$db" -X -Atqc "$schema_fingerprint_sql")"
  baseline_payment="$($PG_PSQL "postgresql:///$db" -X -Atqc "$payment_fingerprint_sql")"
  baseline_payment_functions="$($PG_PSQL "postgresql:///$db" -X -Atqc "$payment_function_fingerprint_sql")"
}

run_preflight() {
  local db="$1" output="$2"
  "$PG_PSQL" "postgresql:///$db" -X -v ON_ERROR_STOP=1 \
    -v expected_project_ref=hngtwkayovuxhiqustsa \
    -v expected_database="$db" -v expected_role="$PGUSER" \
    -v external_apple_flags_off=1 -f "$preflight" >"$output" 2>&1
  if ((smoke_only)); then
    grep -q 'MIGRATION_PREFLIGHT_NO_GO' "$output"
    grep -q 'postgresql_17' "$output"
  else
    grep -q 'MIGRATION_PREFLIGHT_GO' "$output"
  fi
}

record_migration() {
  local db="$1"
  "$PG_PSQL" "postgresql:///$db" -X -v ON_ERROR_STOP=1 -c \
    "insert into supabase_migrations.schema_migrations(version,name) values ('20260722010000','apple_entitlement_ledger_phase_1a')" >/dev/null
}

run_postflight() {
  local db="$1" output="$2"
  "$PG_PSQL" "postgresql:///$db" -X -v ON_ERROR_STOP=1 \
    -v expected_user_membership_rows="$baseline_rows" \
    -v expected_user_membership_schema_fingerprint="$baseline_schema" \
    -v expected_payment_object_fingerprint="$baseline_payment" \
    -v expected_payment_function_fingerprint="$baseline_payment_functions" \
    -f "$postflight" >"$output" 2>&1
  grep -q 'MIGRATION_POSTFLIGHT_PASS' "$output"
}

lifecycle_db=apple_phase1a_readiness
bootstrap_db "$lifecycle_db"
baseline_vars "$lifecycle_db"
run_preflight "$lifecycle_db" "$log_dir/preflight.log"

up_start="$(date +%s)"
"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 -f "$up" >"$log_dir/up-1.log" 2>&1
up_end="$(date +%s)"
record_migration "$lifecycle_db"
run_postflight "$lifecycle_db" "$log_dir/postflight-1.log"

"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 -f "$rollback_preflight" >"$log_dir/rollback-preflight-safe.log" 2>&1
grep -q 'ROLLBACK_SAFE' "$log_dir/rollback-preflight-safe.log"
down_start="$(date +%s)"
"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 \
  -c "set app.phase1a_rollback_approval='$approval'" -f "$down" >"$log_dir/down.log" 2>&1
down_end="$(date +%s)"

remaining="$($PG_PSQL "postgresql:///$lifecycle_db" -X -Atqc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('billing_runtime_controls','app_store_entitlements','app_store_transactions','app_store_notification_events','app_store_binding_tombstones','billing_entitlements_v2','billing_account_deletion_requests','billing_account_deletion_fences')")"
[[ "$remaining" == 0 ]]
[[ "$($PG_PSQL "postgresql:///$lifecycle_db" -X -Atqc 'select membership_status from public.user_membership limit 1')" == premium ]]

# Local harness emulation only: the real runbook requires `supabase migration repair
# --status reverted 20260722010000` after the down transaction succeeds.
"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 -c \
  "delete from supabase_migrations.schema_migrations where version='20260722010000'" >/dev/null
run_preflight "$lifecycle_db" "$log_dir/preflight-2.log"
"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 -f "$up" >"$log_dir/up-2.log" 2>&1
record_migration "$lifecycle_db"
run_postflight "$lifecycle_db" "$log_dir/postflight-2.log"

# Any business data must make both the decision report and the down migration fail.
"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 -c \
  "insert into public.app_store_notification_events(environment,endpoint_environment,notification_uuid,notification_type,signed_date,payload_hash) values ('sandbox','sandbox','30000000-0000-4000-8000-000000000001','TEST',now(),repeat('a',64))" >/dev/null
"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 -f "$rollback_preflight" >"$log_dir/rollback-preflight-data.log" 2>&1
grep -q 'ROLLBACK_UNSAFE' "$log_dir/rollback-preflight-data.log"
set +e
"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 \
  -c "set app.phase1a_rollback_approval='$approval'" -f "$down" >"$log_dir/down-data-rejection.log" 2>&1
data_down_rc=$?
set -e
[[ "$data_down_rc" -ne 0 ]]
grep -q 'PHASE1A_BUSINESS_DATA_PRESENT' "$log_dir/down-data-rejection.log"

# A current flag must independently block rollback.
flag_db=apple_phase1a_flag_rejection
bootstrap_db "$flag_db"
"$PG_PSQL" "postgresql:///$flag_db" -X -v ON_ERROR_STOP=1 -f "$up" >"$log_dir/flag-up.log" 2>&1
record_migration "$flag_db"
"$PG_PSQL" "postgresql:///$flag_db" -X -v ON_ERROR_STOP=1 -c \
  "update public.billing_runtime_controls set apple_verification_enabled=true,updated_by='synthetic-test'" >/dev/null
"$PG_PSQL" "postgresql:///$flag_db" -X -v ON_ERROR_STOP=1 -f "$rollback_preflight" >"$log_dir/rollback-preflight-flag.log" 2>&1
grep -q 'ROLLBACK_UNSAFE' "$log_dir/rollback-preflight-flag.log"
set +e
"$PG_PSQL" "postgresql:///$flag_db" -X -v ON_ERROR_STOP=1 \
  -c "set app.phase1a_rollback_approval='$approval'" -f "$down" >"$log_dir/down-flag-rejection.log" 2>&1
flag_down_rc=$?
set -e
[[ "$flag_down_rc" -ne 0 ]]
grep -q 'PHASE1A_RUNTIME_CONTROLS_NOT_PRISTINE' "$log_dir/down-flag-rejection.log"

# Run the existing RPC/RLS/replay/concurrency suite on the same PG17 binaries.
POSTGRES_BIN="$POSTGRES_BIN" "$repo_root/scripts/test-apple-postgres-integration.sh" >"$log_dir/existing-integration.log" 2>&1

end_epoch="$(date +%s)"
up_seconds=$((up_end-up_start))
down_seconds=$((down_end-down_start))
success=1
if ((smoke_only)); then
  echo "SMOKE PASS ONLY: $version (PostgreSQL 17 run is still required)"
else
  echo "PASS: $version readiness suite"
fi
echo "PASS: preflight -> up -> postflight -> rollback preflight -> down -> up -> postflight"
echo "PASS: data-present rollback rejected"
echo "PASS: feature-flag rollback rejected"
echo "PASS: synthetic user_membership/Stripe-ZPay/Google Play objects preserved"
echo "PASS: existing RPC/RLS/idempotency/concurrency suite"
echo "TIMING: up=${up_seconds}s down=${down_seconds}s total=$((end_epoch-start_epoch))s"

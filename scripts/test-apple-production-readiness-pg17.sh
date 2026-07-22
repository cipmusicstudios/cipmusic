#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$repo_root/tests/apple/postgres"
up="$repo_root/supabase/migrations/20260722010000_apple_entitlement_ledger_phase_1a.sql"
down="$repo_root/supabase/rollbacks/20260722010000_apple_entitlement_ledger_phase_1a_down.sql"
preflight="$repo_root/supabase/verification/20260722010000_apple_entitlement_production_preflight.sql"
postflight="$repo_root/supabase/verification/20260722010000_apple_entitlement_postflight.sql"
rollback_preflight="$repo_root/supabase/verification/20260722010000_apple_entitlement_rollback_preflight.sql"
manifest="$repo_root/supabase/verification/20260722010000_apple_entitlement_manifest.sql"
manifest_sha="f2d2208f2b2c20fbe24b1e139a85e462609623b52e7af525063ffa12e4cc3a5a"
up_sha="5e03dc81ec469c469ccdfe47681e81dff9059e0dc894336c5360e69b93f687d4"

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
payment_data_fingerprint_sql="select md5(string_agg(x,'|' order by x)) from (select 'user_membership:'||to_jsonb(t)::text x from public.user_membership t union all select 'membership_orders:'||to_jsonb(t)::text from public.membership_orders t union all select 'google_play:'||to_jsonb(t)::text from public.membership_google_play_purchases t union all select 'stripe:'||to_jsonb(t)::text from public.membership_stripe_subscriptions t) s"

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
  baseline_payment_data="$($PG_PSQL "postgresql:///$db" -X -Atqc "$payment_data_fingerprint_sql")"
}

assert_payment_data() {
  local db="$1"
  [[ "$($PG_PSQL "postgresql:///$db" -X -Atqc "$payment_data_fingerprint_sql")" == "$baseline_payment_data" ]]
}

approval_for() {
  printf 'PHASE1A_DOWN_ACK|version=20260722010000|up_sha=%s|database=%s|manifest_sha=%s' "$up_sha" "$1" "$manifest_sha"
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

run_preflight_nogo() {
  local db="$1" output="$2" reason="$3"
  "$PG_PSQL" "postgresql:///$db" -X -v ON_ERROR_STOP=1 \
    -v expected_project_ref=hngtwkayovuxhiqustsa -v expected_database="$db" \
    -v expected_role="$PGUSER" -v external_apple_flags_off=1 \
    -f "$preflight" >"$output" 2>&1
  grep -q 'MIGRATION_PREFLIGHT_NO_GO' "$output"
  grep -q "$reason" "$output"
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

run_postflight_fail() {
  local db="$1" output="$2"
  "$PG_PSQL" "postgresql:///$db" -X -v ON_ERROR_STOP=1 \
    -v expected_user_membership_rows="$baseline_rows" \
    -v expected_user_membership_schema_fingerprint="$baseline_schema" \
    -v expected_payment_object_fingerprint="$baseline_payment" \
    -v expected_payment_function_fingerprint="$baseline_payment_functions" \
    -f "$postflight" >"$output" 2>&1
  grep -q 'MIGRATION_POSTFLIGHT_FAIL' "$output"
  grep -q 'frozen_manifest' "$output"
}

assert_phase1a_present() {
  local db="$1"
  [[ "$($PG_PSQL "postgresql:///$db" -X -Atqc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('billing_runtime_controls','app_store_entitlements','app_store_transactions','app_store_notification_events','app_store_binding_tombstones','billing_entitlements_v2','billing_account_deletion_requests','billing_account_deletion_fences')")" == 8 ]]
}

manifest_rejection() {
  local label="$1" mutation="$2" db="apple_manifest_$1"
  bootstrap_db "$db"
  baseline_vars "$db"
  "$PG_PSQL" "postgresql:///$db" -X -v ON_ERROR_STOP=1 -f "$up" >"$log_dir/$label-up.log" 2>&1
  record_migration "$db"
  "$PG_PSQL" "postgresql:///$db" -X -v ON_ERROR_STOP=1 -c "$mutation" >"$log_dir/$label-mutate.log" 2>&1
  run_postflight_fail "$db" "$log_dir/$label-postflight.log"
  "$PG_PSQL" "postgresql:///$db" -X -v ON_ERROR_STOP=1 -v external_flag_history_verified=1 \
    -f "$rollback_preflight" >"$log_dir/$label-rollback-preflight.log" 2>&1
  grep -q 'ROLLBACK_REQUIRES_MANUAL_REVIEW' "$log_dir/$label-rollback-preflight.log"
  set +e
  "$PG_PSQL" "postgresql:///$db" -X -v ON_ERROR_STOP=1 \
    -c "set app.phase1a_rollback_approval='$(approval_for "$db")'" -f "$down" >"$log_dir/$label-down.log" 2>&1
  local rc=$?
  set -e
  [[ "$rc" -ne 0 ]]
  grep -q 'PHASE1A_MANIFEST_MISMATCH' "$log_dir/$label-down.log"
  assert_phase1a_present "$db"
  assert_payment_data "$db"
}

# Migration history is mandatory and structurally/readably valid. Every missing
# or already-applied variant must produce an explicit NO_GO, never NULL/GO.
for history_case in schema table structure target; do
  history_db="apple_history_$history_case"
  bootstrap_db "$history_db"
  case "$history_case" in
    schema) "$PG_PSQL" -d "$history_db" -X -v ON_ERROR_STOP=1 -c 'drop schema supabase_migrations cascade' >/dev/null ; reason=migration_history_schema ;;
    table) "$PG_PSQL" -d "$history_db" -X -v ON_ERROR_STOP=1 -c 'drop table supabase_migrations.schema_migrations' >/dev/null ; reason=migration_history_table ;;
    structure) "$PG_PSQL" -d "$history_db" -X -v ON_ERROR_STOP=1 -c 'alter table supabase_migrations.schema_migrations rename column version to broken_version' >/dev/null ; reason=migration_history_structure ;;
    target) record_migration "$history_db"; reason=target_version_absent ;;
  esac
  run_preflight_nogo "$history_db" "$log_dir/history-$history_case.log" "$reason"
done

# Same-count and property-only catalog mutations must all change the frozen
# manifest and therefore fail postflight, rollback preflight and the down guard.
manifest_rejection column_default "alter table public.billing_runtime_controls alter column aggregate_mode set default 'shadow'"
manifest_rejection constraint "alter table public.app_store_entitlements drop constraint app_store_entitlements_environment_match; alter table public.app_store_entitlements add constraint app_store_entitlements_environment_match check (true)"
manifest_rejection index "drop index public.app_store_entitlements_status_idx; create index app_store_entitlements_status_idx on public.app_store_entitlements(user_id)"
manifest_rejection function_body "create or replace function public.billing_v2_set_updated_at() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as \$\$begin new.updated_at=clock_timestamp(); return new; end\$\$"
manifest_rejection function_security "alter function public.billing_get_runtime_controls() security invoker"
manifest_rejection function_search_path "alter function public.billing_get_runtime_controls() set search_path=public"
manifest_rejection trigger "alter table public.billing_runtime_controls disable trigger billing_runtime_controls_set_updated_at"
manifest_rejection acl "grant select on public.billing_runtime_controls to anon"
manifest_rejection force_rls "alter table public.billing_runtime_controls force row level security"
manifest_rejection policy "create policy synthetic_policy on public.billing_runtime_controls for select to anon using (true)"

# The approved schema intentionally has zero policies and zero anon table ACLs,
# so also prove that swaps between two equally-sized unexpected states are
# fingerprinted (not merely their counts).
acl_before="$($PG_PSQL -d apple_manifest_acl -X -f "$manifest" -Atc 'select pg_temp.phase1a_manifest_sha256()' | tail -1)"
"$PG_PSQL" -d apple_manifest_acl -X -v ON_ERROR_STOP=1 -c 'revoke select on public.billing_runtime_controls from anon; grant update on public.billing_runtime_controls to anon' >/dev/null
acl_after="$($PG_PSQL -d apple_manifest_acl -X -f "$manifest" -Atc 'select pg_temp.phase1a_manifest_sha256()' | tail -1)"
[[ "$acl_before" != "$acl_after" ]]
policy_before="$($PG_PSQL -d apple_manifest_policy -X -f "$manifest" -Atc 'select pg_temp.phase1a_manifest_sha256()' | tail -1)"
"$PG_PSQL" -d apple_manifest_policy -X -v ON_ERROR_STOP=1 -c 'drop policy synthetic_policy on public.billing_runtime_controls; create policy replacement_policy on public.billing_runtime_controls for update to authenticated using (singleton) with check (singleton)' >/dev/null
policy_after="$($PG_PSQL -d apple_manifest_policy -X -f "$manifest" -Atc 'select pg_temp.phase1a_manifest_sha256()' | tail -1)"
[[ "$policy_before" != "$policy_after" ]]

lifecycle_db=apple_phase1a_readiness
bootstrap_db "$lifecycle_db"
baseline_vars "$lifecycle_db"
run_preflight "$lifecycle_db" "$log_dir/preflight.log"

up_start="$(date +%s)"
"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 -f "$up" >"$log_dir/up-1.log" 2>&1
up_end="$(date +%s)"
record_migration "$lifecycle_db"
run_postflight "$lifecycle_db" "$log_dir/postflight-1.log"

# No external immutable history proof means MANUAL_REVIEW even when current
# values look pristine. A reset statistics epoch is also never SAFE.
"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 -f "$rollback_preflight" >"$log_dir/rollback-preflight-no-history-proof.log" 2>&1
grep -q 'ROLLBACK_REQUIRES_MANUAL_REVIEW' "$log_dir/rollback-preflight-no-history-proof.log"

# Approval is an exact acknowledgement tuple, not a reusable static password.
for approval_case in missing old wrong_database wrong_up_sha wrong_manifest; do
  case "$approval_case" in
    missing) candidate='' ;;
    old) candidate="ROLLBACK_SAFE:$up_sha" ;;
    wrong_database) candidate="$(approval_for wrong_database)" ;;
    wrong_up_sha) candidate="$(approval_for "$lifecycle_db")"; candidate="${candidate/$up_sha/0000000000000000000000000000000000000000000000000000000000000000}" ;;
    wrong_manifest) candidate="$(approval_for "$lifecycle_db")"; candidate="${candidate/$manifest_sha/0000000000000000000000000000000000000000000000000000000000000000}" ;;
  esac
  set +e
  if [[ -n "$candidate" ]]; then
    "$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 -c "set app.phase1a_rollback_approval='$candidate'" -f "$down" >"$log_dir/approval-$approval_case.log" 2>&1
  else
    "$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 -f "$down" >"$log_dir/approval-$approval_case.log" 2>&1
  fi
  approval_rc=$?
  set -e
  [[ "$approval_rc" -ne 0 ]]
  grep -q 'PHASE1A_ROLLBACK_APPROVAL_REQUIRED' "$log_dir/approval-$approval_case.log"
  assert_phase1a_present "$lifecycle_db"
done

"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 -v external_flag_history_verified=1 -f "$rollback_preflight" >"$log_dir/rollback-preflight-safe.log" 2>&1
grep -q 'ROLLBACK_SAFE' "$log_dir/rollback-preflight-safe.log"
assert_payment_data "$lifecycle_db"
down_start="$(date +%s)"
"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 \
  -c "set app.phase1a_rollback_approval='$(approval_for "$lifecycle_db")'" -f "$down" >"$log_dir/down.log" 2>&1
down_end="$(date +%s)"

remaining="$($PG_PSQL "postgresql:///$lifecycle_db" -X -Atqc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('billing_runtime_controls','app_store_entitlements','app_store_transactions','app_store_notification_events','app_store_binding_tombstones','billing_entitlements_v2','billing_account_deletion_requests','billing_account_deletion_fences')")"
[[ "$remaining" == 0 ]]
[[ "$($PG_PSQL "postgresql:///$lifecycle_db" -X -Atqc 'select membership_status from public.user_membership limit 1')" == premium ]]
assert_payment_data "$lifecycle_db"

# Local harness emulation only: the real runbook requires `supabase migration repair
# --status reverted 20260722010000` after the down transaction succeeds.
"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 -c \
  "delete from supabase_migrations.schema_migrations where version='20260722010000'" >/dev/null
run_preflight "$lifecycle_db" "$log_dir/preflight-2.log"
"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 -f "$up" >"$log_dir/up-2.log" 2>&1
record_migration "$lifecycle_db"
run_postflight "$lifecycle_db" "$log_dir/postflight-2.log"
assert_payment_data "$lifecycle_db"

# Any business data must make both the decision report and the down migration fail.
"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 -c \
  "insert into public.app_store_notification_events(environment,endpoint_environment,notification_uuid,notification_type,signed_date,payload_hash) values ('sandbox','sandbox','30000000-0000-4000-8000-000000000001','TEST',now(),repeat('a',64))" >/dev/null
"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 -v external_flag_history_verified=1 -f "$rollback_preflight" >"$log_dir/rollback-preflight-data.log" 2>&1
grep -q 'ROLLBACK_UNSAFE' "$log_dir/rollback-preflight-data.log"
set +e
"$PG_PSQL" "postgresql:///$lifecycle_db" -X -v ON_ERROR_STOP=1 \
  -c "set app.phase1a_rollback_approval='$(approval_for "$lifecycle_db")'" -f "$down" >"$log_dir/down-data-rejection.log" 2>&1
data_down_rc=$?
set -e
[[ "$data_down_rc" -ne 0 ]]
grep -q 'PHASE1A_BUSINESS_DATA_PRESENT' "$log_dir/down-data-rejection.log"
assert_payment_data "$lifecycle_db"

# A current flag must independently block rollback.
flag_db=apple_phase1a_flag_rejection
bootstrap_db "$flag_db"
"$PG_PSQL" "postgresql:///$flag_db" -X -v ON_ERROR_STOP=1 -f "$up" >"$log_dir/flag-up.log" 2>&1
record_migration "$flag_db"
"$PG_PSQL" "postgresql:///$flag_db" -X -v ON_ERROR_STOP=1 -c \
  "update public.billing_runtime_controls set apple_verification_enabled=true,updated_by='synthetic-test'" >/dev/null
"$PG_PSQL" "postgresql:///$flag_db" -X -v ON_ERROR_STOP=1 -v external_flag_history_verified=1 -f "$rollback_preflight" >"$log_dir/rollback-preflight-flag.log" 2>&1
grep -q 'ROLLBACK_UNSAFE' "$log_dir/rollback-preflight-flag.log"
set +e
"$PG_PSQL" "postgresql:///$flag_db" -X -v ON_ERROR_STOP=1 \
  -c "set app.phase1a_rollback_approval='$(approval_for "$flag_db")'" -f "$down" >"$log_dir/down-flag-rejection.log" 2>&1
flag_down_rc=$?
set -e
[[ "$flag_down_rc" -ne 0 ]]
grep -q 'PHASE1A_RUNTIME_CONTROLS_NOT_PRISTINE' "$log_dir/down-flag-rejection.log"

# Flags toggled back off and updated_by cleared are still historical activity.
history_flag_db=apple_phase1a_flag_history
bootstrap_db "$history_flag_db"
"$PG_PSQL" -d "$history_flag_db" -X -v ON_ERROR_STOP=1 -f "$up" >"$log_dir/history-flag-up.log" 2>&1
record_migration "$history_flag_db"
"$PG_PSQL" -d "$history_flag_db" -X -v ON_ERROR_STOP=1 -c "update public.billing_runtime_controls set apple_verification_enabled=true,updated_by='synthetic'; update public.billing_runtime_controls set apple_verification_enabled=false,updated_by=null" >/dev/null
"$PG_PSQL" -d "$history_flag_db" -X -v ON_ERROR_STOP=1 -v external_flag_history_verified=1 -f "$rollback_preflight" >"$log_dir/history-flag-off.log" 2>&1
grep -q 'ROLLBACK_REQUIRES_MANUAL_REVIEW' "$log_dir/history-flag-off.log"
"$PG_PSQL" -d "$history_flag_db" -X -v ON_ERROR_STOP=1 -c 'select pg_stat_reset()' >/dev/null
"$PG_PSQL" -d "$history_flag_db" -X -v ON_ERROR_STOP=1 -v external_flag_history_verified=1 -f "$rollback_preflight" >"$log_dir/history-stats-reset.log" 2>&1
grep -q 'ROLLBACK_REQUIRES_MANUAL_REVIEW' "$log_dir/history-stats-reset.log"

# The data fingerprint is over every column and stable JSON ordering. Prove an
# intentional legacy payment mutation is detected without printing row values.
fingerprint_db=apple_payment_fingerprint
bootstrap_db "$fingerprint_db"
baseline_vars "$fingerprint_db"
"$PG_PSQL" -d "$fingerprint_db" -X -v ON_ERROR_STOP=1 -c 'update public.membership_orders set amount_cents=amount_cents+1' >/dev/null
if assert_payment_data "$fingerprint_db"; then
  echo 'ERROR: intentional payment mutation escaped fingerprint' >&2
  exit 1
fi

# Dual-session race A/C/D: rollback locks first, then writes to a ledger table,
# runtime controls, and Apple membership writeback all time out. The blocked
# change is never silently accepted before the successful down transaction.
lock_list="public.billing_runtime_controls,public.app_store_entitlements,public.app_store_transactions,public.app_store_notification_events,public.app_store_binding_tombstones,public.billing_entitlements_v2,public.billing_account_deletion_requests,public.billing_account_deletion_fences,public.user_membership"
for race_case in ledger controls membership; do
  race_db="apple_race_$race_case"
  bootstrap_db "$race_db"
  baseline_vars "$race_db"
  "$PG_PSQL" -d "$race_db" -X -v ON_ERROR_STOP=1 -f "$up" >"$log_dir/race-$race_case-up.log" 2>&1
  record_migration "$race_db"
  "$PG_PSQL" -d "$race_db" -X -v ON_ERROR_STOP=1 \
    -c "begin; lock table $lock_list in access exclusive mode; select pg_sleep(2); set local app.phase1a_rollback_approval='$(approval_for "$race_db")'" \
    -f "$down" >"$log_dir/race-$race_case-down.log" 2>&1 &
  down_pid=$!
  sleep 0.5
  case "$race_case" in
    ledger) race_sql="insert into public.app_store_notification_events(environment,endpoint_environment,notification_uuid,notification_type,signed_date,payload_hash) values ('sandbox','sandbox','40000000-0000-4000-8000-000000000001','RACE',now(),repeat('b',64))" ;;
    controls) race_sql="update public.billing_runtime_controls set apple_verification_enabled=true" ;;
    membership) race_sql="update public.user_membership set payment_provider='apple'" ;;
  esac
  set +e
  "$PG_PSQL" -d "$race_db" -X -v ON_ERROR_STOP=1 -c "set lock_timeout='500ms'; $race_sql" >"$log_dir/race-$race_case-writer.log" 2>&1
  writer_rc=$?
  set -e
  [[ "$writer_rc" -ne 0 ]]
  grep -q 'lock timeout' "$log_dir/race-$race_case-writer.log"
  wait "$down_pid"
  assert_payment_data "$race_db"
done

# Dual-session race B: a writer holding the lock first makes the real down hit
# its bounded lock_timeout. The writer commits; the entire schema and row remain.
writer_db=apple_race_writer_first
bootstrap_db "$writer_db"
baseline_vars "$writer_db"
"$PG_PSQL" -d "$writer_db" -X -v ON_ERROR_STOP=1 -f "$up" >"$log_dir/race-writer-up.log" 2>&1
record_migration "$writer_db"
"$PG_PSQL" -d "$writer_db" -X -v ON_ERROR_STOP=1 -c "begin; insert into public.app_store_notification_events(environment,endpoint_environment,notification_uuid,notification_type,signed_date,payload_hash) values ('sandbox','sandbox','50000000-0000-4000-8000-000000000001','WRITER_FIRST',now(),repeat('c',64)); select pg_sleep(6); commit" >"$log_dir/race-writer-session.log" 2>&1 &
writer_pid=$!
sleep 0.5
set +e
"$PG_PSQL" -d "$writer_db" -X -v ON_ERROR_STOP=1 -c "set app.phase1a_rollback_approval='$(approval_for "$writer_db")'" -f "$down" >"$log_dir/race-writer-down.log" 2>&1
writer_down_rc=$?
set -e
[[ "$writer_down_rc" -ne 0 ]]
grep -q 'lock timeout' "$log_dir/race-writer-down.log"
wait "$writer_pid"
assert_phase1a_present "$writer_db"
[[ "$($PG_PSQL -d "$writer_db" -X -Atqc "select count(*) from public.app_store_notification_events where notification_type='WRITER_FIRST'")" == 1 ]]

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
echo "PASS: frozen manifest drift matrix and approval binding rejected"
echo "PASS: migration-history NO_GO matrix and flag-history ambiguity"
echo "PASS: dual-session rollback races A-D"
echo "PASS: synthetic user_membership/Stripe-ZPay/Google Play objects preserved"
echo "PASS: existing RPC/RLS/idempotency/concurrency suite"
echo "TIMING: up=${up_seconds}s down=${down_seconds}s total=$((end_epoch-start_epoch))s"

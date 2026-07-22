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
manifest_sha="8ea409d5d99b0dfb65049e8b4ee1fb776b3f16bc992b32a1bac33530d7e4b88e"
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
payment_data_snapshot_sql="select table_name||':'||row_count||':'||fingerprint from (select 'user_membership' table_name,count(*) row_count,md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) fingerprint from public.user_membership t union all select 'membership_orders',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.membership_orders t union all select 'membership_google_play_purchases',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.membership_google_play_purchases t union all select 'membership_stripe_subscriptions',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.membership_stripe_subscriptions t) snapshots order by table_name"
phase1a_data_snapshot_sql="select table_name||':'||row_count||':'||fingerprint from (select 'app_store_entitlements' table_name,count(*) row_count,md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) fingerprint from public.app_store_entitlements t union all select 'app_store_transactions',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.app_store_transactions t union all select 'app_store_notification_events',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.app_store_notification_events t union all select 'app_store_binding_tombstones',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.app_store_binding_tombstones t union all select 'billing_entitlements_v2',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.billing_entitlements_v2 t union all select 'billing_account_deletion_requests',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.billing_account_deletion_requests t union all select 'billing_account_deletion_fences',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.billing_account_deletion_fences t) snapshots order by table_name"

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
  baseline_payment_data="$($PG_PSQL "postgresql:///$db" -X -Atqc "$payment_data_snapshot_sql")"
}

assert_payment_data() {
  local db="$1"
  [[ "$($PG_PSQL "postgresql:///$db" -X -Atqc "$payment_data_snapshot_sql")" == "$baseline_payment_data" ]]
}

payment_table_count() {
  "$PG_PSQL" -d "$1" -X -Atqc "select count(*) from public.$2"
}

payment_table_hash() {
  "$PG_PSQL" -d "$1" -X -Atqc "select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.$2 t"
}

phase1a_manifest_sha() {
  "$PG_PSQL" -d "$1" -X -f "$manifest" -Atc 'select pg_temp.phase1a_manifest_sha256()' | tail -1
}

run_attested_down() {
  local db="$1" output="$2"
  "$PG_PSQL" -d "$db" -X -v ON_ERROR_STOP=1 -c 'begin' \
    -v external_flag_history_verified=1 -f "$rollback_preflight" \
    -c "set local app.phase1a_never_enabled_attested='true'" \
    -f "$down" >"$output" 2>&1
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

run_preflight_as_role_nogo() {
  local db="$1" role="$2" output="$3"
  "$PG_PSQL" -d "$db" -X -v ON_ERROR_STOP=1 -c "set role $role" \
    -v expected_project_ref=hngtwkayovuxhiqustsa -v expected_database="$db" \
    -v expected_role="$role" -v external_apple_flags_off=1 \
    -f "$preflight" >"$output" 2>&1
  grep -q 'MIGRATION_PREFLIGHT_NO_GO' "$output"
  grep -q 'migration_history_unreadable' "$output"
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

assert_phase1a_absent() {
  local db="$1"
  [[ "$($PG_PSQL -d "$db" -X -Atqc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('billing_runtime_controls','app_store_entitlements','app_store_transactions','app_store_notification_events','app_store_binding_tombstones','billing_entitlements_v2','billing_account_deletion_requests','billing_account_deletion_fences')")" == 0 ]]
}

manifest_rejection() {
  local label="$1" mutation="$2" db="apple_manifest_$1"
  bootstrap_db "$db"
  baseline_vars "$db"
  "$PG_PSQL" "postgresql:///$db" -X -v ON_ERROR_STOP=1 -f "$up" >"$log_dir/$label-up.log" 2>&1
  record_migration "$db"
  "$PG_PSQL" "postgresql:///$db" -X -v ON_ERROR_STOP=1 -c "$mutation" >"$log_dir/$label-mutate.log" 2>&1
  run_postflight_fail "$db" "$log_dir/$label-postflight.log"
  set +e
  "$PG_PSQL" -d "$db" -X -v ON_ERROR_STOP=1 -c 'begin' \
    -v external_flag_history_verified=1 -f "$rollback_preflight" \
    -c "update pg_temp.phase1a_rollback_preflight_attestation set rollback_result='ROLLBACK_SAFE'; set local app.phase1a_never_enabled_attested='true'" \
    -f "$down" >"$log_dir/$label-down.log" 2>&1
  local rc=$?
  set -e
  [[ "$rc" -ne 0 ]]
  grep -q 'ROLLBACK_REQUIRES_MANUAL_REVIEW' "$log_dir/$label-down.log"
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

# Execute the complete preflight as a real non-superuser that can read every
# other required baseline object but cannot SELECT migration history.
for permission_case in unreadable structure_unreadable; do
  permission_db="apple_history_$permission_case"
  permission_role="phase1a_$permission_case"
  bootstrap_db "$permission_db"
  "$PG_PSQL" -d "$permission_db" -X -v ON_ERROR_STOP=1 -c "create role $permission_role nologin; grant usage on schema public,auth,extensions,supabase_migrations to $permission_role; grant select on public.user_membership to $permission_role; revoke all on supabase_migrations.schema_migrations from $permission_role" >/dev/null
  if [[ "$permission_case" == structure_unreadable ]]; then
    "$PG_PSQL" -d "$permission_db" -X -v ON_ERROR_STOP=1 -c 'alter table supabase_migrations.schema_migrations rename column version to broken_version' >/dev/null
  fi
  run_preflight_as_role_nogo "$permission_db" "$permission_role" "$log_dir/history-$permission_case.log"
  if [[ "$permission_case" == structure_unreadable ]]; then
    grep -q 'migration_history_structure' "$log_dir/history-$permission_case.log"
  fi
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
"$PG_PSQL" -d "$lifecycle_db" -X -v ON_ERROR_STOP=1 -c 'begin' \
  -f "$rollback_preflight" -c 'rollback' >"$log_dir/rollback-preflight-no-history-proof.log" 2>&1
grep -q 'ROLLBACK_REQUIRES_MANUAL_REVIEW' "$log_dir/rollback-preflight-no-history-proof.log"

# Down cannot run without a preflight record created in this exact transaction.
set +e
"$PG_PSQL" -d "$lifecycle_db" -X -v ON_ERROR_STOP=1 -c 'begin' \
  -c "set local app.phase1a_never_enabled_attested='true'" -f "$down" \
  >"$log_dir/attestation-missing.log" 2>&1
missing_attestation_rc=$?
set -e
[[ "$missing_attestation_rc" -ne 0 ]]
grep -q 'PHASE1A_SAME_TRANSACTION_PREFLIGHT_REQUIRED' "$log_dir/attestation-missing.log"
assert_phase1a_present "$lifecycle_db"

# A real preflight record is bound to backend, transaction, database, artifact
# identities, result, explicit external proof, and a ten-minute lifetime.
for attestation_case in missing_external stale wrong_database wrong_up_sha wrong_manifest old_format; do
  case "$attestation_case" in
    missing_external) external_value=0; tamper_sql='select 1' ;;
    stale) external_value=1; tamper_sql="update pg_temp.phase1a_rollback_preflight_attestation set generated_at=clock_timestamp()-interval '11 minutes'" ;;
    wrong_database) external_value=1; tamper_sql="update pg_temp.phase1a_rollback_preflight_attestation set database_name='another_database'" ;;
    wrong_up_sha) external_value=1; tamper_sql="update pg_temp.phase1a_rollback_preflight_attestation set up_sha=repeat('0',64)" ;;
    wrong_manifest) external_value=1; tamper_sql="update pg_temp.phase1a_rollback_preflight_attestation set manifest_sha=repeat('0',64)" ;;
    old_format) external_value=1; tamper_sql="set local app.phase1a_rollback_approval='ROLLBACK_SAFE:$up_sha'; update pg_temp.phase1a_rollback_preflight_attestation set operation_type='legacy_down'" ;;
  esac
  set +e
  "$PG_PSQL" -d "$lifecycle_db" -X -v ON_ERROR_STOP=1 -c 'begin' \
    -v external_flag_history_verified="$external_value" -f "$rollback_preflight" \
    -c "$tamper_sql; set local app.phase1a_never_enabled_attested='true'" \
    -f "$down" >"$log_dir/attestation-$attestation_case.log" 2>&1
  attestation_rc=$?
  set -e
  [[ "$attestation_rc" -ne 0 ]]
  grep -q 'PHASE1A_ROLLBACK_ATTESTATION_INVALID_OR_EXPIRED' "$log_dir/attestation-$attestation_case.log"
  assert_phase1a_present "$lifecycle_db"
done

# Capture a genuine preflight ID, commit, and prove neither the ID nor a
# session-level setting can revive the ON COMMIT DROP attestation.
"$PG_PSQL" -d "$lifecycle_db" -X -v ON_ERROR_STOP=1 -At -c 'begin' \
  -v external_flag_history_verified=1 -f "$rollback_preflight" \
  -c "select 'captured_preflight_id='||preflight_id from pg_temp.phase1a_rollback_preflight_attestation" \
  -c 'commit' >"$log_dir/attestation-captured.log" 2>&1
copied_preflight_id="$(grep -Eo 'captured_preflight_id=[0-9a-f-]{36}' "$log_dir/attestation-captured.log" | cut -d= -f2)"
[[ -n "$copied_preflight_id" ]]
set +e
"$PG_PSQL" -d "$lifecycle_db" -X -v ON_ERROR_STOP=1 \
  -c "set app.phase1a_rollback_preflight_id='$copied_preflight_id'; set app.phase1a_never_enabled_attested='true'; begin" \
  -f "$down" >"$log_dir/attestation-cross-transaction.log" 2>&1
cross_transaction_rc=$?
set -e
[[ "$cross_transaction_rc" -ne 0 ]]
grep -q 'PHASE1A_SAME_TRANSACTION_PREFLIGHT_REQUIRED' "$log_dir/attestation-cross-transaction.log"

set +e
"$PG_PSQL" -d "$lifecycle_db" -X -v ON_ERROR_STOP=1 -c 'begin' \
  -v external_flag_history_verified=1 -f "$rollback_preflight" \
  -c "select set_config('app.phase1a_rollback_preflight_id',preflight_id::text,false),set_config('app.phase1a_never_enabled_attested','true',false) from pg_temp.phase1a_rollback_preflight_attestation; commit; begin" \
  -f "$down" >"$log_dir/attestation-session-setting-after-commit.log" 2>&1
session_setting_rc=$?
set -e
[[ "$session_setting_rc" -ne 0 ]]
grep -q 'PHASE1A_SAME_TRANSACTION_PREFLIGHT_REQUIRED' "$log_dir/attestation-session-setting-after-commit.log"

# Keep a genuine attestation alive in session A while independent session B
# attempts to copy its ID. Temp state is backend-local, so B must fail.
"$PG_PSQL" -d "$lifecycle_db" -X -v ON_ERROR_STOP=1 -At -c 'begin' \
  -v external_flag_history_verified=1 -f "$rollback_preflight" \
  -c "select 'live_preflight_id='||preflight_id from pg_temp.phase1a_rollback_preflight_attestation; select pg_sleep(3)" \
  -c 'rollback' >"$log_dir/attestation-session-a.log" 2>&1 &
session_a_pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  live_preflight_id="$(grep -Eo 'live_preflight_id=[0-9a-f-]{36}' "$log_dir/attestation-session-a.log" 2>/dev/null | cut -d= -f2 || true)"
  [[ -n "$live_preflight_id" ]] && break
  sleep 0.2
done
[[ -n "$live_preflight_id" ]]
set +e
"$PG_PSQL" -d "$lifecycle_db" -X -v ON_ERROR_STOP=1 \
  -c "begin; set local app.phase1a_rollback_preflight_id='$live_preflight_id'; set local app.phase1a_never_enabled_attested='true'" \
  -f "$down" >"$log_dir/attestation-session-b.log" 2>&1
cross_session_rc=$?
set -e
[[ "$cross_session_rc" -ne 0 ]]
grep -q 'PHASE1A_SAME_TRANSACTION_PREFLIGHT_REQUIRED' "$log_dir/attestation-session-b.log"
wait "$session_a_pid"

# A copied ID from database A is also unusable in a real second database.
cross_database_db=apple_attestation_other_database
bootstrap_db "$cross_database_db"
"$PG_PSQL" -d "$cross_database_db" -X -v ON_ERROR_STOP=1 -f "$up" >/dev/null
record_migration "$cross_database_db"
set +e
"$PG_PSQL" -d "$cross_database_db" -X -v ON_ERROR_STOP=1 \
  -c "begin; set local app.phase1a_rollback_preflight_id='$copied_preflight_id'; set local app.phase1a_never_enabled_attested='true'" \
  -f "$down" >"$log_dir/attestation-cross-database.log" 2>&1
cross_database_rc=$?
set -e
[[ "$cross_database_rc" -ne 0 ]]
grep -q 'PHASE1A_SAME_TRANSACTION_PREFLIGHT_REQUIRED' "$log_dir/attestation-cross-database.log"
assert_phase1a_present "$cross_database_db"

assert_payment_data "$lifecycle_db"
down_start="$(date +%s)"
run_attested_down "$lifecycle_db" "$log_dir/down.log"
grep -q 'ROLLBACK_SAFE' "$log_dir/down.log"
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
failed_down_phase_snapshot="$($PG_PSQL -d "$lifecycle_db" -X -Atqc "$phase1a_data_snapshot_sql")"
failed_down_manifest="$(phase1a_manifest_sha "$lifecycle_db")"
failed_down_payment_snapshot="$($PG_PSQL -d "$lifecycle_db" -X -Atqc "$payment_data_snapshot_sql")"
"$PG_PSQL" -d "$lifecycle_db" -X -v ON_ERROR_STOP=1 -c 'begin' \
  -v external_flag_history_verified=1 -f "$rollback_preflight" -c 'rollback' >"$log_dir/rollback-preflight-data.log" 2>&1
grep -q 'ROLLBACK_UNSAFE' "$log_dir/rollback-preflight-data.log"
set +e
"$PG_PSQL" -d "$lifecycle_db" -X -v ON_ERROR_STOP=1 -c 'begin' \
  -v external_flag_history_verified=1 -f "$rollback_preflight" \
  -c "update pg_temp.phase1a_rollback_preflight_attestation set rollback_result='ROLLBACK_SAFE'; set local app.phase1a_never_enabled_attested='true'" \
  -f "$down" >"$log_dir/down-data-rejection.log" 2>&1
data_down_rc=$?
set -e
[[ "$data_down_rc" -ne 0 ]]
grep -q 'PHASE1A_BUSINESS_DATA_PRESENT' "$log_dir/down-data-rejection.log"
assert_phase1a_present "$lifecycle_db"
[[ "$(phase1a_manifest_sha "$lifecycle_db")" == "$failed_down_manifest" ]]
[[ "$($PG_PSQL -d "$lifecycle_db" -X -Atqc "$phase1a_data_snapshot_sql")" == "$failed_down_phase_snapshot" ]]
[[ "$($PG_PSQL -d "$lifecycle_db" -X -Atqc "$payment_data_snapshot_sql")" == "$failed_down_payment_snapshot" ]]
[[ "$($PG_PSQL -d "$lifecycle_db" -X -Atqc "select count(*) from public.app_store_notification_events where notification_uuid='30000000-0000-4000-8000-000000000001'")" == 1 ]]
[[ "$($PG_PSQL -d "$lifecycle_db" -X -Atqc 'select count(*) from public.billing_runtime_controls')" == 1 ]]
assert_payment_data "$lifecycle_db"

# A current flag must independently block rollback.
flag_db=apple_phase1a_flag_rejection
bootstrap_db "$flag_db"
"$PG_PSQL" "postgresql:///$flag_db" -X -v ON_ERROR_STOP=1 -f "$up" >"$log_dir/flag-up.log" 2>&1
record_migration "$flag_db"
"$PG_PSQL" "postgresql:///$flag_db" -X -v ON_ERROR_STOP=1 -c \
  "update public.billing_runtime_controls set apple_verification_enabled=true,updated_by='synthetic-test'" >/dev/null
"$PG_PSQL" -d "$flag_db" -X -v ON_ERROR_STOP=1 -c 'begin' \
  -v external_flag_history_verified=1 -f "$rollback_preflight" -c 'rollback' >"$log_dir/rollback-preflight-flag.log" 2>&1
grep -q 'ROLLBACK_UNSAFE' "$log_dir/rollback-preflight-flag.log"
set +e
"$PG_PSQL" -d "$flag_db" -X -v ON_ERROR_STOP=1 -c 'begin' \
  -v external_flag_history_verified=1 -f "$rollback_preflight" \
  -c "update pg_temp.phase1a_rollback_preflight_attestation set rollback_result='ROLLBACK_SAFE'; set local app.phase1a_never_enabled_attested='true'" \
  -f "$down" >"$log_dir/down-flag-rejection.log" 2>&1
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
"$PG_PSQL" -d "$history_flag_db" -X -v ON_ERROR_STOP=1 -c 'begin' \
  -v external_flag_history_verified=1 -f "$rollback_preflight" -c 'rollback' >"$log_dir/history-flag-off.log" 2>&1
grep -q 'ROLLBACK_REQUIRES_MANUAL_REVIEW' "$log_dir/history-flag-off.log"
"$PG_PSQL" -d "$history_flag_db" -X -v ON_ERROR_STOP=1 -c 'select pg_stat_reset()' >/dev/null
"$PG_PSQL" -d "$history_flag_db" -X -v ON_ERROR_STOP=1 -c 'begin' \
  -v external_flag_history_verified=1 -f "$rollback_preflight" -c 'rollback' >"$log_dir/history-stats-reset.log" 2>&1
grep -q 'ROLLBACK_REQUIRES_MANUAL_REVIEW' "$log_dir/history-stats-reset.log"
set +e
"$PG_PSQL" -d "$history_flag_db" -X -v ON_ERROR_STOP=1 -c 'begin' \
  -v external_flag_history_verified=1 -f "$rollback_preflight" \
  -c "set local app.phase1a_never_enabled_attested='true'" \
  -f "$down" >"$log_dir/history-restored-values-down-rejected.log" 2>&1
history_down_rc=$?
set -e
[[ "$history_down_rc" -ne 0 ]]
grep -q 'PHASE1A_ROLLBACK_ATTESTATION_INVALID_OR_EXPIRED' "$log_dir/history-restored-values-down-rejected.log"
assert_phase1a_present "$history_flag_db"

# Prove INSERT, UPDATE, and DELETE are independently detected. INSERT/DELETE
# must change both count and hash; UPDATE must preserve count but change hash.
for mutation in insert update delete; do
  fingerprint_db="apple_payment_$mutation"
  bootstrap_db "$fingerprint_db"
  baseline_vars "$fingerprint_db"
  before_count="$(payment_table_count "$fingerprint_db" membership_orders)"
  before_hash="$(payment_table_hash "$fingerprint_db" membership_orders)"
  case "$mutation" in
    insert) mutation_sql="insert into public.membership_orders(id,user_id,payment_provider,amount_cents) values ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','zpay',2000)" ;;
    update) mutation_sql='update public.membership_orders set amount_cents=amount_cents+1' ;;
    delete) mutation_sql='delete from public.membership_orders' ;;
  esac
  "$PG_PSQL" -d "$fingerprint_db" -X -v ON_ERROR_STOP=1 -c "$mutation_sql" >/dev/null
  after_count="$(payment_table_count "$fingerprint_db" membership_orders)"
  after_hash="$(payment_table_hash "$fingerprint_db" membership_orders)"
  [[ "$before_hash" != "$after_hash" ]]
  if [[ "$mutation" == update ]]; then
    [[ "$before_count" == "$after_count" ]]
  else
    [[ "$before_count" != "$after_count" ]]
  fi
  if assert_payment_data "$fingerprint_db"; then
    echo "ERROR: intentional $mutation escaped per-table payment snapshot" >&2
    exit 1
  fi
done

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
    -c 'begin' -v external_flag_history_verified=1 -f "$rollback_preflight" \
    -c "lock table $lock_list in access exclusive mode; select pg_sleep(2); set local app.phase1a_never_enabled_attested='true'" \
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
  assert_phase1a_absent "$race_db"
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
"$PG_PSQL" -d "$writer_db" -X -v ON_ERROR_STOP=1 -c 'begin' \
  -v external_flag_history_verified=1 -f "$rollback_preflight" \
  -c "set local app.phase1a_never_enabled_attested='true'" \
  -f "$down" >"$log_dir/race-writer-down.log" 2>&1
writer_down_rc=$?
set -e
[[ "$writer_down_rc" -ne 0 ]]
grep -q 'lock timeout' "$log_dir/race-writer-down.log"
wait "$writer_pid"
assert_phase1a_present "$writer_db"
[[ "$($PG_PSQL -d "$writer_db" -X -Atqc "select count(*) from public.app_store_notification_events where notification_type='WRITER_FIRST'")" == 1 ]]
assert_payment_data "$writer_db"

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
echo "PASS: frozen manifest drift matrix and transaction-local attestation binding rejected"
echo "PASS: migration-history NO_GO matrix including real unreadable role"
echo "PASS: flag-history/stats-reset ambiguity and restored-current-value down rejected"
echo "PASS: cross-transaction/session/database and stale/copied attestation rejected"
echo "PASS: dual-session rollback races A-D"
echo "PASS: per-table user_membership/Stripe-ZPay/Google Play counts and fingerprints preserved"
echo "PASS: payment INSERT/UPDATE/DELETE and failed-down full preservation assertions"
echo "PASS: existing RPC/RLS/idempotency/concurrency suite"
echo "TIMING: up=${up_seconds}s down=${down_seconds}s total=$((end_epoch-start_epoch))s"

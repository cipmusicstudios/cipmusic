#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$repo_root/tests/apple/postgres"
up="$repo_root/supabase/migrations/20260722010000_apple_entitlement_ledger_phase_1a.sql"
down="$repo_root/supabase/rollbacks/20260722010000_apple_entitlement_ledger_phase_1a_down.sql"
down_batch="$repo_root/supabase/rollbacks/20260722010000_apple_entitlement_ledger_phase_1a_approved_batch.sql"
preflight="$repo_root/supabase/verification/20260722010000_apple_entitlement_production_preflight.sql"
postflight="$repo_root/supabase/verification/20260722010000_apple_entitlement_postflight.sql"
rollback_diagnostic="$repo_root/supabase/verification/20260722010000_apple_entitlement_rollback_preflight.sql"
manifest="$repo_root/supabase/verification/20260722010000_apple_entitlement_manifest.sql"
manifest_sha="a645fa4cef579279f4ebc8baec380e3a413792b0da2c92c889921c1da7fb27bb"

find_pg_binary() {
  local name="$1"
  if [[ -n "${POSTGRES_BIN:-}" && -x "$POSTGRES_BIN/$name" ]]; then
    printf '%s\n' "$POSTGRES_BIN/$name"
    return
  fi
  return 1
}

missing=()
for binary in initdb pg_ctl createdb psql postgres pg_dump pg_restore; do
  if ! path="$(find_pg_binary "$binary")"; then
    missing+=("$binary")
  else
    case "$binary" in
      initdb) PG_INITDB="$path" ;;
      pg_ctl) PG_PG_CTL="$path" ;;
      createdb) PG_CREATEDB="$path" ;;
      psql) PG_PSQL="$path" ;;
      postgres) PG_POSTGRES="$path" ;;
      pg_dump) PG_DUMP="$path" ;;
      pg_restore) PG_RESTORE="$path" ;;
    esac
  fi
done
if ((${#missing[@]})); then
  echo "ERROR: PostgreSQL 17 binaries required via POSTGRES_BIN (${missing[*]} missing)." >&2
  exit 2
fi

version="$($PG_POSTGRES --version)"
major="$(sed -E 's/.* ([0-9]+).*/\1/' <<<"$version")"
if [[ "$major" != 17 ]]; then
  echo "ERROR: exact PostgreSQL major 17 required; found $version" >&2
  exit 2
fi

work_dir="$(mktemp -d /tmp/cipmusic-apple-pg17.XXXXXX)"
data_dir="$work_dir/data"
socket_dir="$work_dir/socket"
log_dir="$work_dir/logs"
mkdir -p "$socket_dir" "$log_dir"
server_started=0
cleanup_complete=0

delete_work_dir() {
  find "$work_dir" -depth -mindepth 1 -delete
  rmdir "$work_dir"
  [[ ! -e "$work_dir" ]]
}

stop_server() {
  if ((server_started)); then
    if "$PG_PG_CTL" -D "$data_dir" -m fast stop >"$log_dir/cleanup-stop.log" 2>&1; then
      server_started=0
    else
      return 1
    fi
  fi
}

cleanup_on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  if ((cleanup_complete)); then exit "$rc"; fi
  local stopped=1
  if ! stop_server; then rc=1; stopped=0; fi
  if ((stopped==0)); then
    echo "ERROR: temporary PostgreSQL server did not stop; retained $work_dir" >&2
    exit "$rc"
  fi
  if [[ "${APPLE_READINESS_DEBUG_RETAIN:-0}" == 1 && "$rc" -ne 0 ]]; then
    echo "DEBUG: retained synthetic PG17 evidence at $work_dir" >&2
  elif ! delete_work_dir; then
    echo "ERROR: temporary directory cleanup failed: $work_dir" >&2
    rc=1
  fi
  exit "$rc"
}
trap cleanup_on_exit EXIT INT TERM

unset PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGOPTIONS
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

live_identity="$($PG_PSQL -d postgres -X -AtF '|' -c "select current_setting('server_version'),current_setting('server_version_num'),version()")"
[[ "$(cut -d'|' -f2 <<<"$live_identity")" == 17* ]]

schema_fingerprint_sql="select md5(coalesce(string_agg(format('%s:%s:%s:%s:%s',ordinal_position,column_name,data_type,is_nullable,coalesce(column_default,'')),'|' order by ordinal_position),'')) from information_schema.columns where table_schema='public' and table_name='user_membership'"
payment_fingerprint_sql="select md5(coalesce(string_agg(format('%s:%s:%s:%s',n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner)),'|' order by n.nspname,c.relname),'')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and (c.relname='user_membership' or c.relname='membership_orders' or c.relname like '%stripe%' or c.relname like '%google_play%' or c.relname like '%zpay%')"
payment_function_fingerprint_sql="select md5(coalesce(string_agg(format('%s:%s:%s',n.nspname,p.oid::regprocedure::text,pg_get_userbyid(p.proowner)),'|' order by n.nspname,p.oid::regprocedure::text),'')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%stripe%' or p.proname like '%google_play%' or p.proname like '%zpay%' or p.proname like '%membership%')"
payment_data_snapshot_sql="select table_name||':'||row_count||':'||fingerprint from (select 'user_membership' table_name,count(*) row_count,md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) fingerprint from public.user_membership t union all select 'membership_orders',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.membership_orders t union all select 'membership_google_play_purchases',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.membership_google_play_purchases t union all select 'membership_stripe_subscriptions',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.membership_stripe_subscriptions t) snapshots order by table_name"
phase1a_data_snapshot_sql="select table_name||':'||row_count||':'||fingerprint from (select 'billing_runtime_controls' table_name,count(*) row_count,md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) fingerprint from public.billing_runtime_controls t union all select 'app_store_entitlements',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.app_store_entitlements t union all select 'app_store_transactions',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.app_store_transactions t union all select 'app_store_notification_events',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.app_store_notification_events t union all select 'app_store_binding_tombstones',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.app_store_binding_tombstones t union all select 'billing_entitlements_v2',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.billing_entitlements_v2 t union all select 'billing_account_deletion_requests',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.billing_account_deletion_requests t union all select 'billing_account_deletion_fences',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.billing_account_deletion_fences t) snapshots order by table_name"
object_inventory_sql="select jsonb_build_object('tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('billing_runtime_controls','app_store_entitlements','app_store_transactions','app_store_notification_events','app_store_binding_tombstones','billing_entitlements_v2','billing_account_deletion_requests','billing_account_deletion_fences')),'types',(select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname in ('app_store_environment','app_store_binding_state','app_store_current_state_quality','app_store_status_source','billing_aggregate_mode','billing_entitlement_validity')),'functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('billing_v2_set_updated_at','billing_get_runtime_controls','billing_get_current_entitlement_status','billing_record_app_store_transaction','billing_record_app_store_notification','billing_prepare_account_deletion')),'triggers',(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and c.relname in ('billing_runtime_controls','app_store_entitlements','app_store_transactions','app_store_notification_events','app_store_binding_tombstones','billing_entitlements_v2','billing_account_deletion_requests','billing_account_deletion_fences')))::text"

bootstrap_db() {
  local db="$1"
  "$PG_CREATEDB" "$db"
  "$PG_PSQL" -d "$db" -X -v ON_ERROR_STOP=1 -f "$test_root/readiness-bootstrap.sql" >"$log_dir/$db-bootstrap.log" 2>&1
}

record_migration() {
  "$PG_PSQL" -d "$1" -X -v ON_ERROR_STOP=1 -c "insert into supabase_migrations.schema_migrations(version,name) values ('20260722010000','apple_entitlement_ledger_phase_1a')" >/dev/null
}

baseline_vars() {
  local db="$1"
  baseline_rows="$($PG_PSQL -d "$db" -X -Atqc 'select count(*) from public.user_membership')"
  baseline_schema="$($PG_PSQL -d "$db" -X -Atqc "$schema_fingerprint_sql")"
  baseline_payment="$($PG_PSQL -d "$db" -X -Atqc "$payment_fingerprint_sql")"
  baseline_payment_functions="$($PG_PSQL -d "$db" -X -Atqc "$payment_function_fingerprint_sql")"
  baseline_payment_data="$($PG_PSQL -d "$db" -X -Atqc "$payment_data_snapshot_sql")"
}

phase1a_manifest_sha() {
  "$PG_PSQL" -d "$1" -X -q -f "$manifest" -Atc 'select pg_temp.phase1a_manifest_sha256()' | tail -1
}

assert_phase1a_present() {
  local db="$1" inventory
  inventory="$($PG_PSQL -d "$db" -X -Atqc "$object_inventory_sql")"
  jq -e '.tables==8 and .types==6 and .functions==6 and .triggers==6' <<<"$inventory" >/dev/null
}

assert_phase1a_absent() {
  local db="$1" inventory
  inventory="$($PG_PSQL -d "$db" -X -Atqc "$object_inventory_sql")"
  jq -e '.tables==0 and .types==0 and .functions==0 and .triggers==0' <<<"$inventory" >/dev/null
}

run_preflight() {
  local db="$1" output="$2"
  "$PG_PSQL" -d "$db" -X -At -F '|' -v ON_ERROR_STOP=1 \
    -v expected_project_ref=hngtwkayovuxhiqustsa -v expected_database="$db" \
    -v expected_role="$PGUSER" -v external_apple_flags_off=1 \
    -f "$preflight" >"$output" 2>&1
  [[ "$(tail -1 "$output" | cut -d'|' -f1)" == MIGRATION_PREFLIGHT_GO ]]
  [[ "$(tail -1 "$output" | cut -d'|' -f2)" == '[]' ]]
}

run_preflight_nogo() {
  local db="$1" output="$2" reason="$3"
  "$PG_PSQL" -d "$db" -X -At -F '|' -v ON_ERROR_STOP=1 \
    -v expected_project_ref=hngtwkayovuxhiqustsa -v expected_database="$db" \
    -v expected_role="$PGUSER" -v external_apple_flags_off=1 \
    -f "$preflight" >"$output" 2>&1
  [[ "$(tail -1 "$output" | cut -d'|' -f1)" == MIGRATION_PREFLIGHT_NO_GO ]]
  jq -e --arg reason "$reason" 'map(.check)|index($reason)' <<<"$(tail -1 "$output" | cut -d'|' -f2)" >/dev/null
}

run_postflight() {
  local db="$1" output="$2" expected_result="${3:-MIGRATION_POSTFLIGHT_PASS}"
  "$PG_PSQL" -d "$db" -X -q -v ON_ERROR_STOP=1 \
    -v expected_user_membership_rows="$baseline_rows" \
    -v expected_user_membership_schema_fingerprint="$baseline_schema" \
    -v expected_payment_object_fingerprint="$baseline_payment" \
    -v expected_payment_function_fingerprint="$baseline_payment_functions" \
    -f "$postflight" >"$output" 2>&1
  grep -q "$expected_result" "$output"
}

assert_diagnostic() {
  local db="$1" expected="$2" output="$3"
  "$PG_PSQL" -d "$db" -X -q -At -F '|' -v ON_ERROR_STOP=1 -f "$rollback_diagnostic" >"$output" 2>&1
  local line
  line="$(tail -1 "$output")"
  [[ "$(cut -d'|' -f1 <<<"$line")" == "$expected" ]]
  [[ "$(cut -d'|' -f2 <<<"$line")" == f ]]
  [[ "$(cut -d'|' -f3 <<<"$line")" == f ]]
}

assert_down_refused() {
  local db="$1" label="$2" entrypoint="${3:-$down}"
  local manifest_before phase_before payment_before history_before inventory_before rc
  manifest_before="$(phase1a_manifest_sha "$db")"
  phase_before="$($PG_PSQL -d "$db" -X -Atqc "$phase1a_data_snapshot_sql")"
  payment_before="$($PG_PSQL -d "$db" -X -Atqc "$payment_data_snapshot_sql")"
  history_before="$($PG_PSQL -d "$db" -X -Atqc "select count(*) from supabase_migrations.schema_migrations where version='20260722010000'")"
  inventory_before="$($PG_PSQL -d "$db" -X -Atqc "$object_inventory_sql")"
  set +e
  "$PG_PSQL" -d "$db" -X -v ON_ERROR_STOP=1 -f "$entrypoint" >"$log_dir/$label-down-refused.log" 2>&1
  rc=$?
  set -e
  [[ "$rc" -ne 0 ]]
  grep -q 'PHASE_1A_POST_COMMIT_DOWN_UNSUPPORTED' "$log_dir/$label-down-refused.log"
  grep -q 'Use forward fix or restore the verified Production backup.' "$log_dir/$label-down-refused.log"
  assert_phase1a_present "$db"
  [[ "$(phase1a_manifest_sha "$db")" == "$manifest_before" ]]
  [[ "$($PG_PSQL -d "$db" -X -Atqc "$phase1a_data_snapshot_sql")" == "$phase_before" ]]
  [[ "$($PG_PSQL -d "$db" -X -Atqc "$payment_data_snapshot_sql")" == "$payment_before" ]]
  [[ "$($PG_PSQL -d "$db" -X -Atqc "select count(*) from supabase_migrations.schema_migrations where version='20260722010000'")" == "$history_before" ]]
  [[ "$($PG_PSQL -d "$db" -X -Atqc "$object_inventory_sql")" == "$inventory_before" ]]
}

# Production-preflight migration-history failure matrix.
for history_case in schema table structure target; do
  history_db="apple_history_$history_case"
  bootstrap_db "$history_db"
  case "$history_case" in
    schema) "$PG_PSQL" -d "$history_db" -X -v ON_ERROR_STOP=1 -c 'drop schema supabase_migrations cascade' >/dev/null; reason=migration_history_schema ;;
    table) "$PG_PSQL" -d "$history_db" -X -v ON_ERROR_STOP=1 -c 'drop table supabase_migrations.schema_migrations' >/dev/null; reason=migration_history_table ;;
    structure) "$PG_PSQL" -d "$history_db" -X -v ON_ERROR_STOP=1 -c 'alter table supabase_migrations.schema_migrations rename column version to broken_version' >/dev/null; reason=migration_history_structure ;;
    target) record_migration "$history_db"; reason=target_version_absent ;;
  esac
  run_preflight_nogo "$history_db" "$log_dir/history-$history_case.log" "$reason"
done

# Real unreadable history fixture.
unreadable_db=apple_history_unreadable
bootstrap_db "$unreadable_db"
"$PG_PSQL" -d "$unreadable_db" -X -v ON_ERROR_STOP=1 -c "create role phase1a_unreadable nologin; grant usage on schema public,auth,extensions,supabase_migrations to phase1a_unreadable; grant select on public.user_membership to phase1a_unreadable; revoke all on supabase_migrations.schema_migrations from phase1a_unreadable" >/dev/null
"$PG_PSQL" -d "$unreadable_db" -X -At -F '|' -v ON_ERROR_STOP=1 \
  -c 'set role phase1a_unreadable' -v expected_project_ref=hngtwkayovuxhiqustsa \
  -v expected_database="$unreadable_db" -v expected_role=phase1a_unreadable \
  -v external_apple_flags_off=1 -f "$preflight" >"$log_dir/history-unreadable.log" 2>&1
[[ "$(tail -1 "$log_dir/history-unreadable.log" | cut -d'|' -f1)" == MIGRATION_PREFLIGHT_NO_GO ]]
jq -e 'map(.check)|sort == ["migration_history_unreadable","target_version_absent"]' <<<"$(tail -1 "$log_dir/history-unreadable.log" | cut -d'|' -f2)" >/dev/null

# A deliberate error before the frozen up's COMMIT must roll back every object;
# retrying the unmodified frozen up must then succeed.
lifecycle_db=apple_phase1a_lifecycle
bootstrap_db "$lifecycle_db"
baseline_vars "$lifecycle_db"
run_preflight "$lifecycle_db" "$log_dir/preflight.log"
faulty_up="$work_dir/faulty-up-before-commit.sql"
awk 'BEGIN{inserted=0} /^commit;$/ && !inserted {print "select 1/0;"; inserted=1} {print}' "$up" >"$faulty_up"
set +e
"$PG_PSQL" -d "$lifecycle_db" -X -v ON_ERROR_STOP=1 -f "$faulty_up" >"$log_dir/faulty-up.log" 2>&1
faulty_rc=$?
set -e
[[ "$faulty_rc" -ne 0 ]]
grep -q 'division by zero' "$log_dir/faulty-up.log"
assert_phase1a_absent "$lifecycle_db"
[[ "$($PG_PSQL -d "$lifecycle_db" -X -Atqc "select count(*) from supabase_migrations.schema_migrations where version='20260722010000'")" == 0 ]]
[[ "$($PG_PSQL -d "$lifecycle_db" -X -Atqc "$payment_data_snapshot_sql")" == "$baseline_payment_data" ]]

"$PG_PSQL" -d "$lifecycle_db" -X -v ON_ERROR_STOP=1 -f "$up" >"$log_dir/retry-up.log" 2>&1
record_migration "$lifecycle_db"
assert_phase1a_present "$lifecycle_db"
[[ "$(phase1a_manifest_sha "$lifecycle_db")" == "$manifest_sha" ]]
run_postflight "$lifecycle_db" "$log_dir/postflight.log"
assert_diagnostic "$lifecycle_db" NO_POST_COMMIT_DOWN_SUPPORTED "$log_dir/diagnostic-pristine.log"
assert_down_refused "$lifecycle_db" pristine-direct "$down"
assert_down_refused "$lifecycle_db" pristine-batch "$down_batch"

# Arbitrary temp state, GUCs, tokens, and operator approval cannot unlock down.
fake_manifest_before="$(phase1a_manifest_sha "$lifecycle_db")"
fake_phase_before="$($PG_PSQL -d "$lifecycle_db" -X -Atqc "$phase1a_data_snapshot_sql")"
fake_payment_before="$($PG_PSQL -d "$lifecycle_db" -X -Atqc "$payment_data_snapshot_sql")"
set +e
"$PG_PSQL" -d "$lifecycle_db" -X -v ON_ERROR_STOP=1 \
  -c 'create temporary table phase1a_rollback_approval(result text); insert into phase1a_rollback_approval values ($$ROLLBACK_SAFE$$)' \
  -c "select set_config('app.phase1a_rollback_approval','MANUAL_REVIEW_APPROVED',false),set_config('app.phase1a_token','forged',false)" \
  -f "$down" >"$log_dir/fake-state-down-refused.log" 2>&1
fake_rc=$?
set -e
[[ "$fake_rc" -ne 0 ]]
grep -q 'PHASE_1A_POST_COMMIT_DOWN_UNSUPPORTED' "$log_dir/fake-state-down-refused.log"
[[ "$(phase1a_manifest_sha "$lifecycle_db")" == "$fake_manifest_before" ]]
[[ "$($PG_PSQL -d "$lifecycle_db" -X -Atqc "$phase1a_data_snapshot_sql")" == "$fake_phase_before" ]]
[[ "$($PG_PSQL -d "$lifecycle_db" -X -Atqc "$payment_data_snapshot_sql")" == "$fake_payment_before" ]]

# Statistics changes and current data/flag states affect diagnostics, never down.
"$PG_PSQL" -d "$lifecycle_db" -X -v ON_ERROR_STOP=1 -c 'select pg_stat_reset()' >/dev/null
assert_down_refused "$lifecycle_db" stats-reset
"$PG_PSQL" -d "$lifecycle_db" -X -v ON_ERROR_STOP=1 -c "update public.billing_runtime_controls set apple_verification_enabled=true,updated_by='synthetic'; insert into public.app_store_notification_events(environment,endpoint_environment,notification_uuid,notification_type,signed_date,payload_hash) values ('sandbox','sandbox','30000000-0000-4000-8000-000000000001','TEST',now(),repeat('a',64))" >/dev/null
assert_diagnostic "$lifecycle_db" BACKUP_RESTORE_RECOMMENDED "$log_dir/diagnostic-data.log"
assert_down_refused "$lifecycle_db" data-and-flag

# A single-transaction logical restore recreates a pristine-looking schema, but
# the post-commit down placeholder still rejects without reading that state.
restore_source=apple_restore_source
bootstrap_db "$restore_source"
"$PG_PSQL" -d "$restore_source" -X -v ON_ERROR_STOP=1 -f "$up" >"$log_dir/restore-source-up.log" 2>&1
record_migration "$restore_source"
"$PG_PSQL" -d "$restore_source" -X -v ON_ERROR_STOP=1 -c "update public.billing_runtime_controls set apple_verification_enabled=true,updated_by='synthetic'; update public.billing_runtime_controls set apple_verification_enabled=false,updated_by=null" >/dev/null
restore_archive="$work_dir/phase1a-restore-illusion.dump"
"$PG_DUMP" -d "$restore_source" -Fc -f "$restore_archive"
restore_target=apple_restore_target
"$PG_CREATEDB" "$restore_target"
"$PG_RESTORE" -d "$restore_target" --single-transaction --exit-on-error --no-owner "$restore_archive" >"$log_dir/restore-target.log" 2>&1
baseline_vars "$restore_target"
assert_phase1a_present "$restore_target"
[[ "$(phase1a_manifest_sha "$restore_target")" == "$manifest_sha" ]]
assert_diagnostic "$restore_target" NO_POST_COMMIT_DOWN_SUPPORTED "$log_dir/diagnostic-restore.log"
assert_down_refused "$restore_target" restore-illusion

# Manifest drift coverage, including enum owner/type ACL/column ACL.
manifest_rejection() {
  local label="$1" mutation="$2" db="apple_manifest_$1"
  bootstrap_db "$db"
  baseline_vars "$db"
  "$PG_PSQL" -d "$db" -X -v ON_ERROR_STOP=1 -f "$up" >"$log_dir/$label-up.log" 2>&1
  record_migration "$db"
  local before after
  before="$(phase1a_manifest_sha "$db")"
  "$PG_PSQL" -d "$db" -X -v ON_ERROR_STOP=1 -c "$mutation" >"$log_dir/$label-mutate.log" 2>&1
  after="$(phase1a_manifest_sha "$db")"
  [[ "$before" != "$after" ]]
  run_postflight "$db" "$log_dir/$label-postflight.log" MIGRATION_POSTFLIGHT_FAIL
  grep -q 'frozen_manifest' "$log_dir/$label-postflight.log"
  assert_diagnostic "$db" FORWARD_FIX_REQUIRED "$log_dir/$label-diagnostic.log"
  assert_down_refused "$db" "$label"
}

manifest_rejection type_owner "create role phase1a_type_owner nologin; alter type public.app_store_environment owner to phase1a_type_owner"
manifest_rejection type_acl "create role phase1a_type_acl nologin; grant usage on type public.app_store_environment to phase1a_type_acl"
manifest_rejection column_acl "create role phase1a_column_acl nologin; grant select(singleton) on table public.billing_runtime_controls to phase1a_column_acl"
manifest_rejection column_default "alter table public.billing_runtime_controls alter column aggregate_mode set default 'shadow'"
manifest_rejection constraint "alter table public.app_store_entitlements drop constraint app_store_entitlements_environment_match; alter table public.app_store_entitlements add constraint app_store_entitlements_environment_match check (true)"
manifest_rejection index "drop index public.app_store_entitlements_status_idx; create index app_store_entitlements_status_idx on public.app_store_entitlements(user_id)"
manifest_rejection function_body "create or replace function public.billing_v2_set_updated_at() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as \$\$begin new.updated_at=clock_timestamp(); return new; end\$\$"
manifest_rejection function_security "alter function public.billing_get_runtime_controls() security invoker"
manifest_rejection function_search_path "alter function public.billing_get_runtime_controls() set search_path=public"
manifest_rejection trigger "alter table public.billing_runtime_controls disable trigger billing_runtime_controls_set_updated_at"
manifest_rejection table_acl "create role phase1a_table_acl nologin; grant select on public.billing_runtime_controls to phase1a_table_acl"
manifest_rejection force_rls "alter table public.billing_runtime_controls force row level security"
manifest_rejection policy "create policy synthetic_policy on public.billing_runtime_controls for select to anon using (true)"
manifest_rejection function_acl "create role phase1a_function_acl nologin; grant execute on function public.billing_get_runtime_controls() to phase1a_function_acl"
manifest_rejection replica_identity "alter table public.billing_runtime_controls replica identity full"

# Per-table legacy payment fingerprints independently detect INSERT/UPDATE/DELETE.
for scenario in zpay_insert stripe_update google_delete membership_update; do
  db="apple_payment_$scenario"
  bootstrap_db "$db"
  baseline_vars "$db"
  case "$scenario" in
    zpay_insert) table=membership_orders; mutation_sql="insert into public.membership_orders(id,user_id,payment_provider,amount_cents) values ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','zpay',2000)" ;;
    stripe_update) table=membership_stripe_subscriptions; mutation_sql="update public.membership_stripe_subscriptions set status='past_due'" ;;
    google_delete) table=membership_google_play_purchases; mutation_sql='delete from public.membership_google_play_purchases' ;;
    membership_update) table=user_membership; mutation_sql="update public.user_membership set membership_status='basic'" ;;
  esac
  before="$($PG_PSQL -d "$db" -X -Atqc "select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.$table t")"
  "$PG_PSQL" -d "$db" -X -v ON_ERROR_STOP=1 -c "$mutation_sql" >/dev/null
  after="$($PG_PSQL -d "$db" -X -Atqc "select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.$table t")"
  [[ "$before" != "$after" ]]
  if [[ "$($PG_PSQL -d "$db" -X -Atqc "$payment_data_snapshot_sql")" == "$baseline_payment_data" ]]; then
    echo "ERROR: intentional $scenario escaped the payment snapshot" >&2
    exit 1
  fi
done

# Existing RPC/RLS/grants/replay/idempotency and two-session concurrency suite.
POSTGRES_BIN="$POSTGRES_BIN" "$repo_root/scripts/test-apple-postgres-integration.sh" >"$log_dir/existing-integration.log" 2>&1

result_version="$version"
result_identity="$live_identity"
stop_server
delete_work_dir
cleanup_complete=1
trap - EXIT INT TERM

echo "PASS: $result_version readiness suite"
echo "PASS: live server identity $result_identity"
echo 'PASS: intentional pre-COMMIT up failure rolled back every object and retry up succeeded'
echo 'PASS: post-COMMIT down placeholder and historical batch permanently refused in every tested state'
echo 'PASS: restored-pristine illusion, temp/GUC/token/manual approval, stats, data, and flags cannot unlock down'
echo 'PASS: exact manifest detects enum owner, type ACL, column ACL, and existing drift matrix'
echo 'PASS: diagnostic always reports post_commit_down_supported=false and destructive_down_allowed=false'
echo 'PASS: Phase 1A schema/data/history and legacy payment snapshots survive every refused down'
echo 'PASS: migration-history GO/NO_GO fixtures and real unreadable role'
echo 'PASS: existing RPC/RLS/grants/replay/idempotency/concurrency suite'
echo 'PASS: temporary PostgreSQL process, data, socket, dump, and logs removed'

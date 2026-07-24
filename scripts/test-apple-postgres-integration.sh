#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migration="$repo_root/supabase/migrations/20260722010000_apple_entitlement_ledger_phase_1a.sql"
aggregate_migration="$repo_root/supabase/migrations/20260723090000_apple_membership_aggregate_read.sql"
test_root="$repo_root/tests/apple/postgres"

verification_output_matches() {
  local output="$1"
  local expected="$2"
  local -a lines=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && lines+=("$line")
  done <<<"$output"
  [[ "${#lines[@]}" -eq 1 ]] || return 1
  [[ "${lines[0]%%$'\t'*}" == "$expected" ]]
}

require_verification_marker() {
  local label="$1"
  local output="$2"
  local expected="$3"
  if ! verification_output_matches "$output" "$expected"; then
    echo "$label returned an unsafe result; expected exactly $expected" >&2
    printf '%s\n' "$output" >&2
    return 1
  fi
}

find_pg_binary() {
  local name="$1"
  if [[ -n "${POSTGRES_BIN:-}" && -x "$POSTGRES_BIN/$name" ]]; then
    printf '%s\n' "$POSTGRES_BIN/$name"
    return
  fi
  if command -v "$name" >/dev/null 2>&1; then command -v "$name"; return; fi
  if command -v pg_config >/dev/null 2>&1; then
    local bindir
    bindir="$(pg_config --bindir)"
    if [[ -x "$bindir/$name" ]]; then printf '%s\n' "$bindir/$name"; return; fi
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
  message="Apple PostgreSQL integration test requires PostgreSQL 15+ binaries (${missing[*]} missing). Set POSTGRES_BIN=/path/to/postgresql/bin."
  if [[ "${APPLE_PG_TEST_ALLOW_SKIP:-0}" == "1" ]]; then echo "SKIP: $message"; exit 0; fi
  echo "ERROR: $message" >&2
  exit 2
fi

pg_major="$($PG_POSTGRES --version | sed -E 's/.* ([0-9]+).*/\1/')"
if [[ ! "$pg_major" =~ ^[0-9]+$ ]] || ((pg_major < 15)); then
  echo "ERROR: PostgreSQL 15+ is required for UNIQUE NULLS NOT DISTINCT; found $($PG_POSTGRES --version)." >&2
  exit 2
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/cipmusic-apple-pg.XXXXXX")"
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
  if [[ "${APPLE_PG_TEST_DEBUG_RETAIN:-0}" == 1 && "$rc" -ne 0 ]]; then
    echo "DEBUG: retained synthetic PostgreSQL evidence at $work_dir" >&2
  elif ! delete_work_dir; then
    echo "ERROR: Apple PostgreSQL integration cleanup failed: $work_dir" >&2
    rc=1
  fi
  exit "$rc"
}
trap cleanup_on_exit EXIT INT TERM

"$PG_INITDB" -D "$data_dir" --auth-local=trust --auth-host=reject --no-locale --encoding=UTF8 >"$log_dir/initdb.log" 2>&1
{
  echo "listen_addresses = ''"
  echo "unix_socket_directories = '$socket_dir'"
  echo "port = 55439"
  echo "log_min_messages = warning"
  echo "log_statement = 'none'"
} >>"$data_dir/postgresql.conf"
"$PG_PG_CTL" -D "$data_dir" -l "$log_dir/postgres.log" start >/dev/null
server_started=1

export PGHOST="$socket_dir" PGPORT=55439 PGUSER="$(id -un)"
db_name=apple_phase1a_test
"$PG_CREATEDB" "$db_name"
db_url="postgresql:///$db_name?host=$socket_dir&port=55439"

"$PG_PSQL" "$db_url" -X -v ON_ERROR_STOP=1 -f "$test_root/bootstrap.sql" >"$log_dir/bootstrap.log" 2>&1
"$PG_PSQL" "$db_url" -X -v ON_ERROR_STOP=1 -f "$migration" >"$log_dir/migration-apply.log" 2>&1
"$PG_PSQL" "$db_url" -X -v ON_ERROR_STOP=1 -f "$aggregate_migration" >"$log_dir/aggregate-incremental-apply.log" 2>&1

# The aggregate migration is an ordered Phase 1A follow-up. Verify its actual
# signature, definer hardening, grants, and production-only summary semantics.
aggregate_checks="$(cat <<'SQL'
do $$
declare f oid := 'public.billing_get_current_entitlement_summary(uuid)'::regprocedure;
begin
  if not exists (select 1 from pg_proc where oid=f and prosecdef
    and pg_get_userbyid(proowner)=current_user
    and coalesce(array_to_string(proconfig, ','),'') like '%search_path=pg_catalog, public%') then
    raise exception 'aggregate function hardening failed';
  end if;
  if has_function_privilege('anon', f, 'EXECUTE')
    or has_function_privilege('authenticated', f, 'EXECUTE')
    or exists (select 1 from aclexplode(coalesce((select proacl from pg_proc where oid=f),acldefault('f',(select proowner from pg_proc where oid=f)))) a where a.grantee=0 and a.privilege_type='EXECUTE')
    or not has_function_privilege('service_role', f, 'EXECUTE') then
    raise exception 'aggregate function grant failed';
  end if;
end $$;
insert into auth.users(id) values ('90000000-0000-4000-8000-000000000001') on conflict do nothing;
insert into public.billing_entitlements_v2(user_id,source,source_environment,external_entitlement_id,plan,product_id,status,validity,valid_until,source_grants_premium,current_state_quality,source_version_at,source_observed_at)
values ('90000000-0000-4000-8000-000000000001','apple','production','aggregate-production','premium','com.cipmusic.aurasounds.premium.monthly.v2','active','bounded',statement_timestamp()+interval '30 days',true,'verified',statement_timestamp(),statement_timestamp()),
('90000000-0000-4000-8000-000000000001','apple','sandbox','aggregate-sandbox','premium','com.cipmusic.aurasounds.premium.monthly.v2','active','bounded',statement_timestamp()+interval '30 days',false,'verified',statement_timestamp(),statement_timestamp());
do $$
begin
  if (select count(*) from public.billing_get_current_entitlement_summary('90000000-0000-4000-8000-000000000001')) <> 2 then raise exception 'aggregate summary rows missing'; end if;
  if not (select currently_grants_premium from public.billing_get_current_entitlement_summary('90000000-0000-4000-8000-000000000001') where environment='production') then raise exception 'production grant missing'; end if;
  if (select currently_grants_premium from public.billing_get_current_entitlement_summary('90000000-0000-4000-8000-000000000001') where environment='sandbox') then raise exception 'sandbox granted premium'; end if;
end $$;
SQL
)"
printf '%s\n' "$aggregate_checks" | "$PG_PSQL" "$db_url" -X -v ON_ERROR_STOP=1 >"$log_dir/aggregate-incremental-assertions.log" 2>&1

# Fresh install is separately exercised so migration ordering cannot be hidden
# by state from the incremental database above.
fresh_db=apple_phase1a_aggregate_fresh
"$PG_CREATEDB" "$fresh_db"
fresh_url="postgresql:///$fresh_db?host=$socket_dir&port=55439"
"$PG_PSQL" "$fresh_url" -X -v ON_ERROR_STOP=1 -f "$test_root/bootstrap.sql" >"$log_dir/aggregate-fresh-bootstrap.log" 2>&1
"$PG_PSQL" "$fresh_url" -X -v ON_ERROR_STOP=1 -f "$migration" >"$log_dir/aggregate-fresh-phase1a.log" 2>&1
aggregate_preflight_output="$("$PG_PSQL" "$fresh_url" -AtX -F $'\t' -v ON_ERROR_STOP=1 -v expected_owner="$(id -un)" \
  -f "$repo_root/supabase/verification/20260723090000_apple_membership_aggregate_read_preflight.sql")"
printf '%s\n' "$aggregate_preflight_output" >"$log_dir/aggregate-preflight.log"
require_verification_marker "Aggregate preflight" "$aggregate_preflight_output" "AGGREGATE_READ_PREFLIGHT_GO"
"$PG_PSQL" "$fresh_url" -X -v ON_ERROR_STOP=1 -f "$aggregate_migration" >"$log_dir/aggregate-fresh-follow-up.log" 2>&1
printf '%s\n' "$aggregate_checks" | "$PG_PSQL" "$fresh_url" -X -v ON_ERROR_STOP=1 >"$log_dir/aggregate-fresh-assertions.log" 2>&1
aggregate_postflight_output="$("$PG_PSQL" "$fresh_url" -AtX -F $'\t' -v ON_ERROR_STOP=1 -v expected_owner="$(id -un)" \
  -f "$repo_root/supabase/verification/20260723090000_apple_membership_aggregate_read_postflight.sql")"
printf '%s\n' "$aggregate_postflight_output" >"$log_dir/aggregate-postflight.log"
require_verification_marker "Aggregate postflight" "$aggregate_postflight_output" "AGGREGATE_READ_POSTFLIGHT_PASS"

# Verification SQL returns exit 0 for a semantic NO_GO/FAIL row. The harness
# must still fail closed for those rows, empty output, and ACL drift.
aggregate_no_go_output="$("$PG_PSQL" "$fresh_url" -AtX -F $'\t' -v ON_ERROR_STOP=1 -v expected_owner="$(id -un)" \
  -f "$repo_root/supabase/verification/20260723090000_apple_membership_aggregate_read_preflight.sql")"
if verification_output_matches "$aggregate_no_go_output" "AGGREGATE_READ_PREFLIGHT_GO"; then
  echo "Aggregate preflight NO_GO was accepted" >&2
  exit 1
fi
if verification_output_matches $'AGGREGATE_READ_POSTFLIGHT_FAIL\t[]' "AGGREGATE_READ_POSTFLIGHT_PASS" \
  || verification_output_matches "" "AGGREGATE_READ_POSTFLIGHT_PASS" \
  || verification_output_matches $'AGGREGATE_READ_POSTFLIGHT_PASS\t[]\nAGGREGATE_READ_POSTFLIGHT_FAIL\t[]' "AGGREGATE_READ_POSTFLIGHT_PASS"; then
  echo "Aggregate verification marker parser accepted an unsafe result" >&2
  exit 1
fi
"$PG_PSQL" "$fresh_url" -X -v ON_ERROR_STOP=1 -c \
  "grant execute on function public.billing_get_current_entitlement_summary(uuid) to public" >"$log_dir/aggregate-public-grant.log" 2>&1
aggregate_acl_fail_output="$("$PG_PSQL" "$fresh_url" -AtX -F $'\t' -v ON_ERROR_STOP=1 -v expected_owner="$(id -un)" \
  -f "$repo_root/supabase/verification/20260723090000_apple_membership_aggregate_read_postflight.sql")"
if verification_output_matches "$aggregate_acl_fail_output" "AGGREGATE_READ_POSTFLIGHT_PASS"; then
  echo "Aggregate postflight accepted PUBLIC execute drift" >&2
  exit 1
fi
"$PG_PSQL" "$fresh_url" -X -v ON_ERROR_STOP=1 -c \
  "revoke execute on function public.billing_get_current_entitlement_summary(uuid) from public" >"$log_dir/aggregate-public-revoke.log" 2>&1

apply_aggregate_prereqs() {
  local url="$1" label="$2"
  "$PG_PSQL" "$url" -X -v ON_ERROR_STOP=1 -f "$test_root/bootstrap.sql" >"$log_dir/$label-bootstrap.log" 2>&1
  "$PG_PSQL" "$url" -X -v ON_ERROR_STOP=1 -f "$migration" >"$log_dir/$label-phase1a.log" 2>&1
}

run_aggregate_preflight() {
  local url="$1"
  "$PG_PSQL" "$url" -AtX -F $'\t' -v ON_ERROR_STOP=1 -v expected_owner="$(id -un)" \
    -f "$repo_root/supabase/verification/20260723090000_apple_membership_aggregate_read_preflight.sql"
}

run_aggregate_postflight() {
  local url="$1"
  "$PG_PSQL" "$url" -AtX -F $'\t' -v ON_ERROR_STOP=1 -v expected_owner="$(id -un)" \
    -f "$repo_root/supabase/verification/20260723090000_apple_membership_aggregate_read_postflight.sql"
}

require_aggregate_preflight_no_go() {
  local label="$1" output="$2"
  require_verification_marker "$label" "$output" "AGGREGATE_READ_PREFLIGHT_NO_GO"
}

require_aggregate_postflight_fail() {
  local label="$1" output="$2"
  require_verification_marker "$label" "$output" "AGGREGATE_READ_POSTFLIGHT_FAIL"
}

create_wrong_owner_role() {
  "$PG_PSQL" "$1" -X -v ON_ERROR_STOP=1 -c \
    "do \$\$ begin if not exists (select 1 from pg_roles where rolname='aggregate_wrong_owner') then create role aggregate_wrong_owner nologin; end if; end \$\$" >/dev/null
}

create_aggregate_like_function() {
  local url="$1" suffix="$2" security_clause="$3" search_path_clause="$4"
  "$PG_PSQL" "$url" -X -v ON_ERROR_STOP=1 >"$log_dir/$suffix-create-aggregate-like.log" <<SQL
create function public.billing_get_current_entitlement_summary(p_user_id uuid)
returns table (environment public.app_store_environment, currently_grants_premium boolean, valid_until timestamptz)
language sql
$security_clause
stable
$search_path_clause
as \$function\$
  select 'production'::public.app_store_environment, false, null::timestamptz
  where false
\$function\$;
SQL
}

# Negative aggregate preflight matrix. Verification SQL exits successfully with
# a NO_GO row, and this shell harness fails closed if any unsafe GO is returned.
for case_name in \
  missing_phase_prereq text_overload bigint_overload noarg_overload procedure \
  exact_uuid_plus_text_overload wrong_owner wrong_acl wrong_return_type \
  wrong_security_definer wrong_search_path
do
  case_db="apple_aggregate_preflight_$case_name"
  "$PG_CREATEDB" "$case_db"
  case_url="postgresql:///$case_db?host=$socket_dir&port=55439"
  "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -f "$test_root/bootstrap.sql" >"$log_dir/$case_db-bootstrap.log" 2>&1
  if [[ "$case_name" != "missing_phase_prereq" ]]; then
    "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -f "$migration" >"$log_dir/$case_db-phase1a.log" 2>&1
  fi
  case "$case_name" in
    text_overload)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "create function public.billing_get_current_entitlement_summary(p_user_id text) returns int language sql as 'select 1'" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    bigint_overload)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "create function public.billing_get_current_entitlement_summary(p_user_id bigint) returns int language sql as 'select 1'" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    noarg_overload)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "create function public.billing_get_current_entitlement_summary() returns int language sql as 'select 1'" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    procedure)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "create procedure public.billing_get_current_entitlement_summary(p_user_id uuid) language sql as 'select 1'" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    exact_uuid_plus_text_overload)
      create_aggregate_like_function "$case_url" "$case_db" "security definer" "set search_path = pg_catalog, public"
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "create function public.billing_get_current_entitlement_summary(p_user_id text) returns int language sql as 'select 1'" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    wrong_owner)
      create_wrong_owner_role "$case_url"
      create_aggregate_like_function "$case_url" "$case_db" "security definer" "set search_path = pg_catalog, public"
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "alter function public.billing_get_current_entitlement_summary(uuid) owner to aggregate_wrong_owner" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    wrong_acl)
      create_aggregate_like_function "$case_url" "$case_db" "security definer" "set search_path = pg_catalog, public"
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "grant execute on function public.billing_get_current_entitlement_summary(uuid) to public" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    wrong_return_type)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "create function public.billing_get_current_entitlement_summary(p_user_id uuid) returns int language sql security definer stable set search_path = pg_catalog, public as 'select 1'" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    wrong_security_definer)
      create_aggregate_like_function "$case_url" "$case_db" "" "set search_path = pg_catalog, public" ;;
    wrong_search_path)
      create_aggregate_like_function "$case_url" "$case_db" "security definer" "set search_path = public" ;;
  esac
  aggregate_preflight_negative_output="$(run_aggregate_preflight "$case_url")"
  printf '%s\n' "$aggregate_preflight_negative_output" >"$log_dir/$case_db-preflight.log"
  require_aggregate_preflight_no_go "Aggregate preflight negative $case_name" "$aggregate_preflight_negative_output"
done

# Negative aggregate postflight matrix. Each case starts from a correct isolated
# installation, then introduces exactly one drift and requires FAIL.
for case_name in \
  text_overload bigint_overload procedure public_grant anon_grant \
  authenticated_grant service_role_revoke owner_drift search_path_drift \
  security_definer_drift function_drop return_signature_drift
do
  case_db="apple_aggregate_postflight_$case_name"
  "$PG_CREATEDB" "$case_db"
  case_url="postgresql:///$case_db?host=$socket_dir&port=55439"
  apply_aggregate_prereqs "$case_url" "$case_db"
  "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -f "$aggregate_migration" >"$log_dir/$case_db-aggregate.log" 2>&1
  case "$case_name" in
    text_overload)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "create function public.billing_get_current_entitlement_summary(p_user_id text) returns int language sql as 'select 1'" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    bigint_overload)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "create function public.billing_get_current_entitlement_summary(p_user_id bigint) returns int language sql as 'select 1'" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    procedure)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "create procedure public.billing_get_current_entitlement_summary(p_user_id text) language sql as 'select 1'" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    public_grant)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "grant execute on function public.billing_get_current_entitlement_summary(uuid) to public" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    anon_grant)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "grant execute on function public.billing_get_current_entitlement_summary(uuid) to anon" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    authenticated_grant)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "grant execute on function public.billing_get_current_entitlement_summary(uuid) to authenticated" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    service_role_revoke)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "revoke execute on function public.billing_get_current_entitlement_summary(uuid) from service_role" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    owner_drift)
      create_wrong_owner_role "$case_url"
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "alter function public.billing_get_current_entitlement_summary(uuid) owner to aggregate_wrong_owner" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    search_path_drift)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "alter function public.billing_get_current_entitlement_summary(uuid) set search_path = pg_catalog, public, pg_temp" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    security_definer_drift)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "alter function public.billing_get_current_entitlement_summary(uuid) security invoker" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    function_drop)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "drop function public.billing_get_current_entitlement_summary(uuid)" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
    return_signature_drift)
      "$PG_PSQL" "$case_url" -X -v ON_ERROR_STOP=1 -c \
        "drop function public.billing_get_current_entitlement_summary(uuid); create function public.billing_get_current_entitlement_summary(p_user_id uuid) returns int language sql security definer stable set search_path = pg_catalog, public as 'select 1'; revoke all on function public.billing_get_current_entitlement_summary(uuid) from public, anon, authenticated; grant execute on function public.billing_get_current_entitlement_summary(uuid) to service_role" >"$log_dir/$case_db-mutate.log" 2>&1 ;;
  esac
  aggregate_postflight_negative_output="$(run_aggregate_postflight "$case_url")"
  printf '%s\n' "$aggregate_postflight_negative_output" >"$log_dir/$case_db-postflight.log"
  require_aggregate_postflight_fail "Aggregate postflight negative $case_name" "$aggregate_postflight_negative_output"
done

# Re-applying the follow-up stops without changing the installed function.
aggregate_before="$($PG_PSQL "$db_url" -X -Atqc "select pg_get_functiondef('public.billing_get_current_entitlement_summary(uuid)'::regprocedure)")"
set +e
"$PG_PSQL" "$db_url" -X -v ON_ERROR_STOP=1 -f "$aggregate_migration" >"$log_dir/aggregate-duplicate.log" 2>&1
aggregate_duplicate_rc=$?
set -e
aggregate_after="$($PG_PSQL "$db_url" -X -Atqc "select pg_get_functiondef('public.billing_get_current_entitlement_summary(uuid)'::regprocedure)")"
if [[ "$aggregate_duplicate_rc" -eq 0 || "$aggregate_before" != "$aggregate_after" ]]; then
  echo "Aggregate follow-up duplicate behavior failed" >&2
  exit 1
fi

# An injected failure before COMMIT leaves no SECURITY DEFINER function or ACL.
aggregate_rollback_db=apple_aggregate_rollback
"$PG_CREATEDB" "$aggregate_rollback_db"
aggregate_rollback_url="postgresql:///$aggregate_rollback_db?host=$socket_dir&port=55439"
"$PG_PSQL" "$aggregate_rollback_url" -X -v ON_ERROR_STOP=1 -f "$test_root/bootstrap.sql" >"$log_dir/aggregate-rollback-bootstrap.log" 2>&1
"$PG_PSQL" "$aggregate_rollback_url" -X -v ON_ERROR_STOP=1 -f "$migration" >"$log_dir/aggregate-rollback-phase1a.log" 2>&1
aggregate_failure_migration="$work_dir/aggregate-injected-failure.sql"
awk '{if ($0 == "commit;") print "select 1 / 0;"; print}' "$aggregate_migration" >"$aggregate_failure_migration"
set +e
"$PG_PSQL" "$aggregate_rollback_url" -X -v ON_ERROR_STOP=1 -f "$aggregate_failure_migration" >"$log_dir/aggregate-rollback.log" 2>&1
aggregate_rollback_rc=$?
set -e
if [[ "$aggregate_rollback_rc" -eq 0 || "$($PG_PSQL "$aggregate_rollback_url" -X -Atqc "select to_regprocedure('public.billing_get_current_entitlement_summary(uuid)') is null")" != t ]]; then
  echo "Aggregate follow-up rollback-on-failure check failed" >&2
  exit 1
fi

# Duplicate application must stop before changing the installed schema.
before_count="$($PG_PSQL "$db_url" -X -Atqc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public';")"
set +e
"$PG_PSQL" "$db_url" -X -v ON_ERROR_STOP=1 -f "$migration" >"$log_dir/migration-duplicate.log" 2>&1
duplicate_rc=$?
set -e
after_count="$($PG_PSQL "$db_url" -X -Atqc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public';")"
if [[ "$duplicate_rc" -eq 0 ]] || ! grep -q 'phase 1A preflight failed' "$log_dir/migration-duplicate.log" || [[ "$before_count" != "$after_count" ]]; then
  echo "Duplicate migration behavior failed" >&2
  exit 1
fi

# A late failure must roll back every object created in the transaction.
rollback_db=apple_phase1a_rollback
"$PG_CREATEDB" "$rollback_db"
rollback_url="postgresql:///$rollback_db?host=$socket_dir&port=55439"
"$PG_PSQL" "$rollback_url" -X -v ON_ERROR_STOP=1 -f "$test_root/bootstrap.sql" >"$log_dir/rollback-bootstrap.log" 2>&1
failure_migration="$work_dir/migration-injected-failure.sql"
awk '{if ($0 == "commit;") print "select 1 / 0;"; print}' "$migration" >"$failure_migration"
set +e
"$PG_PSQL" "$rollback_url" -X -v ON_ERROR_STOP=1 -f "$failure_migration" >"$log_dir/migration-rollback.log" 2>&1
rollback_rc=$?
set -e
created_count="$($PG_PSQL "$rollback_url" -X -Atqc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'app_store_%';")"
sentinel="$($PG_PSQL "$rollback_url" -X -Atqc "select note from public.apple_phase1a_baseline_sentinel where id=1;")"
if [[ "$rollback_rc" -eq 0 || "$created_count" != 0 || "$sentinel" != untouched ]]; then
  echo "Rollback-on-failure check failed" >&2
  exit 1
fi

status_fingerprint="$(cd "$repo_root" && node --import tsx --input-type=module -e "import {currentStatusFingerprint} from './netlify/functions/_shared/apple/current-status.ts'; const base={environment:'production',originalTransactionId:'fixture-original',latestTransactionId:'fixture-current',productId:'com.cipmusic.aurasounds.premium.monthly.v2',subscriptionGroupId:'22099193',appAccountTokenHash:null,normalizedStatus:'active',grantsPremium:true,expiresAt:'2030-01-02T03:04:05.006Z',autoRenew:true,transactionEvidenceSignedAt:'2030-01-01T00:00:00.000Z',renewalEvidenceSignedAt:null,statusSource:'server_api_status'}; const first=currentStatusFingerprint(base); const second=currentStatusFingerprint({...base,statusSource:'reconciliation',appAccountTokenHash:'f'.repeat(64)}); if(first!==second) throw new Error('audit or binding evidence changed status fingerprint'); console.log(first);")"
"$PG_PSQL" "$db_url" -X -v ON_ERROR_STOP=1 -v expected_status_fingerprint="$status_fingerprint" -f "$test_root/assertions.sql" >"$log_dir/assertions.log" 2>&1
PSQL="$PG_PSQL" APPLE_PG_URL="$db_url" APPLE_PG_LOG_DIR="$log_dir" bash "$test_root/concurrency.sh" >"$log_dir/concurrency.log" 2>&1

stop_server
delete_work_dir
cleanup_complete=1
trap - EXIT INT TERM
echo "Apple PostgreSQL integration checks passed on PostgreSQL $pg_major (isolated Unix socket)."
echo 'Apple PostgreSQL integration temporary process, data, socket, and logs removed.'

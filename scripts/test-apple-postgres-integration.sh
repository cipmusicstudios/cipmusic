#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migration="$repo_root/supabase/migrations/20260722010000_apple_entitlement_ledger_phase_1a.sql"
test_root="$repo_root/tests/apple/postgres"

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

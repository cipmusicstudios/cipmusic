#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bootstrap="$repo_root/tests/apple/postgres/readiness-bootstrap.sql"
up="$repo_root/supabase/migrations/20260722010000_apple_entitlement_ledger_phase_1a.sql"
manifest="$repo_root/supabase/verification/20260722010000_apple_entitlement_manifest.sql"
expected_manifest_sha="6ad498f6d8d81a1c8e70bc6482e9cafa0ebd3af4c62ad306b58ca8e00aff50e1"

: "${POSTGRES_17_6_BIN:?POSTGRES_17_6_BIN must point to an exact PostgreSQL 17.6 bin directory}"
: "${POSTGRES_17_10_BIN:?POSTGRES_17_10_BIN must point to an exact PostgreSQL 17.10 bin directory}"

[[ "$($POSTGRES_17_6_BIN/postgres --version)" == 'postgres (PostgreSQL) 17.6' ]]
[[ "$($POSTGRES_17_10_BIN/postgres --version)" == 'postgres (PostgreSQL) 17.10'* ]]

runtime_root="$(mktemp -d /tmp/cipmusic-pg17-runtime.XXXXXX)"
cleanup_failed=0
success=0
started_176=0
started_1710=0
cleanup() {
  local rc=$?
  if ((started_176)) && ! "$POSTGRES_17_6_BIN/pg_ctl" -D "$runtime_root/data-17.6" -m fast stop >"$runtime_root/stop-17.6.log" 2>&1; then cleanup_failed=1; fi
  if ((started_1710)) && ! "$POSTGRES_17_10_BIN/pg_ctl" -D "$runtime_root/data-17.10" -m fast stop >"$runtime_root/stop-17.10.log" 2>&1; then cleanup_failed=1; fi
  if ((success)); then
    if ! find "$runtime_root" -type f -delete 2>/dev/null ||
       ! find "$runtime_root" -depth -type d -empty -delete 2>/dev/null; then cleanup_failed=1; fi
  else
    echo "PG17 runtime comparison failed; sanitized evidence retained at: $runtime_root" >&2
  fi
  if ((cleanup_failed)); then echo 'ERROR: PG17 runtime comparison cleanup failed' >&2; exit 1; fi
  exit "$rc"
}
trap cleanup EXIT INT TERM

# Do not inherit any Production connection settings.
unset PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGOPTIONS

run_version() {
  local label="$1" bin_dir="$2" port="$3"
  local data="$runtime_root/data-$label"
  local socket="$runtime_root/socket-$label" log="$runtime_root/postgres-$label.log"
  mkdir -p "$socket"
  "$bin_dir/initdb" -D "$data" --auth-local=trust --auth-host=reject --no-locale --encoding=UTF8 >"$runtime_root/initdb-$label.log" 2>&1
  {
    printf "listen_addresses = ''\n"
    printf "unix_socket_directories = '%s'\n" "$socket"
    printf "port = %s\n" "$port"
    printf "log_statement = 'none'\n"
  } >>"$data/postgresql.conf"
  "$bin_dir/pg_ctl" -D "$data" -l "$log" start >/dev/null
  if [[ "$label" == 17.6 ]]; then started_176=1; else started_1710=1; fi
  PGHOST="$socket" PGPORT="$port" PGUSER="$(id -un)" "$bin_dir/createdb" manifest_runtime
  PGHOST="$socket" PGPORT="$port" PGUSER="$(id -un)" "$bin_dir/psql" -d manifest_runtime -X -v ON_ERROR_STOP=1 -f "$bootstrap" >"$runtime_root/bootstrap-$label.log" 2>&1
  PGHOST="$socket" PGPORT="$port" PGUSER="$(id -un)" "$bin_dir/psql" -d manifest_runtime -X -v ON_ERROR_STOP=1 -f "$up" >"$runtime_root/up-$label.log" 2>&1
  PGHOST="$socket" PGPORT="$port" PGUSER="$(id -un)" "$bin_dir/psql" -d manifest_runtime -X -q -v ON_ERROR_STOP=1 -f "$manifest" \
    -Atc 'select pg_temp.phase1a_manifest_json()::text' >"$runtime_root/manifest-$label.json"
  PGHOST="$socket" PGPORT="$port" PGUSER="$(id -un)" "$bin_dir/psql" -d manifest_runtime -X -q -v ON_ERROR_STOP=1 -f "$manifest" \
    -Atc 'select pg_temp.phase1a_manifest_sha256()' | tail -1 >"$runtime_root/manifest-$label.sha"
}

run_version 17.6 "$POSTGRES_17_6_BIN" 55446
run_version 17.10 "$POSTGRES_17_10_BIN" 55447

cmp -s "$runtime_root/manifest-17.6.json" "$runtime_root/manifest-17.10.json"
[[ "$(<"$runtime_root/manifest-17.6.sha")" == "$expected_manifest_sha" ]]
[[ "$(<"$runtime_root/manifest-17.10.sha")" == "$expected_manifest_sha" ]]
json_sha_176="$(shasum -a 256 "$runtime_root/manifest-17.6.json" | cut -d' ' -f1)"
json_sha_1710="$(shasum -a 256 "$runtime_root/manifest-17.10.json" | cut -d' ' -f1)"
[[ "$json_sha_176" == "$json_sha_1710" ]]

success=1
echo "PASS: PostgreSQL 17.6 runtime manifest JSON SHA-256 $json_sha_176"
echo "PASS: PostgreSQL 17.10 runtime manifest JSON SHA-256 $json_sha_1710"
echo "PASS: frozen manifest SHA-256 $expected_manifest_sha"

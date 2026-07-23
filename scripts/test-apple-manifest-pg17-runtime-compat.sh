#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bootstrap="$repo_root/tests/apple/postgres/readiness-bootstrap.sql"
up="$repo_root/supabase/migrations/20260722010000_apple_entitlement_ledger_phase_1a.sql"
manifest="$repo_root/supabase/verification/20260722010000_apple_entitlement_manifest.sql"
expected_manifest_sha="a645fa4cef579279f4ebc8baec380e3a413792b0da2c92c889921c1da7fb27bb"
source_url="https://ftp.postgresql.org/pub/source/v17.6/postgresql-17.6.tar.bz2"
expected_archive_sha="e0630a3600aea27511715563259ec2111cd5f4353a4b040e0be827f94cd7a8b0"

: "${POSTGRES_17_10_BIN:?POSTGRES_17_10_BIN must point to an exact PostgreSQL 17.10 bin directory}"

for binary in postgres initdb pg_ctl createdb psql; do
  [[ -x "$POSTGRES_17_10_BIN/$binary" ]]
done
[[ "$($POSTGRES_17_10_BIN/postgres --version)" == 'postgres (PostgreSQL) 17.10'* ]]

runtime_root="$(mktemp -d /tmp/cipmusic-pg17-runtime.XXXXXX)"
source_parent="$runtime_root/source"
archive="$source_parent/postgresql-17.6.tar.bz2"
source_dir="$source_parent/postgresql-17.6"
install_176="$runtime_root/install-17.6"
mkdir -p "$source_parent"
started_176=0
started_1710=0
cleanup_complete=0

delete_runtime_root() {
  find "$runtime_root" -depth -mindepth 1 -delete
  rmdir "$runtime_root"
  [[ ! -e "$runtime_root" ]]
}

stop_servers() {
  local failed=0
  if ((started_176)); then
    if "$install_176/bin/pg_ctl" -D "$runtime_root/data-17.6" -m fast stop >"$runtime_root/stop-17.6.log" 2>&1; then
      started_176=0
    else
      failed=1
    fi
  fi
  if ((started_1710)); then
    if "$POSTGRES_17_10_BIN/pg_ctl" -D "$runtime_root/data-17.10" -m fast stop >"$runtime_root/stop-17.10.log" 2>&1; then
      started_1710=0
    else
      failed=1
    fi
  fi
  return "$failed"
}

cleanup_on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  if ((cleanup_complete)); then exit "$rc"; fi
  local stopped=1
  if ! stop_servers; then rc=1; stopped=0; fi
  if ((stopped==0)); then
    echo "ERROR: a PG17 runtime server did not stop; retained $runtime_root" >&2
    exit "$rc"
  fi
  if [[ "${PG17_RUNTIME_DEBUG_RETAIN:-0}" == 1 && "$rc" -ne 0 ]]; then
    echo "DEBUG: retained PG17 runtime evidence at $runtime_root" >&2
  elif ! delete_runtime_root; then
    echo "ERROR: PG17 runtime comparison cleanup failed: $runtime_root" >&2
    rc=1
  fi
  exit "$rc"
}
trap cleanup_on_exit EXIT INT TERM

unset PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGOPTIONS

curl --fail --silent --show-error --location "$source_url" --output "$archive"
actual_archive_sha="$(shasum -a 256 "$archive" | cut -d' ' -f1)"
[[ "$actual_archive_sha" == "$expected_archive_sha" ]]
tar -xjf "$archive" -C "$source_parent"

configure_args=(
  --without-readline
  --without-zlib
  --without-icu
  --with-openssl
  "--prefix=$install_176"
)
cppflags="${POSTGRES_17_6_CPPFLAGS:-}"
ldflags="${POSTGRES_17_6_LDFLAGS:-}"
if [[ -z "$cppflags" && -d /opt/homebrew/opt/openssl@3/include ]]; then
  cppflags='-I/opt/homebrew/opt/openssl@3/include'
fi
if [[ -z "$ldflags" && -d /opt/homebrew/opt/openssl@3/lib ]]; then
  ldflags='-L/opt/homebrew/opt/openssl@3/lib'
fi

(
  cd "$source_dir"
  CPPFLAGS="$cppflags" LDFLAGS="$ldflags" ./configure "${configure_args[@]}" >"$runtime_root/configure-17.6.log" 2>&1
  make -j"${POSTGRES_17_6_MAKE_JOBS:-4}" >"$runtime_root/make-17.6.log" 2>&1
  make install >"$runtime_root/install-17.6.log" 2>&1
  make -C contrib/pgcrypto >"$runtime_root/make-pgcrypto-17.6.log" 2>&1
  make -C contrib/pgcrypto install >"$runtime_root/install-pgcrypto-17.6.log" 2>&1
)

bin_176="$install_176/bin"
for binary in postgres initdb pg_ctl createdb psql; do
  [[ -x "$bin_176/$binary" ]]
done
[[ "$($bin_176/postgres --version)" == 'postgres (PostgreSQL) 17.6' ]]

canonical_176="$(cd "$bin_176" && pwd -P)"
canonical_1710="$(cd "$POSTGRES_17_10_BIN" && pwd -P)"
[[ "$canonical_176" != "$canonical_1710" ]]

run_version() {
  local label="$1" bin_dir="$2" port="$3" expected_version="$4" expected_num="$5"
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
  local user identity live_version live_num live_banner live_data
  user="$(id -un)"
  identity="$(PGHOST="$socket" PGPORT="$port" PGUSER="$user" "$bin_dir/psql" -d postgres -X -AtF '|' -c "select current_setting('server_version'),current_setting('server_version_num'),version(),current_setting('data_directory')")"
  IFS='|' read -r live_version live_num live_banner live_data <<<"$identity"
  [[ "$live_version" == "$expected_version" ]]
  [[ "$live_num" == "$expected_num" ]]
  [[ "$live_banner" == *"PostgreSQL $expected_version"* ]]
  [[ "$(cd "$live_data" && pwd -P)" == "$(cd "$data" && pwd -P)" ]]
  printf '%s\n' "$identity" >"$runtime_root/server-identity-$label.txt"
  PGHOST="$socket" PGPORT="$port" PGUSER="$user" "$bin_dir/createdb" manifest_runtime
  PGHOST="$socket" PGPORT="$port" PGUSER="$user" "$bin_dir/psql" -d manifest_runtime -X -v ON_ERROR_STOP=1 -f "$bootstrap" >"$runtime_root/bootstrap-$label.log" 2>&1
  PGHOST="$socket" PGPORT="$port" PGUSER="$user" "$bin_dir/psql" -d manifest_runtime -X -v ON_ERROR_STOP=1 -f "$up" >"$runtime_root/up-$label.log" 2>&1
  PGHOST="$socket" PGPORT="$port" PGUSER="$user" "$bin_dir/psql" -d manifest_runtime -X -q -v ON_ERROR_STOP=1 -f "$manifest" \
    -Atc 'select pg_temp.phase1a_manifest_json()::text' >"$runtime_root/manifest-$label.json"
  PGHOST="$socket" PGPORT="$port" PGUSER="$user" "$bin_dir/psql" -d manifest_runtime -X -q -v ON_ERROR_STOP=1 -f "$manifest" \
    -Atc 'select pg_temp.phase1a_manifest_sha256()' | tail -1 >"$runtime_root/manifest-$label.sha"
}

run_version 17.6 "$bin_176" 55446 17.6 170006
run_version 17.10 "$POSTGRES_17_10_BIN" 55447 17.10 170010

[[ "$runtime_root/data-17.6" != "$runtime_root/data-17.10" ]]
[[ "$runtime_root/socket-17.6" != "$runtime_root/socket-17.10" ]]
[[ 55446 != 55447 ]]
cmp -s "$runtime_root/manifest-17.6.json" "$runtime_root/manifest-17.10.json"
[[ "$(<"$runtime_root/manifest-17.6.sha")" == "$expected_manifest_sha" ]]
[[ "$(<"$runtime_root/manifest-17.10.sha")" == "$expected_manifest_sha" ]]
json_sha_176="$(shasum -a 256 "$runtime_root/manifest-17.6.json" | cut -d' ' -f1)"
json_sha_1710="$(shasum -a 256 "$runtime_root/manifest-17.10.json" | cut -d' ' -f1)"
[[ "$json_sha_176" == "$json_sha_1710" ]]
identity_176="$(<"$runtime_root/server-identity-17.6.txt")"
identity_1710="$(<"$runtime_root/server-identity-17.10.txt")"
archive_record="$archive"
configure_record="CPPFLAGS=$cppflags LDFLAGS=$ldflags ./configure ${configure_args[*]}"

stop_servers
delete_runtime_root
cleanup_complete=1
trap - EXIT INT TERM

echo "PROVENANCE: source URL $source_url"
echo "PROVENANCE: archive path $archive_record"
echo "PROVENANCE: archive SHA-256 $actual_archive_sha"
echo "PROVENANCE: configure $configure_record"
echo "PASS: live PostgreSQL 17.6 identity $identity_176"
echo "PASS: live PostgreSQL 17.10 identity $identity_1710"
echo "PASS: PostgreSQL 17.6 runtime manifest JSON SHA-256 $json_sha_176"
echo "PASS: PostgreSQL 17.10 runtime manifest JSON SHA-256 $json_sha_1710"
echo "PASS: frozen manifest SHA-256 $expected_manifest_sha"
echo 'PASS: distinct binary, data, socket, and port identities verified'
echo 'PASS: source, build, data, socket, and log temporary directories removed'

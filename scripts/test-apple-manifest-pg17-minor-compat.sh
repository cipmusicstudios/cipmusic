#!/usr/bin/env bash
set -euo pipefail

# Supplemental source review only. The live-server runtime harness is the
# compatibility gate.
source_root="$(mktemp -d /tmp/cipmusic-pg17-minor.XXXXXX)"
cleanup_complete=0

delete_source_root() {
  find "$source_root" -depth -mindepth 1 -delete
  rmdir "$source_root"
  [[ ! -e "$source_root" ]]
}

cleanup_on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  if ((cleanup_complete)); then exit "$rc"; fi
  if [[ "${PG17_MINOR_DEBUG_RETAIN:-0}" == 1 && "$rc" -ne 0 ]]; then
    echo "DEBUG: retained supplemental source evidence at $source_root" >&2
  elif ! delete_source_root; then
    echo "ERROR: supplemental source cleanup failed: $source_root" >&2
    rc=1
  fi
  exit "$rc"
}
trap cleanup_on_exit EXIT INT TERM

for tag in REL_17_6 REL_17_10; do
  curl --fail --silent --show-error --location \
    "https://raw.githubusercontent.com/postgres/postgres/$tag/src/backend/utils/adt/ruleutils.c" \
    --output "$source_root/ruleutils-$tag.c"
  curl --fail --silent --show-error --location \
    "https://raw.githubusercontent.com/postgres/postgres/$tag/src/backend/utils/adt/format_type.c" \
    --output "$source_root/format_type-$tag.c"
done

expected_ruleutils=f1017456a03b2ca194dc964c55476223d224ecc1ba73b7a60204657f7d7b5f23
expected_format_176=5d2e040429eea76eb11b6d454a2ad945df345c78b246a4a116945022f25e66d3
expected_format_1710=1511bdb799de5ddb87c59c12188c7fa8117b9c52991e28124c9bed1cf9ce570e

hash_file() { shasum -a 256 "$1" | cut -d' ' -f1; }
[[ "$(hash_file "$source_root/ruleutils-REL_17_6.c")" == "$expected_ruleutils" ]]
[[ "$(hash_file "$source_root/ruleutils-REL_17_10.c")" == "$expected_ruleutils" ]]
cmp -s "$source_root/ruleutils-REL_17_6.c" "$source_root/ruleutils-REL_17_10.c"
[[ "$(hash_file "$source_root/format_type-REL_17_6.c")" == "$expected_format_176" ]]
[[ "$(hash_file "$source_root/format_type-REL_17_10.c")" == "$expected_format_1710" ]]

format_diff="$source_root/format-type.diff"
set +e
diff -u "$source_root/format_type-REL_17_6.c" "$source_root/format_type-REL_17_10.c" >"$format_diff"
diff_rc=$?
set -e
[[ "$diff_rc" == 1 ]]
grep -q 'check_valid_oidvector(oidArray)' "$format_diff"
[[ "$(grep -c '^@@' "$format_diff")" == 1 ]]
grep -q 'oidvectortypes' "$source_root/format_type-REL_17_6.c"

delete_source_root
cleanup_complete=1
trap - EXIT INT TERM

echo 'PASS: PostgreSQL REL_17_6/REL_17_10 ruleutils deparser source is identical'
echo 'PASS: the only format_type source delta is unrelated oidvector input validation'
echo 'PASS: supplemental source temporary directory removed'

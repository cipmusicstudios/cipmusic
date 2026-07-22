#!/usr/bin/env bash
set -euo pipefail

# PostgreSQL's official REL_17_6 and REL_17_10 tags are immutable review inputs.
# All pg_get_expr/constraint/index/trigger deparsers used by the manifest live in
# ruleutils.c. Function bodies are read structurally from pg_proc.prosrc instead
# of pg_get_functiondef formatting.
source_root="$(mktemp -d /tmp/cipmusic-pg17-minor.XXXXXX)"
cleanup() {
  find "$source_root" -type f -delete 2>/dev/null || true
  find "$source_root" -depth -type d -empty -delete 2>/dev/null || true
}
trap cleanup EXIT INT TERM

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

# The sole format_type.c change is input validation inside oidvectortypes(), not
# format_type_extended(), which supplies manifest column/function type names.
format_diff="$source_root/format-type.diff"
diff -u "$source_root/format_type-REL_17_6.c" "$source_root/format_type-REL_17_10.c" >"$format_diff" || true
grep -q 'check_valid_oidvector(oidArray)' "$format_diff"
[[ "$(grep -c '^@@' "$format_diff")" == 1 ]]
grep -q 'oidvectortypes' "$source_root/format_type-REL_17_6.c"

echo 'PASS: PostgreSQL REL_17_6/REL_17_10 ruleutils deparser source is identical'
echo 'PASS: the only format_type source delta is unrelated oidvector input validation'

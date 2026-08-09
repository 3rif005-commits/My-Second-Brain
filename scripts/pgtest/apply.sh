#!/usr/bin/env bash
# Apply supabase/migrations/0NN_*.sql files in order against the sb-pgtest
# container started by up.sh (localhost:55432). Reports OK/FAILED per file.
#
# Usage: apply.sh <start_num> <end_num>
#   e.g. apply.sh 001 013
#
# Two migrations are documented to fail for pre-existing bugs that are out of
# scope for the Notion-databases plan (see its "Pre-existing bugs found while
# building the harness" section). Those specific, expected failures do not
# fail this script; any other migration failing does. `apply.sh 001 013` is
# therefore expected to print 11 OK, 2 expected FAILED, and exit 0.
set -uo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <start_num> <end_num>  (e.g. $0 001 013)" >&2
  exit 1
fi

# Resolve paths relative to the repo root (this script lives in
# scripts/pgtest/), so the script works from any working directory.
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1

start="$1"
end="$2"
start10=$((10#$start))
end10=$((10#$end))

MIGRATIONS_DIR="supabase/migrations"
CONTAINER="sb-pgtest"

# migration number → why its failure is expected. Anything not listed here
# that fails is a real failure and exits non-zero.
declare -A KNOWN_FAILURES=(
  ["005"]="pre-existing 'CREATE POLICY IF NOT EXISTS' syntax bug — Postgres supports that clause in no version"
  ["010"]="pre-existing duplicate 'CREATE TABLE mcp_servers' — 009 already creates it (with IF NOT EXISTS), 010 without; the set is not replayable from 001"
)

overall_exit=0
applied=0
ok_count=0
expected_failure_count=0

shopt -s nullglob
for f in "$MIGRATIONS_DIR"/[0-9][0-9][0-9]_*.sql; do
  base=$(basename "$f")
  num="${base%%_*}"
  num10=$((10#$num))
  if (( num10 < start10 || num10 > end10 )); then
    continue
  fi
  applied=$((applied + 1))

  docker cp "$f" "$CONTAINER":/tmp/"$base" >/dev/null

  err_output=$(docker exec "$CONTAINER" psql -U postgres -q -v ON_ERROR_STOP=1 -f /tmp/"$base" 2>&1 >/dev/null)
  status=$?

  if [[ $status -eq 0 ]]; then
    echo "OK      $base"
    ok_count=$((ok_count + 1))
  elif [[ -n "${KNOWN_FAILURES[$num]:-}" ]]; then
    echo "FAILED  $base  (expected — ${KNOWN_FAILURES[$num]}; not a harness failure)"
    echo "$err_output" | sed 's/^/        /'
    expected_failure_count=$((expected_failure_count + 1))
  else
    echo "FAILED  $base"
    echo "$err_output" | sed 's/^/        /'
    overall_exit=1
  fi
done

echo
echo "Applied $applied migration(s), $ok_count OK, $expected_failure_count expected failure(s)."

if [[ $overall_exit -ne 0 ]]; then
  echo "One or more migrations failed unexpectedly (see FAILED lines above)." >&2
fi

exit $overall_exit

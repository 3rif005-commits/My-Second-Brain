#!/usr/bin/env bash
# Apply supabase/migrations/0NN_*.sql files in order against the sb-pgtest
# container started by up.sh (localhost:55432). Reports OK/FAILED per file.
#
# Usage: apply.sh <start_num> <end_num>
#   e.g. apply.sh 001 013
#
# Migration 005_notion_phase.sql is documented to fail with a pre-existing
# `CREATE POLICY IF NOT EXISTS` syntax bug (Postgres has no such clause).
# That specific, expected failure does not fail this script; any other
# migration failing does.
set -uo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <start_num> <end_num>  (e.g. $0 001 013)" >&2
  exit 1
fi

start="$1"
end="$2"
start10=$((10#$start))
end10=$((10#$end))

MIGRATIONS_DIR="supabase/migrations"
CONTAINER="sb-pgtest"
KNOWN_FAILURE_NUM="005"

overall_exit=0
applied=0
ok_count=0

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
  elif [[ "$num" == "$KNOWN_FAILURE_NUM" ]]; then
    echo "FAILED  $base  (expected — pre-existing 'CREATE POLICY IF NOT EXISTS' bug, not a harness failure)"
    echo "$err_output" | sed 's/^/        /'
  else
    echo "FAILED  $base"
    echo "$err_output" | sed 's/^/        /'
    overall_exit=1
  fi
done

echo
echo "Applied $applied migration(s), $ok_count OK."

if [[ $overall_exit -ne 0 ]]; then
  echo "One or more migrations failed unexpectedly (see FAILED lines above)." >&2
fi

exit $overall_exit

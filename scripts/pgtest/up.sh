#!/usr/bin/env bash
set -euo pipefail
docker rm -f sb-pgtest >/dev/null 2>&1 || true
docker run -d --name sb-pgtest -e POSTGRES_PASSWORD=pw -p 55432:5432 \
  pgvector/pgvector:pg16 >/dev/null
until docker exec sb-pgtest pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
docker exec sb-pgtest psql -U postgres -q \
  -c "ALTER DATABASE postgres SET search_path = public, extensions;"
docker cp scripts/pgtest/supabase_shim.sql sb-pgtest:/tmp/
docker exec sb-pgtest psql -U postgres -q -v ON_ERROR_STOP=1 -f /tmp/supabase_shim.sql
echo "ready on localhost:55432"

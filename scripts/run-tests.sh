#!/usr/bin/env bash
# Runs every end-to-end suite against locally started API / worker / web processes.
#
# What it does
#   1. (optional, --reset-db) wipes the `nexora` database and re-applies the migration SQL
#   2. starts the BUILT api + worker (apps/api/dist, workers/worker/dist) with the limits each suite needs
#   3. runs the suites in order, stops the processes and prints a summary
#
# Requirements: Postgres + Redis reachable (see .env), `npm run build` done, .env present,
#   psql, redis-cli, ghostscript, poppler-utils (pdftoppm, pdftotext) on PATH.
#
# WARNING: the suites create users/jobs and assume
#   DATABASE_URL = postgresql://nexora:nexora@localhost:5432/nexora   and   STORAGE_DIR = /tmp/nx-storage
# Use a throw-away database. --reset-db DROPS the public schema of that database.
#
# Usage: scripts/run-tests.sh [--reset-db] [--skip-ui] [suite ...]
#   suites: api tools lifecycle keys-admin cleanup key-ratelimit ui   (default: all)

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RESET=0; SKIP_UI=0; WANT=()
for a in "$@"; do
  case "$a" in
    --reset-db) RESET=1 ;;
    --skip-ui) SKIP_UI=1 ;;
    -h|--help) sed -n 2,22p "$0"; exit 0 ;;
    *) WANT+=("$a") ;;
  esac
done
[ ${#WANT[@]} -eq 0 ] && WANT=(api tools lifecycle keys-admin cleanup key-ratelimit ui)
[ $SKIP_UI -eq 1 ] && WANT=("${WANT[@]/ui}")

[ -f .env ] || { echo "No .env found. Run: npm run setup"; exit 2; }
[ -f apps/api/dist/server.js ] && [ -f workers/worker/dist/index.js ] || { echo "Build first: npm run build"; exit 2; }
for bin in psql redis-cli gs pdftoppm pdftotext; do command -v "$bin" >/dev/null || { echo "Missing dependency: $bin"; exit 2; }; done

set -a; . ./.env; set +a
export DATABASE_URL="${DATABASE_URL:-postgresql://nexora:nexora@localhost:5432/nexora}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export STORAGE_DIR=/tmp/nx-storage
export ADMIN_EMAIL=admin@test.dev ADMIN_PASSWORD=adminpassword123
export LOG_LEVEL=warn
mkdir -p "$STORAGE_DIR"

if [ $RESET -eq 1 ]; then
  echo ">> resetting database + redis"
  PGPASSWORD=nexora psql "$DATABASE_URL" -q -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null || exit 2
  for f in packages/database/prisma/migrations/*/migration.sql; do PGPASSWORD=nexora psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null || exit 2; done
  redis-cli -u "$REDIS_URL" flushall >/dev/null
  rm -rf "$STORAGE_DIR"; mkdir -p "$STORAGE_DIR"
fi

LOGDIR="$(mktemp -d)"; PIDS=()
stop_all() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; PIDS=(); sleep 1; }
trap stop_all EXIT

wait_http() { for _ in $(seq 1 60); do curl -fs "$1" >/dev/null 2>&1 && return 0; sleep 0.5; done; echo "timeout waiting for $1 (logs in $LOGDIR)"; return 1; }

start_api() { # port, extra env...
  local port=$1; shift
  env API_PORT="$port" "$@" node apps/api/dist/server.js >"$LOGDIR/api-$port.log" 2>&1 & PIDS+=($!)
  wait_http "http://localhost:$port/api/health"
}
start_worker() {
  env WORKER_CONCURRENCY=3 CLEANUP_INTERVAL_MINUTES=1 "$@" node workers/worker/dist/index.js >"$LOGDIR/worker.log" 2>&1 & PIDS+=($!)
  sleep 3
}

declare -A RESULT
run_suite() { # name, file
  echo; echo "=================== $1"
  if node "$2" 2>&1 | tee "$LOGDIR/$1.out" | grep -E '^(FAIL|[0-9]+ passed)|passed' | tail -15; [ "${PIPESTATUS[0]}" -eq 0 ]; then RESULT[$1]=ok; else RESULT[$1]=FAILED; fi
}
has() { for w in "${WANT[@]}"; do [ "$w" = "$1" ] && return 0; done; return 1; }

# --- Group 1: strict auth limit (the api suite asserts that a login flood gets HTTP 429).
#     No worker on purpose: the suite checks jobs sit in QUEUED and can be cancelled while queued.
if has api; then
  start_api 4000 AUTH_RATE_LIMIT=15 UPLOAD_RATE_LIMIT=1000 API_RATE_LIMIT=5000 MAX_UPLOAD_MB=1
  run_suite api tests/api.e2e.mjs
  stop_all
fi

# --- Group 2: relaxed limits for everything that registers many users / uploads a lot
if has tools || has lifecycle || has keys-admin || has cleanup; then
  start_api 4000 AUTH_RATE_LIMIT=500 UPLOAD_RATE_LIMIT=1000 API_RATE_LIMIT=5000; start_worker
  has tools && run_suite tools tests/tools.e2e.mjs
  has lifecycle && run_suite lifecycle tests/lifecycle.e2e.mjs
  has keys-admin && run_suite keys-admin tests/stage4.e2e.mjs
  has cleanup && run_suite cleanup tests/cleanup.e2e.mjs
  stop_all
fi

# --- Group 3: per-API-key rate limit (3 uploads per window), on its own port
if has key-ratelimit; then
  start_api 4003 AUTH_RATE_LIMIT=500 UPLOAD_RATE_LIMIT=3 UPLOAD_RATE_WINDOW_SECONDS=300 API_RATE_LIMIT=5000
  run_suite key-ratelimit tests/apikey-ratelimit.e2e.mjs
  stop_all
fi

# --- Group 4: browser UI (headless Chromium via @sparticuz/chromium) against the built Next.js app
if has ui; then
  [ -d apps/web/.next ] || { echo "apps/web/.next missing - run npm run build"; exit 2; }
  start_api 4000 AUTH_RATE_LIMIT=500 UPLOAD_RATE_LIMIT=1000 API_RATE_LIMIT=5000; start_worker
  ( cd apps/web && API_INTERNAL_URL=http://localhost:4000 exec ../../node_modules/.bin/next start -p 3000 ) >"$LOGDIR/web.log" 2>&1 & PIDS+=($!)
  wait_http http://localhost:3000/ && run_suite ui tests/ui.e2e.mjs
  stop_all
fi

echo; echo "=================== summary"
rc=0
for k in "${!RESULT[@]}"; do printf '%-16s %s\n' "$k" "${RESULT[$k]}"; [ "${RESULT[$k]}" = ok ] || rc=1; done | sort
for k in "${!RESULT[@]}"; do [ "${RESULT[$k]}" = ok ] || rc=1; done
echo "logs: $LOGDIR"
exit $rc
